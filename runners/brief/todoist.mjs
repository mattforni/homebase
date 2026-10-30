#!/usr/bin/env node
// The Todoist pull of the brief runner, beside its entrypoint (runners/brief/todoist.mjs).
//
//   node todoist.mjs pull <out-dir> <landing-monday>
//       The tasks the planning skill's Schedule filter returns (overdue,
//       unscheduled and due before next Monday, and Scheduled with no time),
//       plus the tasks due on <landing-monday> (YYYY-MM-DD), where deferrals
//       accumulate. Each task carries its project and section names, labels,
//       priority, and due. Writes <out-dir>/todoist.json. No dependencies,
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

async function pull(outDir, monday, before) {
    mkdirSync(outDir, { recursive: true });
    const [projects, sections] = await Promise.all([all("projects"), all("sections")]);
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));
    const sectionNames = new Map(sections.map((s) => [s.id, s.name]));
    const filter = scheduleFilter(before);
    const schedule = await all("tasks/filter", { query: filter });
    const landing = await all("tasks/filter", { query: `due: ${filterDate(monday)}` });
    const seen = new Set();
    const shape = (list) => list.filter((t) => !seen.has(t.id) && seen.add(t.id)).map((t) => shapeTask(t, projectNames, sectionNames));
    const out = {
        pulledAt: new Date().toISOString(),
        filter,
        landingMonday: monday,
        schedule: shape(schedule),
        landing: shape(landing),
    };
    writeFileSync(join(outDir, "todoist.json"), JSON.stringify(out, null, 1));
    log(`${out.schedule.length} in the Schedule filter, ${out.landing.length} more due ${monday}`);
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
