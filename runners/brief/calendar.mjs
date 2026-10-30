#!/usr/bin/env node
// The calendar pull of the brief runner, beside its entrypoint (runners/brief/calendar.mjs).
//
//   node calendar.mjs pull <out-dir> <from> <to>
//       Every event on the three calendars between <from> (inclusive) and <to>
//       (exclusive), both YYYY-MM-DD in America/Denver, with every time
//       normalized to that zone. Writes <out-dir>/calendar.json and
//       <out-dir>/calendar-lint.json. No dependencies, node 20 or later.
//
// The Todoist feed carries a foreign offset (its rows render an hour early
// when read as wall clock), which is why every time here is re expressed in
// Denver before anything reads it; the planning skill says why (2026-08-30).
//
// The lint is the two checks the planner agent runs by hand: two opaque timed
// events that overlap, and a change of location with no 30 minute flank
// between the two events. A transition or travel event (↔️, 🚙, ✈️, or a title
// starting with "To ") is the flank; two events at the same location, or where
// either names no location, need none. Both are findings for the model to
// phrase and for Forni to decide; nothing here changes a calendar.
//
// Credentials: GCAL_TOKEN, an access token for the personal profile, which
// owns the Life calendar and holds writer on Atelic. The calendars come from
// CALENDARS ("life=primary,atelic=<address>,todoist=<id>").

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const API = "https://www.googleapis.com/calendar/v3";
const ZONE = process.env.CALENDAR_ZONE || "America/Denver";
const log = (s) => process.stderr.write(`calendar: ${s}\n`);
export const FLANK_MINUTES = Number(process.env.CALENDAR_FLANK_MINUTES || 30);

export const calendarsFromEnv = (raw = process.env.CALENDARS || "") => {
    const out = [];
    for (const pair of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
        const eq = pair.indexOf("=");
        if (eq > 0) out.push({ name: pair.slice(0, eq).trim(), id: pair.slice(eq + 1).trim() });
    }
    if (out.length === 0) throw new Error("CALENDARS is empty; expected name=id pairs");
    return out;
};

/* ---------- time ---------- */

const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
});
/** An instant as Denver wall clock: {date: "2026-10-20", time: "09:30", day: "Tue"}. */
export function local(iso) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, day: p.weekday };
}
/** The offset of the zone at a given civil date, so a date string can become an instant. */
function offsetAt(dateIso) {
    const probe = new Date(`${dateIso}T12:00:00Z`);
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(probe).map((x) => [x.type, x.value]));
    const minutes = Number(p.hour) * 60 + Number(p.minute) - 12 * 60;
    const sign = minutes <= 0 ? "-" : "+";
    const abs = Math.abs(minutes);
    return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}
const dayStart = (dateIso) => `${dateIso}T00:00:00${offsetAt(dateIso)}`;

/* ---------- pull ---------- */

async function list(token, calendarId, timeMin, timeMax) {
    const items = [];
    let pageToken;
    do {
        const url = new URL(`${API}/calendars/${encodeURIComponent(calendarId)}/events`);
        url.searchParams.set("singleEvents", "true");
        url.searchParams.set("orderBy", "startTime");
        url.searchParams.set("maxResults", "250");
        url.searchParams.set("timeMin", timeMin);
        url.searchParams.set("timeMax", timeMax);
        url.searchParams.set("eventLabelVersion", "1");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
        if (!res.ok) throw new Error(`events ${calendarId} ${res.status} ${(await res.text()).slice(0, 200)}`);
        const page = await res.json();
        items.push(...(page.items || []));
        pageToken = page.nextPageToken;
    } while (pageToken);
    return items;
}

export function shapeEvent(e, calendar) {
    const allDay = Boolean(e.start?.date);
    // The instants are kept as UTC, so two events from calendars with
    // different offsets (the Todoist feed's -07:00 beside Google's -06:00)
    // sort and compare as plain strings everywhere below.
    const startIso = allDay ? null : new Date(e.start?.dateTime).toISOString();
    const endIso = allDay ? null : new Date(e.end?.dateTime).toISOString();
    const s = startIso ? local(startIso) : null;
    const t = endIso ? local(endIso) : null;
    return {
        calendar,
        id: e.id,
        summary: e.summary || "",
        allDay: allDay,
        date: allDay ? e.start.date : s.date,
        endDate: allDay ? e.end?.date : t.date,
        day: allDay ? null : s.day,
        start: allDay ? null : s.time,
        end: allDay ? null : t.time,
        startIso: startIso,
        endIso: endIso,
        transparency: e.transparency === "transparent" ? "transparent" : "opaque",
        labelId: e.eventLabelId || e.eventLabel?.id || null,
        location: e.location || "",
        description: (e.description || "").slice(0, 200),
        recurringEventId: e.recurringEventId || null,
        status: e.status || "confirmed",
    };
}

/* ---------- lint ---------- */

const isFlank = (ev) => /↔️|🚙|✈️|🚆|🚲/u.test(ev.summary) || /^To |transition|travel/i.test(ev.summary.replace(/^[^A-Za-z]+/, ""));
const minutes = (iso) => new Date(iso).getTime() / 60000;

export function lint(events) {
    const timed = events.filter((e) => !e.allDay && e.status !== "cancelled").sort((a, b) => (a.startIso < b.startIso ? -1 : 1));
    const findings = [];
    const opaque = timed.filter((e) => e.transparency === "opaque" || /ATE-\d+/.test(e.summary));
    for (let i = 0; i < opaque.length; i += 1) {
        for (let j = i + 1; j < opaque.length; j += 1) {
            const a = opaque[i], b = opaque[j];
            if (b.startIso >= a.endIso) break;
            if (isFlank(a) || isFlank(b)) continue;
            findings.push({ kind: "overlap", when: `${a.day} ${a.start}`, what: `${a.summary} (${a.start} to ${a.end}, ${a.calendar}) overlaps ${b.summary} (${b.start} to ${b.end}, ${b.calendar})` });
        }
    }
    const located = timed.filter((e) => e.location && !isFlank(e) && e.transparency === "opaque");
    for (let i = 1; i < located.length; i += 1) {
        const prev = located[i - 1], cur = located[i];
        if (prev.date !== cur.date || prev.location === cur.location) continue;
        const gap = minutes(cur.startIso) - minutes(prev.endIso);
        if (gap >= FLANK_MINUTES) continue;
        const flankBetween = timed.some((e) => isFlank(e) && e.startIso >= prev.endIso && e.endIso <= cur.startIso);
        if (flankBetween) continue;
        findings.push({ kind: "missing flank", when: `${cur.day} ${cur.start}`, what: `${prev.summary} at ${prev.location} ends ${prev.end} and ${cur.summary} at ${cur.location} starts ${cur.start}, with no transition between them` });
    }
    // Only the Life calendar carries labels; Atelic events have none by design
    // (google-calendar.md) and the Todoist feed is not ours to label.
    const unlabeled = timed.filter((e) => !e.labelId && e.calendar === "life" && e.transparency === "opaque").map((e) => ({ kind: "unlabeled", when: `${e.day} ${e.start}`, what: `${e.summary} (${e.calendar}) carries no label` }));
    return { findings: findings.concat(unlabeled), counts: { events: events.length, timed: timed.length, opaque: opaque.length } };
}

/* ---------- main ---------- */

async function pull(outDir, from, to) {
    const token = process.env.GCAL_TOKEN || "";
    if (!token) throw new Error("GCAL_TOKEN is not set");
    mkdirSync(outDir, { recursive: true });
    const events = [];
    for (const cal of calendarsFromEnv()) {
        const items = await list(token, cal.id, dayStart(from), dayStart(to));
        const shaped = items.filter((e) => e.status !== "cancelled").map((e) => shapeEvent(e, cal.name));
        events.push(...shaped);
        log(`${cal.name}: ${shaped.length} events`);
    }
    events.sort((a, b) => ((a.startIso || `${a.date}T00:00:00`) < (b.startIso || `${b.date}T00:00:00`) ? -1 : 1));
    writeFileSync(join(outDir, "calendar.json"), JSON.stringify({ pulledAt: new Date().toISOString(), zone: ZONE, from, to, events }, null, 1));
    const result = lint(events);
    writeFileSync(join(outDir, "calendar-lint.json"), JSON.stringify(result, null, 1));
    log(`lint: ${result.findings.length} findings over ${result.counts.timed} timed events`);
}

async function main() {
    const [cmd, outDir, from, to] = process.argv.slice(2);
    if (cmd === "pull" && outDir && from && to) return pull(outDir, from, to);
    process.stderr.write("usage: calendar.mjs pull <out-dir> <from YYYY-MM-DD> <to YYYY-MM-DD>\n");
    process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((e) => { log(e.message); process.exit(1); });
}
