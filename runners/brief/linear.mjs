#!/usr/bin/env node
// The Linear read of the brief runner, beside its entrypoint (runners/brief/linear.mjs).
//
//   node linear.mjs pull <out-dir> [team-key]
//       Every issue in the active cycle of the team (ATE by default) that is
//       neither completed nor canceled, with the fields What Counts as
//       Triaged grades (estimate, labels, due date, state) and the first lines
//       of the description so the model can say what each one is. Writes
//       <out-dir>/linear.json as {team, cycle, issues, truncated}. No
//       dependencies, node 20 or later. Read only.
//
// Credentials: LINEAR_API_KEY, a personal API key for the workspace, sent bare
// in the Authorization header as Linear's API expects.

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ENDPOINT = "https://api.linear.app/graphql";
const PAGE = 50;
const MAX_PAGES = 6;
const log = (s) => process.stderr.write(`linear: ${s}\n`);

const QUERY = `query ActiveCycle($team: String!, $first: Int!, $after: String) {
  issues(
    first: $first
    after: $after
    filter: { team: { key: { eq: $team } }, cycle: { isActive: { eq: true } }, state: { type: { nin: ["completed", "canceled"] } } }
  ) {
    nodes {
      identifier title url priority estimate dueDate description updatedAt createdAt
      state { name type }
      labels { nodes { name } }
      project { name }
      cycle { number startsAt endsAt }
      assignee { name }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

async function page(key, team, after) {
    const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: key },
        body: JSON.stringify({ query: QUERY, variables: { team, first: PAGE, after } }),
        signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`linear ${res.status} ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; ").slice(0, 300));
    return body.data.issues;
}

export function shapeIssue(n) {
    const labels = (n.labels?.nodes || []).map((l) => l.name);
    return {
        key: n.identifier,
        title: n.title,
        url: n.url,
        state: n.state?.name || "",
        stateType: n.state?.type || "",
        priority: n.priority,
        estimate: n.estimate ?? null,
        labels,
        load: labels.find((l) => /Sharp|Medium|Light/.test(l)) || null,
        dueDate: n.dueDate || null,
        project: n.project?.name || null,
        assignee: n.assignee?.name || null,
        updatedAt: n.updatedAt,
        createdAt: n.createdAt,
        description: (n.description || "").replace(/\s+/g, " ").slice(0, 300),
    };
}

async function pull(outDir, team) {
    const key = process.env.LINEAR_API_KEY || "";
    if (!key) throw new Error("LINEAR_API_KEY is not set");
    mkdirSync(outDir, { recursive: true });
    const issues = [];
    let after = null, truncated = false, cycle = null;
    for (let i = 0; i < MAX_PAGES; i += 1) {
        const p = await page(key, team, after);
        for (const n of p.nodes) {
            if (!cycle && n.cycle) cycle = { number: n.cycle.number, startsAt: n.cycle.startsAt, endsAt: n.cycle.endsAt };
            issues.push(shapeIssue(n));
        }
        if (!p.pageInfo.hasNextPage) break;
        after = p.pageInfo.endCursor;
        if (i === MAX_PAGES - 1) truncated = true;
    }
    // An empty active cycle is possible but rare, and the same empty answer
    // is what a key for another workspace returns (the team filter matches
    // nothing there), so zero is treated as a failed read rather than a
    // clean one; the mail then says the cycle was not read instead of
    // showing a week with no work in it.
    if (issues.length === 0 || !cycle) throw new Error(`no open issues in an active ${team} cycle; the key may belong to another workspace`);
    issues.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
    writeFileSync(join(outDir, "linear.json"), JSON.stringify({ pulledAt: new Date().toISOString(), team, cycle, issues, truncated }, null, 1));
    log(`${team}: ${issues.length} open issues in the active cycle${truncated ? ", stopped at the page cap" : ""}`);
}

async function main() {
    const [cmd, outDir, team] = process.argv.slice(2);
    if (cmd === "pull" && outDir) return pull(outDir, team || "ATE");
    process.stderr.write("usage: linear.mjs pull <out-dir> [team-key]\n");
    process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((e) => { log(e.message); process.exit(1); });
}
