// The calendar lint and the Denver normalization, on invented events.
import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarsFromEnv, lint, local, shapeEvent } from "../calendar.mjs";

test("a foreign offset lands on the Denver wall clock", () => {
    // 09:00 Pacific in October is 10:00 Mountain.
    assert.deepEqual(local("2026-10-20T09:00:00-07:00"), { date: "2026-10-20", time: "10:00", day: "Tue" });
    // UTC midnight is the evening before in Denver.
    assert.deepEqual(local("2026-10-21T00:00:00Z"), { date: "2026-10-20", time: "18:00", day: "Tue" });
});

test("CALENDARS parses name=id pairs", () => {
    assert.deepEqual(calendarsFromEnv("life=primary, atelic=a@b.c"), [{ name: "life", id: "primary" }, { name: "atelic", id: "a@b.c" }]);
    assert.throws(() => calendarsFromEnv(""));
});

const ev = (summary, start, end, extra = {}) => shapeEvent({
    id: summary, summary, status: "confirmed",
    start: { dateTime: start }, end: { dateTime: end }, ...extra,
}, extra.calendar || "life");

test("an all day event keeps its date and carries no times", () => {
    const e = shapeEvent({ id: "x", summary: "🧭 Gratitude", start: { date: "2026-10-19" }, end: { date: "2026-10-26" }, transparency: "transparent" }, "life");
    assert.equal(e.allDay, true);
    assert.equal(e.date, "2026-10-19");
    assert.equal(e.start, null);
    assert.equal(e.transparency, "transparent");
});

test("two opaque events that overlap are a finding; a transparent hold is not", () => {
    const events = [
        ev("🏋️ Strength", "2026-10-20T15:30:00-06:00", "2026-10-20T16:30:00-06:00"),
        ev("📞 Call", "2026-10-20T16:00:00-06:00", "2026-10-20T16:30:00-06:00"),
        ev("🧘 Align and Flow", "2026-10-20T16:30:00-06:00", "2026-10-20T17:30:00-06:00", { transparency: "transparent" }),
        ev("🧘 Evening Routine", "2026-10-20T17:00:00-06:00", "2026-10-20T18:00:00-06:00"),
    ];
    const { findings } = lint(events.map((e) => ({ ...e, labelId: "l" })));
    assert.deepEqual(findings.map((f) => f.kind), ["overlap"]);
    assert.match(findings[0].what, /Strength .* overlaps 📞 Call/);
});

test("events from calendars with different offsets compare as instants, not as strings", () => {
    // 09:30 Pacific is 10:30 Mountain, so this Todoist task sits inside the Mountain meeting.
    const events = [
        ev("📞 Meeting", "2026-10-20T10:00:00-06:00", "2026-10-20T11:00:00-06:00"),
        ev("Pay Jeff", "2026-10-20T09:30:00-07:00", "2026-10-20T10:00:00-07:00", { calendar: "todoist" }),
    ].map((e) => ({ ...e, labelId: "l" }));
    assert.equal(events[1].startIso, "2026-10-20T16:30:00.000Z");
    assert.deepEqual(lint(events).findings.map((f) => f.kind), ["overlap"]);
});

test("a named ATE block holds its slot even when it is free", () => {
    const events = [
        ev("📖 ATE-670: The Read", "2026-10-20T11:00:00-06:00", "2026-10-20T13:00:00-06:00", { transparency: "transparent", calendar: "atelic" }),
        ev("🔧 ATE-654: Plumbers", "2026-10-20T12:00:00-06:00", "2026-10-20T12:30:00-06:00", { transparency: "transparent", calendar: "atelic" }),
    ];
    const { findings } = lint(events.map((e) => ({ ...e, labelId: "l" })));
    assert.equal(findings.filter((f) => f.kind === "overlap").length, 1);
});

test("a change of location with no flank is a finding, and a transition between them clears it", () => {
    const home = { location: "3033 Blake St" };
    const gym = { location: "3201 Walnut St" };
    const bare = [
        ev("💻 Deep Work", "2026-10-21T13:00:00-06:00", "2026-10-21T15:00:00-06:00", home),
        ev("🏋️ Strength", "2026-10-21T15:00:00-06:00", "2026-10-21T16:00:00-06:00", gym),
    ].map((e) => ({ ...e, labelId: "l" }));
    assert.deepEqual(lint(bare).findings.map((f) => f.kind), ["missing flank"]);
    const flanked = [
        bare[0],
        { ...ev("🚙 To Movement", "2026-10-21T15:00:00-06:00", "2026-10-21T15:30:00-06:00"), labelId: "l" },
        { ...ev("🏋️ Strength", "2026-10-21T15:30:00-06:00", "2026-10-21T16:30:00-06:00", gym), labelId: "l" },
    ];
    assert.deepEqual(lint(flanked).findings, []);
});

test("an event with no label is a finding on Life only; Atelic and the Todoist feed carry none by design", () => {
    const events = [
        { ...ev("Dentist", "2026-10-22T09:00:00-06:00", "2026-10-22T10:00:00-06:00"), labelId: null },
        { ...ev("Pay Jeff", "2026-10-22T10:30:00-06:00", "2026-10-22T11:00:00-06:00", { calendar: "todoist" }), labelId: null },
        { ...ev("🙈 Deep Work", "2026-10-22T13:00:00-06:00", "2026-10-22T15:00:00-06:00", { calendar: "atelic" }), labelId: null },
    ];
    const { findings } = lint(events);
    assert.deepEqual(findings.map((f) => [f.kind, f.what.split(" (")[0]]), [["unlabeled", "Dentist"]]);
});
