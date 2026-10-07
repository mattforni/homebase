// The Linear read the pipeline runner makes: every open issue in the active
// cycle, as the customer lines of the Pipeline mail (ATE-630).
//
//   node linear.mjs issues > linear.json
//       Prints {issues: [{identifier, title, url, priority, dueDate, project}],
//       truncated} and exits zero; on anything else it prints one line to stderr and
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
// Each page gets this long. The worst case for a whole read is therefore
// MAX_PAGES times this, two and a half minutes, and the entrypoint's own
// `timeout` around this script is set above that on purpose: the outer bound
// is the backstop, and it must never fire before this file has had the
// chance to fail in its own words. Change one and change the other.
const PAGE_TIMEOUT_MS = 30000;

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
 * A failure whose words are this file's own. The reason a read failed
 * travels into pulls.md and the mail's Left for You line, so it is an HTTP
 * status or one of the fixed phrases below and never a word of what Linear
 * sent back: nothing an API echoes belongs in a mailbox (review, 2026-10-07).
 */
export class LinearError extends Error {}

/**
 * Every open issue in the active cycle, as `{ issues, truncated }`.
 * `truncated` is true when the page cap stopped the read with more to come,
 * so the caller can say so rather than hand over a short list as the whole
 * one. `fetchImpl` is the seam the tests use; production passes nothing and
 * gets the global fetch.
 */
export async function activeCycleIssues({ key, fetchImpl = fetch, timeoutMs = PAGE_TIMEOUT_MS } = {}) {
    if (!key) throw new LinearError("no LINEAR_API_KEY in the environment");
    const issues = [];
    let after = null;
    let truncated = false;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const res = await fetchImpl(ENDPOINT, {
            method: "POST",
            headers: { Authorization: key, "Content-Type": "application/json" },
            body: JSON.stringify({ query: QUERY, variables: { first: PAGE, after } }),
            signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        if (!res.ok) throw new LinearError(`Linear answered ${res.status}`);
        // A GraphQL error arrives as a 200 with an errors array, which reads
        // as success to anything that only checks the status.
        let body;
        try {
            body = JSON.parse(text);
        } catch {
            throw new LinearError("Linear answered with something that is not JSON");
        }
        if (body.errors?.length) throw new LinearError("Linear refused the query");
        const conn = body.data?.issues;
        if (!conn) throw new LinearError("Linear answered without an issues list");
        for (const n of conn.nodes || []) {
            issues.push({
                identifier: n.identifier, title: n.title || "", url: n.url || "",
                priority: Number(n.priority || 0), dueDate: n.dueDate || "", project: n.project?.name || "",
            });
        }
        if (!conn.pageInfo?.hasNextPage) break;
        after = conn.pageInfo.endCursor;
        truncated = page === MAX_PAGES - 1;
    }
    return { issues, truncated };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
    const [command] = process.argv.slice(2);
    if (command !== "issues") {
        console.error("usage: node linear.mjs issues");
        process.exit(2);
    }
    try {
        const read = await activeCycleIssues({ key: process.env.LINEAR_API_KEY || "" });
        process.stdout.write(`${JSON.stringify(read, null, 2)}\n`);
    } catch (error) {
        // Only this file's own words leave it. Anything else (a network
        // failure, a timeout, a bug) is said as one fixed phrase.
        console.error(error instanceof LinearError ? error.message : "the Linear request did not complete");
        process.exit(1);
    }
}
