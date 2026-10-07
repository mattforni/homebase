// The Linear read the pipeline runner makes: every open issue in the active
// cycle, as the customer lines of the Pipeline mail (ATE-630).
//
//   node linear.mjs issues > linear.json
//       Prints {issues: [{identifier, title, url, priority, dueDate, project}]}
//       and exits zero; on anything else it prints one line to stderr and
//       exits non zero, and the caller goes on without it. Nothing about the
//       mail is worth failing a run over a tracker being down.
//
// One GraphQL query, kept small on purpose: Linear scores a query's
// complexity and refuses a heavy one, so the filter does the work (the active
// cycle, a state that is neither completed nor canceled) and the fields are
// the six the mail prints. Read only: there is no mutation in this file.
//
// Credentials: LINEAR_API_KEY, a personal API key for the atelic workspace,
// sent bare in the Authorization header as Linear's API expects (no Bearer).

import { pathToFileURL } from "node:url";

const ENDPOINT = "https://api.linear.app/graphql";
const PAGE = 100;
// A cycle holds tens of issues, never hundreds; the cap is a stop on a
// pagination that never ends, not a limit anyone should meet.
const MAX_PAGES = 5;

const QUERY = `query ActiveCycleIssues($first: Int!, $after: String) {
  issues(
    first: $first
    after: $after
    filter: { cycle: { isActive: { eq: true } }, state: { type: { nin: ["completed", "canceled"] } } }
  ) {
    nodes { identifier title url priority dueDate project { name } }
    pageInfo { hasNextPage endCursor }
  }
}`;

/**
 * Every open issue in the active cycle. `fetchImpl` is the seam the tests
 * use; production passes nothing and gets the global fetch.
 */
export async function activeCycleIssues({ key, fetchImpl = fetch, timeoutMs = 30000 } = {}) {
    if (!key) throw new Error("no LINEAR_API_KEY in the environment");
    const issues = [];
    let after = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const res = await fetchImpl(ENDPOINT, {
            method: "POST",
            headers: { Authorization: key, "Content-Type": "application/json" },
            body: JSON.stringify({ query: QUERY, variables: { first: PAGE, after } }),
            signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`Linear ${res.status}: ${text.slice(0, 200)}`);
        // A GraphQL error arrives as a 200 with an errors array, which reads
        // as success to anything that only checks the status.
        const body = JSON.parse(text);
        if (body.errors?.length) throw new Error(`Linear: ${String(body.errors[0].message).slice(0, 200)}`);
        const conn = body.data?.issues;
        if (!conn) throw new Error("Linear answered without an issues connection");
        for (const n of conn.nodes || []) {
            issues.push({
                identifier: n.identifier, title: n.title || "", url: n.url || "",
                priority: Number(n.priority || 0), dueDate: n.dueDate || "", project: n.project?.name || "",
            });
        }
        if (!conn.pageInfo?.hasNextPage) break;
        after = conn.pageInfo.endCursor;
    }
    return issues;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
    const [command] = process.argv.slice(2);
    if (command !== "issues") {
        console.error("usage: node linear.mjs issues");
        process.exit(2);
    }
    try {
        const issues = await activeCycleIssues({ key: process.env.LINEAR_API_KEY || "" });
        process.stdout.write(`${JSON.stringify({ issues }, null, 2)}\n`);
    } catch (error) {
        console.error(`linear: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
