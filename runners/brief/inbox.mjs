#!/usr/bin/env node
// The inbox side of the brief runner, beside its entrypoint (runners/brief/inbox.mjs).
// Two commands, no dependencies, node 20 or later:
//
//   node inbox.mjs pull <out-dir>
//       Every message sitting in the inbox of each mailbox whose token is in
//       the environment, with its headers, snippet, label names, and a link,
//       plus the mailbox's label list (names and ids) so a later apply can
//       resolve a name. Writes <out-dir>/inbox-personal.json and
//       <out-dir>/inbox-atelic.json, one per mailbox read. A mailbox whose
//       token is absent is skipped and said so; a mailbox whose list call
//       fails fails the pull, since the clerk's rules need the whole bag or
//       nothing.
//
//   node inbox.mjs apply <out-dir> <rows.json>
//       rows.json is an array of {mailbox, id, labels: [names], archive: bool}.
//       Adds each named label (resolved through the pulled label list, never
//       created), and on archive removes INBOX and UNREAD. Prints
//       {gmail: [applied rows], dropped: [{kind, id, reason}]} as JSON. A row
//       naming a label the mailbox does not have is dropped whole, never
//       partly applied.
//
// Access tokens arrive in the environment, minted by the entrypoint from the
// vaulted authorized_user JSON for each profile (google_access_token in
// runners/lib/runner.sh):
//   GMAIL_TOKEN_PERSONAL    the personal mailbox
//   GMAIL_TOKEN_ATELIC      the practice's mailbox
// The addresses behind them, for the links the mail prints, come from
// MAILBOX_ADDRESSES ("personal=<address>,atelic=<address>"); a link built on
// authuser opens in the right account whichever one the browser has first.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const log = (s) => process.stderr.write(`inbox: ${s}\n`);
const MAX_MESSAGES = Number(process.env.INBOX_MAX_MESSAGES || 200);
const POOL = 6;

export const addressesFromEnv = (raw = process.env.MAILBOX_ADDRESSES || "personal=mattforni@gmail.com,atelic=matt@atelic.me") => {
    const out = {};
    for (const pair of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
        const eq = pair.indexOf("=");
        if (eq > 0) out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }
    return out;
};

// Unemployment insurance mail is deadline bearing and never archived by a
// machine, and the runner's own weekly reports (the brief, the recruiter
// board, the pipeline board) are read by Forni and the Monday session after
// this run, so the runner never marks them read or archives them either.
export const NEVER_ARCHIVE = /state\.co\.us|cdle|myui|colorado division of unemployment|claude@atelic\.me/i;

/** The bare address inside a From header, lowercased. */
export const addressOf = (from) => {
    const m = String(from || "").match(/<([^>]+)>/);
    return (m ? m[1] : String(from || "")).trim().toLowerCase();
};
/** Forni's own addresses; a reply of his in a thread is not another correspondent. */
const OWN = new Set(Object.values(addressesFromEnv()).map((a) => a.toLowerCase()).concat(["claude@atelic.me"]));

const MAILBOXES = [
    ["personal", process.env.GMAIL_TOKEN_PERSONAL || ""],
    ["atelic", process.env.GMAIL_TOKEN_ATELIC || ""],
];

/* ---------- http ---------- */

async function gmail(token, path, { method = "GET", body, params } = {}) {
    const url = new URL(`${API}/${path}`);
    for (const [k, v] of Object.entries(params || {})) {
        if (Array.isArray(v)) for (const x of v) url.searchParams.append(k, x);
        else if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    for (let attempt = 1; ; attempt += 1) {
        const res = await fetch(url, {
            method,
            headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(30000),
        });
        if (res.ok) return res.json();
        const text = (await res.text()).slice(0, 200);
        const retry = res.status === 429 || res.status >= 500;
        if (retry && attempt < 5) {
            await new Promise((r) => setTimeout(r, 2000 * attempt));
            continue;
        }
        throw new Error(`${method} ${path} ${res.status} ${text}`);
    }
}

async function pool(items, size, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i], i);
        }
    };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
    return out;
}

/* ---------- pull ---------- */

const header = (msg, name) => (msg.payload?.headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

export function shapeMessage(msg, labelNames, address) {
    const ids = msg.labelIds || [];
    const starred = ids.filter((l) => l.endsWith("_STAR") || l === "STARRED");
    return {
        id: msg.id,
        threadId: msg.threadId,
        from: header(msg, "From"),
        to: header(msg, "To"),
        subject: header(msg, "Subject"),
        date: header(msg, "Date"),
        internalDate: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : "",
        snippet: msg.snippet || "",
        labels: ids.filter((l) => !/^(INBOX|UNREAD|STARRED|IMPORTANT|CATEGORY_|SENT|DRAFT|.*_STAR$)/.test(l)).map((l) => labelNames.get(l) || l),
        unread: ids.includes("UNREAD"),
        starred: starred.length > 0,
        stars: starred,
        link: `https://mail.google.com/mail/?authuser=${encodeURIComponent(address)}#inbox/${msg.id}`,
    };
}

async function pullMailbox(name, token, address) {
    const labelsRes = await gmail(token, "labels");
    const labels = (labelsRes.labels || []).map((l) => ({ id: l.id, name: l.name, type: l.type }));
    const labelNames = new Map(labels.map((l) => [l.id, l.name]));
    const ids = [];
    let pageToken;
    do {
        const page = await gmail(token, "messages", { params: { q: "in:inbox", maxResults: 100, pageToken } });
        for (const m of page.messages || []) ids.push(m.id);
        pageToken = page.nextPageToken;
    } while (pageToken && ids.length < MAX_MESSAGES);
    const messages = await pool(ids, POOL, (id) => gmail(token, `messages/${id}`, {
        params: { format: "metadata", metadataHeaders: ["From", "To", "Subject", "Date"] },
    }).then((m) => shapeMessage(m, labelNames, address)));
    messages.sort((a, b) => (a.internalDate < b.internalDate ? 1 : -1));
    log(`${name}: ${messages.length} in the inbox, ${labels.length} labels`);
    return { address, labels, messages, truncated: Boolean(pageToken) };
}

// One file per mailbox, pretty printed with a one space indent: the model
// reads these with a tool that takes a file by lines, and a mailbox of a few
// hundred messages on one line is more than it can take in.
const mailboxFile = (outDir, name) => join(outDir, `inbox-${name}.json`);

async function pull(outDir) {
    mkdirSync(outDir, { recursive: true });
    const addresses = addressesFromEnv();
    let read = 0, failed = 0;
    for (const [name, token] of MAILBOXES) {
        if (!token) {
            log(`${name}: no token in the environment, skipped`);
            continue;
        }
        // One mailbox failing costs that mailbox, not the other: its file is
        // simply absent, which the entrypoint's ledger and the prompt both
        // read as not read. Both failing fails the pull.
        try {
            const box = await pullMailbox(name, token, addresses[name] || "");
            writeFileSync(mailboxFile(outDir, name), JSON.stringify({ mailbox: name, pulledAt: new Date().toISOString(), ...box }, null, 1));
            read += 1;
        } catch (e) {
            log(`${name}: not read, ${String(e.message).slice(0, 160)}`);
            failed += 1;
        }
    }
    if (read === 0 && failed > 0) throw new Error("no mailbox could be read");
}

function readMailbox(outDir, name) {
    try {
        return JSON.parse(readFileSync(mailboxFile(outDir, name), "utf8"));
    } catch {
        return null;
    }
}

/* ---------- apply ---------- */

async function apply(outDir, rowsPath) {
    const rows = JSON.parse(readFileSync(rowsPath, "utf8"));
    const tokens = Object.fromEntries(MAILBOXES);
    const applied = [];
    const dropped = [];
    for (const r of rows) {
        const mailbox = String(r.mailbox || "").toLowerCase();
        const box = readMailbox(outDir, mailbox);
        const token = tokens[mailbox];
        if (!box || !token) { dropped.push({ kind: "gmail", id: r.id, reason: `mailbox ${mailbox} was not pulled this run` }); continue; }
        const msg = box.messages.find((m) => m.id === r.id);
        if (!msg) { dropped.push({ kind: "gmail", id: r.id, reason: "not in the inbox this run" }); continue; }
        const byName = new Map(box.labels.map((l) => [l.name, l.id]));
        const add = [];
        let missing = null;
        for (const name of r.labels || []) {
            const id = byName.get(name);
            if (!id) { missing = name; break; }
            add.push(id);
        }
        if (missing) { dropped.push({ kind: "gmail", id: r.id, reason: `label ${missing} not found in the ${mailbox} mailbox` }); continue; }
        // The one hard rule in the sender rules, enforced here as well as in
        // the prompt: unemployment insurance mail is deadline bearing and is
        // never archived unread by a machine, whatever band it was given.
        if (r.archive && NEVER_ARCHIVE.test(`${msg.from} ${msg.subject}`)) {
            dropped.push({ kind: "gmail", id: r.id, reason: "CDLE, MyUI+ and the runner's own reports are never archived by the runner" });
            continue;
        }
        const remove = r.archive ? ["INBOX", "UNREAD"] : [];
        if (add.length === 0 && remove.length === 0) { dropped.push({ kind: "gmail", id: r.id, reason: "nothing to change" }); continue; }
        try {
            // The thread, not the message: Gmail keeps a thread in the inbox
            // while any message in it carries INBOX, so a message level
            // archive of a two message thread archives nothing. The rule was
            // read against one message, so before the whole thread moves,
            // every message in it is read: a protected sender anywhere in it,
            // or a second correspondent (a person who replied), and the
            // thread stays for the Monday session.
            if (r.archive) {
                const thread = await gmail(token, `threads/${msg.threadId}`, { params: { format: "metadata", metadataHeaders: ["From", "Subject"] } });
                const others = (thread.messages || []).filter((m) => m.id !== msg.id);
                const protectedOne = others.find((m) => NEVER_ARCHIVE.test(`${header(m, "From")} ${header(m, "Subject")}`));
                if (protectedOne) { dropped.push({ kind: "gmail", id: r.id, reason: "another message in the thread is protected mail; the thread stays" }); continue; }
                const strangers = others.filter((m) => addressOf(header(m, "From")) !== addressOf(msg.from) && !OWN.has(addressOf(header(m, "From"))));
                if (strangers.length > 0) { dropped.push({ kind: "gmail", id: r.id, reason: `the thread holds ${strangers.length} message${strangers.length === 1 ? "" : "s"} from another sender; the session decides` }); continue; }
            }
            await gmail(token, `threads/${msg.threadId}/modify`, { method: "POST", body: { addLabelIds: add, removeLabelIds: remove } });
            applied.push({ mailbox, id: r.id, subject: msg.subject, from: msg.from, labels: r.labels || [], archived: Boolean(r.archive) });
        } catch (e) {
            dropped.push({ kind: "gmail", id: r.id, reason: String(e.message).slice(0, 160) });
        }
    }
    log(`applied ${applied.length}, dropped ${dropped.length}`);
    process.stdout.write(JSON.stringify({ gmail: applied, dropped }));
}

/* ---------- main ---------- */

async function main() {
    const [cmd, outDir, arg] = process.argv.slice(2);
    if (cmd === "pull" && outDir) return pull(outDir);
    if (cmd === "apply" && outDir && arg) return apply(outDir, arg);
    process.stderr.write("usage: inbox.mjs pull <out-dir> | apply <out-dir> <rows.json>\n");
    process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((e) => { log(e.message); process.exit(1); });
}
