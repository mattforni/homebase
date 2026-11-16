#!/usr/bin/env node
// The Todoist pull of the brief runner, beside its entrypoint (runners/brief/todoist.mjs).
//
//   node todoist.mjs pull <out-dir> <landing-monday>
//       The tasks the planning skill's Schedule filter returns (overdue,
//       unscheduled and due before next Monday, and Scheduled with no time),
//       plus the tasks due on <landing-monday> (YYYY-MM-DD), where deferrals
//       accumulate. Each task carries its project and section names, labels,
//       priority, and due, and the tasks completed in the seven days before
//       <landing-monday>. Writes <out-dir>/todoist.json. No dependencies,
//       node 20 or later. Read only.
//
// The filter query is the one plan-week's SKILL.md names and is read from
// TODOIST_SCHEDULE_FILTER so a change there is a change here without a code
// edit. Priority is printed as p1 to p4 the way Forni reads it (the API's 4 is
// p1).
//
// Credentials: TODOIST_API_TOKEN, as a bearer token against the v1 API.

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const API = "https://api.todoist.com/api/v1";
const log = (s) => process.stderr.write(`todoist: ${s}\n`);
const SCHEDULE_FILTER = process.env.TODOIST_SCHEDULE_FILTER
    || "(!(@⏰ Scheduled | @⏲️ Recurring) | overdue | (@⏰ Scheduled & no time)) & due before: next monday";

async function get(path, params = {}) {
    const token = process.env.TODOIST_API_TOKEN || "";
    if (!token) throw new Error("TODOIST_API_TOKEN is not set");
    const url = new URL(`${API}/${path}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`GET ${path} ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
}

/** Walks a v1 cursor listing to the end. */
async function all(path, params = {}) {
    const out = [];
    let cursor = null;
    do {
        const page = await get(path, { ...params, cursor, limit: 200 });
        out.push(...(page.results || []));
        cursor = page.next_cursor || null;
    } while (cursor);
    return out;
}

export const priorityWord = (n) => ({ 4: "p1", 3: "p2", 2: "p3", 1: "p4" })[n] || "p4";

/** "2026-10-20" as the US form the filter language reads. */
export const filterDate = (iso) => {
    const [y, m, d] = iso.split("-");
    return `${Number(m)}/${Number(d)}/${y}`;
};

export function shapeTask(t, projects, sections) {
    return {
        id: t.id,
        content: t.content,
        description: (t.description || "").slice(0, 300),
        project: projects.get(t.project_id) || t.project_id || "",
        section: sections.get(t.section_id) || "",
        labels: t.labels || [],
        priority: priorityWord(t.priority),
        due: t.due?.date || null,
        dueString: t.due?.string || "",
        recurring: Boolean(t.due?.is_recurring),
        duration: t.duration ? `${t.duration.amount} ${t.duration.unit}` : "",
        url: t.url || `https://app.todoist.com/app/task/${t.id}`,
        createdAt: t.added_at || t.created_at || "",
    };
}

/**
 * The Schedule filter with its relative bound made explicit: Todoist reads
 * "next monday" as tomorrow on a Sunday night and as a week away on a Monday
 * morning, so the caller names the Monday the bound falls on.
 */
export const scheduleFilter = (before) => (before
    ? SCHEDULE_FILTER.replace(/due before:\s*next monday/i, `due before: ${filterDate(before)}`)
    : SCHEDULE_FILTER);

/** The ISO date `days` before `iso`. */
const shiftDays = (iso, days) => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};

/** Midnight Denver on `iso`, with its UTC offset, so the window is the local week. */
const denverMidnight = (iso) => {
    const zone = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", timeZoneName: "longOffset" })
        .formatToParts(new Date(`${iso}T12:00:00Z`)).find((p) => p.type === "timeZoneName")?.value || "GMT-07:00";
    return `${iso}T00:00:00${zone.replace("GMT", "") || "+00:00"}`;
};

/**
 * One completion event from the activity log as a completed row, or null
 * when it falls outside [since, until). The event's extra data carries the
 * task as it stood when it was checked off, so a recurring occurrence keeps
 * its own content, labels and priority, and so does a task deleted since.
 */
export function completedRow(event, sinceMs, untilMs, projectNames) {
    if (event.object_type !== "item" || event.event_type !== "completed") return null;
    const at = Date.parse(event.event_date || "");
    if (Number.isNaN(at) || at < sinceMs || at >= untilMs) return null;
    const extra = event.extra_data || {};
    return {
        id: event.object_id || "",
        content: extra.content || "",
        project: projectNames.get(event.parent_project_id) || "",
        labels: extra.labels || [],
        priority: priorityWord(extra.priority),
        completedAt: event.event_date,
        recurring: Boolean(extra.is_recurring),
    };
}

/**
 * The tasks completed in the closed week, the seven days before the landing
 * Monday, for the retro's "what I ended up doing" summary (Forni,
 * 2026-11-09). Each check off is a row, so a recurring task completed twice
 * is two rows.
 *
 * The source is the activity log's task completed events, not the completed
 * tasks listing: checking off an occurrence of a recurring task rolls its due
 * date forward and leaves the task open, so the listing never holds it, and
 * a task deleted after it was done drops out of the listing too. For W46 the
 * listing returned 3 completions where the log held 23 (19 of them
 * recurring), W47's feedback that the count was far too low.
 *
 * The log is read newest first and walked back to the window's start, never
 * asked for it by date_from: Todoist refuses a date_from past the plan's
 * activity history with a 403, while paging back from now simply ends where
 * the history does. The brief fires the night before the week opens, so the
 * whole closed week is inside that history. A failure here costs the summary
 * and never the pull.
 */
export async function completed(monday, projectNames, report = {}) {
    const sinceMs = Date.parse(denverMidnight(shiftDays(monday, -7)));
    const untilMs = Date.parse(denverMidnight(monday));
    const out = [];
    let cursor = null;
    do {
        const page = await get("activities", {
            object_event_types: JSON.stringify(["item:completed"]),
            cursor,
            limit: 100,
        });
        const events = page.results || [];
        for (const event of events) {
            const row = completedRow(event, sinceMs, untilMs, projectNames);
            if (row) out.push(row);
        }
        const oldest = Date.parse(events[events.length - 1]?.event_date || "");
        const reached = oldest < sinceMs;
        cursor = events.length > 0 && !reached ? page.next_cursor || null : null;
        // A history that ends inside the week leaves the count short; say so on the page, not only in the log.
        if (events.length > 0 && !page.next_cursor && !reached) {
            report.truncated = true;
            log("the activity history ends inside the week; the earliest completions may be missing");
        }
    } while (cursor);
    return out;
}

async function pull(outDir, monday, before) {
    mkdirSync(outDir, { recursive: true });
    const [projects, sections] = await Promise.all([all("projects"), all("sections")]);
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));
    const sectionNames = new Map(sections.map((s) => [s.id, s.name]));
    const filter = scheduleFilter(before);
    const schedule = await all("tasks/filter", { query: filter });
    const landing = await all("tasks/filter", { query: `due: ${filterDate(monday)}` });
    let done = [];
    let completedNote = "";
    try {
        const report = {};
        done = await completed(monday, projectNames, report);
        if (report.truncated) completedNote = "the activity history begins inside the week, so the count may be short";
    } catch (e) {
        completedNote = e.message;
        done = null; // not read, which the brief says, and not zero
        log(`completed tasks not read: ${e.message}`);
    }
    const seen = new Set();
    const shape = (list) => list.filter((t) => !seen.has(t.id) && seen.add(t.id)).map((t) => shapeTask(t, projectNames, sectionNames));
    const out = {
        pulledAt: new Date().toISOString(),
        filter,
        landingMonday: monday,
        schedule: shape(schedule),
        landing: shape(landing),
        completed: done,
        completedNote,
    };
    writeFileSync(join(outDir, "todoist.json"), JSON.stringify(out, null, 1));
    log(`${out.schedule.length} in the Schedule filter, ${out.landing.length} more due ${monday}, ${done ? done.length : "no"} completed in the week before`);
}

async function main() {
    const [cmd, outDir, monday, before] = process.argv.slice(2);
    if (cmd === "pull" && outDir && monday) return pull(outDir, monday, before);
    process.stderr.write("usage: todoist.mjs pull <out-dir> <landing-monday YYYY-MM-DD> [<due-before YYYY-MM-DD>]\n");
    process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((e) => { log(e.message); process.exit(1); });
}
