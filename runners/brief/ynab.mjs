#!/usr/bin/env node
// The YNAB side of the brief runner, beside its entrypoint (runners/brief/ynab.mjs).
// Three commands, no dependencies, node 20 or later:
//
//   node ynab.mjs pull <out-dir> <today>
//       For each budget named in YNAB_BUDGETS ("Personal=<id>,Atelic=<id>"):
//       the accounts, the categories, the payees, the unapproved queue, and
//       every transaction since the first of the month three full months
//       before <today>. Writes <out-dir>/ynab-<name>.json per budget, the name
//       lowercased. Amounts are dollars (YNAB's milliunits divided by 1000),
//       outflows negative. Exits non zero when any budget cannot be read.
//
//   node ynab.mjs week <out-dir> <today>
//       Reads the files pull wrote and writes <out-dir>/spend.json: for each
//       budget the typical spend so far this month against the pace, the
//       outliers, the trips, and the accounts whose direct import is in
//       error. Pure arithmetic over the files; no network. A budget whose
//       file is missing is null in the output, never an error.
//
//   node ynab.mjs apply <out-dir> <rows.json>
//       Approves the rows at their categories: rows.json is an array of
//       {budget, id, category} where category is a name spelled as the
//       pull spelled it. A memo is never written here; a memo is a decision. Resolves the name to an id through the pulled
//       categories, PATCHes one batch per budget, and prints
//       {ynab: [applied rows], dropped: [{kind, id, reason}]} as JSON. A row
//       whose category name does not resolve is dropped, never guessed, and
//       a budget whose PATCH fails drops all of its rows with the reason.
//
// Credentials: YNAB_API_KEY, a personal access token, as a bearer token.
//
// The split between typical and outlier is the rule the Weekly Read in the
// treasurer agent asks for, made exact so it can be printed under the table:
// typical is recurring spend, outliers are the single big charges and the
// trips. See RULE below for the sentence the mail prints.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const API = "https://api.ynab.com/v1";
const log = (s) => process.stderr.write(`ynab: ${s}\n`);

// A single charge at or above this many dollars, from a payee seen in fewer
// than RECURRING_MONTHS distinct months of the window, is an outlier.
export const OUTLIER_DOLLARS = Number(process.env.YNAB_OUTLIER_DOLLARS || 500);
export const RECURRING_MONTHS = Number(process.env.YNAB_RECURRING_MONTHS || 3);
// Personal categories that never count as typical (the treasurer's Weekly
// Read exclusions); matched on the category name containing the word.
export const EXCLUDED_WORDS = (process.env.YNAB_EXCLUDED_CATEGORIES || "Adventure,Legal,Home Improvement")
    .split(",").map((s) => s.trim()).filter(Boolean);
// Memos that start with an emoji but are not trips: matched at the start of
// the words after the emoji, never anywhere inside, so a trip named
// "🇹🇭 Thailand w/ Jas" stays a trip.
export const NON_TRIP_MEMOS = (process.env.YNAB_NON_TRIP_MEMOS || "Business Coffee,Client Coffee,Sold ,HSA ,w/ ")
    .split(",").filter(Boolean);

export const RULE = `Typical spend is every categorized row this month except outliers and trips; the pace is the average of the three full months before it, prorated to today. An outlier is a single charge of $${OUTLIER_DOLLARS} or more from a payee seen in fewer than ${RECURRING_MONTHS} months of the window, so the mortgage and the HOA stay typical. A trip is any row whose memo opens with an emoji and a name. ${EXCLUDED_WORDS.join(", ")} never count as typical on Personal.`;

/* ---------- http ---------- */

async function api(path) {
    const key = process.env.YNAB_API_KEY || "";
    if (!key) throw new Error("YNAB_API_KEY is not set");
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`GET ${path} ${res.status} ${(await res.text()).slice(0, 200)}`);
    return (await res.json()).data;
}

async function patch(path, body) {
    const key = process.env.YNAB_API_KEY || "";
    if (!key) throw new Error("YNAB_API_KEY is not set");
    const res = await fetch(`${API}${path}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`PATCH ${path} ${res.status} ${(await res.text()).slice(0, 200)}`);
    return (await res.json()).data;
}

/* ---------- dates ---------- */

export const dollars = (milli) => Math.round(milli) / 1000;

/** "2026-10-19" -> {year, month, day}. */
const parts = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return { year: y, month: m, day: d };
};
const pad = (n) => String(n).padStart(2, "0");
export const monthOf = (iso) => iso.slice(0, 7);
export const daysInMonth = (iso) => {
    const { year, month } = parts(iso);
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
};
/** The first day of the month `back` months before the month of `iso`. */
export const monthsBack = (iso, back) => {
    const { year, month } = parts(iso);
    const d = new Date(Date.UTC(year, month - 1 - back, 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
};

/* ---------- pull ---------- */

export function budgetsFromEnv(raw = process.env.YNAB_BUDGETS || "") {
    const out = [];
    for (const pair of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
        const eq = pair.indexOf("=");
        if (eq < 1) throw new Error(`YNAB_BUDGETS entry "${pair}" is not Name=id`);
        out.push({ name: pair.slice(0, eq).trim(), id: pair.slice(eq + 1).trim() });
    }
    if (out.length === 0) throw new Error("YNAB_BUDGETS is empty; expected Name=id pairs");
    return out;
}

function flattenCategories(groups) {
    const out = [];
    for (const g of groups || []) {
        for (const c of g.categories || []) {
            out.push({ id: c.id, name: c.name, group: g.name, hidden: Boolean(c.hidden), deleted: Boolean(c.deleted) });
        }
    }
    return out;
}

function shapeTransaction(t) {
    return {
        id: t.id,
        date: t.date,
        amount: dollars(t.amount),
        payeeId: t.payee_id || null,
        payeeName: t.payee_name || "",
        categoryId: t.category_id || null,
        categoryName: t.category_name || "",
        memo: t.memo || "",
        approved: Boolean(t.approved),
        transferAccountId: t.transfer_account_id || null,
        accountName: t.account_name || "",
        cleared: t.cleared || "",
        flagColor: t.flag_color || null,
        deleted: Boolean(t.deleted),
        // A split keeps its parts: the parent carries no category of its own,
        // so the spend lives in the parts and the arithmetic reads them.
        subtransactions: (t.subtransactions || []).filter((s) => !s.deleted).map((s) => ({
            id: s.id,
            amount: dollars(s.amount),
            categoryId: s.category_id || null,
            categoryName: s.category_name || "",
            payeeName: s.payee_name || t.payee_name || "",
            memo: s.memo || t.memo || "",
            transferAccountId: s.transfer_account_id || null,
        })),
    };
}

/** A transaction as the rows the arithmetic reads: itself, or its parts when it is a split. */
export const spendRows = (t) => (t.subtransactions && t.subtransactions.length > 0
    ? t.subtransactions.map((s) => ({ ...s, date: t.date, accountName: t.accountName, deleted: false }))
    : [t]);

async function pull(outDir, today) {
    mkdirSync(outDir, { recursive: true });
    const since = monthsBack(today, 3);
    for (const budget of budgetsFromEnv()) {
        const base = `/budgets/${budget.id}`;
        const [accounts, categories, payees, queue, transactions] = await Promise.all([
            api(`${base}/accounts`),
            api(`${base}/categories`),
            api(`${base}/payees`),
            api(`${base}/transactions?type=unapproved`),
            api(`${base}/transactions?since_date=${since}`),
        ]);
        // Two files per budget. The model reads the first (the queue, the
        // accounts, the categories), which stays small; the three months of
        // history and the payee list go beside it for the arithmetic and the
        // apply, since 400 rows of history is more than the model's Read
        // takes in one go and it needs none of them.
        const file = {
            budget,
            pulledAt: new Date().toISOString(),
            since,
            accounts: (accounts.accounts || []).filter((a) => !a.deleted).map((a) => ({
                id: a.id, name: a.name, onBudget: Boolean(a.on_budget), closed: Boolean(a.closed),
                directImportLinked: Boolean(a.direct_import_linked), directImportInError: Boolean(a.direct_import_in_error),
            })),
            categories: flattenCategories(categories.category_groups),
            queue: (queue.transactions || []).filter((t) => !t.deleted).map(shapeTransaction),
        };
        const history = {
            budget,
            since,
            payees: (payees.payees || []).filter((p) => !p.deleted).map((p) => ({ id: p.id, name: p.name })),
            transactions: (transactions.transactions || []).filter((t) => !t.deleted).map(shapeTransaction),
        };
        const stem = join(outDir, `ynab-${budget.name.toLowerCase()}`);
        writeFileSync(`${stem}.json`, JSON.stringify(file, null, 1));
        writeFileSync(`${stem}-history.json`, JSON.stringify(history));
        log(`${budget.name}: ${file.queue.length} unapproved, ${history.transactions.length} since ${since}, ${file.accounts.filter((a) => a.directImportInError && !a.closed).length} accounts in error`);
    }
}

/* ---------- week ---------- */

const isSpend = (t) => !t.transferAccountId && t.categoryId && !/^Inflow/.test(t.categoryName) && !t.deleted;
const isExcluded = (t) => EXCLUDED_WORDS.some((w) => t.categoryName.includes(w));
// A flag is two regional indicators, which Unicode keeps apart from the
// pictographs, so both classes open a trip memo.
const EMOJI_START = /^(\p{Extended_Pictographic}|\p{Regional_Indicator})/u;
export const isTripMemo = (memo) => {
    const m = (memo || "").trim();
    if (!EMOJI_START.test(m)) return false;
    const rest = m.replace(/^[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}‍️\s]+/u, "");
    if (!/^[A-Z]/.test(rest)) return false;
    return !NON_TRIP_MEMOS.some((x) => rest.startsWith(x.trimStart()));
};

/**
 * The split for one budget. `personal` turns on the category exclusions.
 * Months are the three full months before `today`'s month.
 */
export function spendFor(file, today, personal) {
    const month = monthOf(today);
    const windowMonths = [3, 2, 1].map((b) => monthOf(monthsBack(today, b)));
    const rows = file.transactions.flatMap(spendRows).filter(isSpend);
    const monthsByPayee = new Map();
    for (const t of rows) {
        const key = t.payeeName.toLowerCase();
        if (!monthsByPayee.has(key)) monthsByPayee.set(key, new Set());
        monthsByPayee.get(key).add(monthOf(t.date));
    }
    const isOutlier = (t) => Math.abs(t.amount) >= OUTLIER_DOLLARS
        && (monthsByPayee.get(t.payeeName.toLowerCase())?.size || 0) < RECURRING_MONTHS;
    const classify = (t) => {
        if (isTripMemo(t.memo)) return "trip";
        if (personal && isExcluded(t)) return "excluded";
        if (isOutlier(t)) return "outlier";
        return "typical";
    };
    const totals = new Map(windowMonths.map((m) => [m, 0]));
    let spent = 0;
    const outliers = [];
    const trips = new Map();
    for (const t of rows) {
        const kind = classify(t);
        const m = monthOf(t.date);
        if (kind === "typical") {
            if (m === month) spent += t.amount;
            else if (totals.has(m)) totals.set(m, totals.get(m) + t.amount);
        } else if (m === month && kind === "outlier") {
            outliers.push({ date: t.date, payee: t.payeeName, amount: t.amount, category: t.categoryName, memo: t.memo });
        } else if (m === month && kind === "trip") {
            const memo = t.memo.trim();
            const cur = trips.get(memo) || { memo, total: 0, count: 0 };
            cur.total += t.amount;
            cur.count += 1;
            trips.set(memo, cur);
        }
    }
    const months = windowMonths.map((m) => ({ month: m, total: round(totals.get(m)) }));
    const monthlyAverage = months.reduce((a, b) => a + b.total, 0) / months.length;
    const { day } = parts(today);
    const dim = daysInMonth(today);
    outliers.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    return {
        month,
        dayOfMonth: day,
        daysInMonth: dim,
        typical: { spent: round(spent), pace: round(monthlyAverage * day / dim), monthlyAverage: round(monthlyAverage), months },
        outliers: outliers.map((o) => ({ ...o, amount: round(o.amount) })),
        trips: [...trips.values()].map((t) => ({ ...t, total: round(t.total) })),
        accountsInError: file.accounts.filter((a) => a.directImportLinked && a.directImportInError && !a.closed).map((a) => a.name),
        rule: RULE,
    };
}

const round = (n) => Math.round(n * 100) / 100;

/** Both files of a budget as the one object spendFor and apply read; null when the pull is not on disk. */
function readBudget(outDir, name) {
    try {
        const file = JSON.parse(readFileSync(join(outDir, `ynab-${name}.json`), "utf8"));
        let history = { payees: [], transactions: [] };
        try {
            history = JSON.parse(readFileSync(join(outDir, `ynab-${name}-history.json`), "utf8"));
        } catch {
            // An older pull kept everything in one file; read what is there.
        }
        return { ...file, payees: file.payees || history.payees || [], transactions: file.transactions || history.transactions || [] };
    } catch {
        return null;
    }
}

function week(outDir, today) {
    const personal = readBudget(outDir, "personal");
    const atelic = readBudget(outDir, "atelic");
    const out = {
        personal: personal ? spendFor(personal, today, true) : null,
        atelic: atelic ? spendFor(atelic, today, false) : null,
    };
    writeFileSync(join(outDir, "spend.json"), JSON.stringify(out));
    for (const [name, s] of Object.entries(out)) {
        if (s) log(`${name}: typical ${s.typical.spent} against a pace of ${s.typical.pace}, ${s.outliers.length} outliers, ${s.trips.length} trips`);
        else log(`${name}: no pull on disk, skipped`);
    }
}

/* ---------- apply ---------- */

async function apply(outDir, rowsPath) {
    const rows = JSON.parse(readFileSync(rowsPath, "utf8"));
    const applied = [];
    const dropped = [];
    const byBudget = new Map();
    for (const r of rows) {
        const name = String(r.budget || "").toLowerCase();
        if (!byBudget.has(name)) byBudget.set(name, []);
        byBudget.get(name).push(r);
    }
    for (const [name, list] of byBudget) {
        const file = readBudget(outDir, name);
        if (!file) {
            for (const r of list) dropped.push({ kind: "ynab", id: r.id, reason: `no pull on disk for the ${r.budget} budget` });
            continue;
        }
        // A name that two groups share resolves to nothing, never to the
        // last one written; the row is dropped and the mail says why.
        const categories = new Map();
        const ambiguous = new Set();
        for (const c of file.categories.filter((c) => !c.deleted && !c.hidden)) {
            if (categories.has(c.name)) ambiguous.add(c.name);
            categories.set(c.name, c.id);
        }
        for (const name of ambiguous) categories.delete(name);
        const queue = new Map(file.queue.map((t) => [t.id, t]));
        const batch = [];
        for (const r of list) {
            const t = queue.get(r.id);
            if (t?.transferAccountId) { dropped.push({ kind: "ynab", id: r.id, reason: "a transfer is approved uncategorized by the Monday session, never categorized here" }); continue; }
            // A split is categorized in its parts; one category on the parent
            // would collapse them, so the session handles it by hand.
            if (t?.subtransactions?.length > 0) { dropped.push({ kind: "ynab", id: r.id, reason: "a split transaction is categorized in its parts by the Monday session, never here" }); continue; }
            if (!t) { dropped.push({ kind: "ynab", id: r.id, reason: "not in the unapproved queue this run" }); continue; }
            const categoryId = categories.get(r.category);
            if (!categoryId) {
                const why = ambiguous.has(r.category) ? `category ${r.category} names two groups on ${file.budget.name}` : `category ${r.category} not found on ${file.budget.name}`;
                dropped.push({ kind: "ynab", id: r.id, reason: why });
                continue;
            }
            const row = { id: r.id, category_id: categoryId, approved: true };
            // A high row is an approval at a category and nothing more: a memo
            // (a trip, a note) is a decision in the prompt's own terms and is
            // written by the Monday session on Forni's nod, never here.
            batch.push(row);
            applied.push({ budget: file.budget.name, id: r.id, payee: t.payeeName, amount: t.amount, category: r.category, date: t.date });
        }
        if (batch.length === 0) continue;
        try {
            const result = await patch(`/budgets/${file.budget.id}/transactions`, { transactions: batch });
            const ids = new Set((result.transaction_ids || []).concat((result.transactions || []).map((t) => t.id)));
            const missing = batch.filter((b) => ids.size > 0 && !ids.has(b.id));
            for (const m of missing) {
                dropped.push({ kind: "ynab", id: m.id, reason: "not in the batch response" });
                const i = applied.findIndex((a) => a.id === m.id);
                if (i >= 0) applied.splice(i, 1);
            }
            log(`${file.budget.name}: approved ${batch.length - missing.length} of ${batch.length}`);
        } catch (e) {
            for (const b of batch) {
                dropped.push({ kind: "ynab", id: b.id, reason: `batch failed: ${String(e.message).slice(0, 160)}` });
                const i = applied.findIndex((a) => a.id === b.id);
                if (i >= 0) applied.splice(i, 1);
            }
            log(`${file.budget.name}: batch failed, ${e.message}`);
        }
    }
    process.stdout.write(JSON.stringify({ ynab: applied, dropped }));
}

/* ---------- main ---------- */

async function main() {
    const [cmd, outDir, arg] = process.argv.slice(2);
    if (cmd === "pull" && outDir && arg) return pull(outDir, arg);
    if (cmd === "week" && outDir && arg) return week(outDir, arg);
    if (cmd === "apply" && outDir && arg) return apply(outDir, arg);
    process.stderr.write("usage: ynab.mjs pull <out-dir> <today> | week <out-dir> <today> | apply <out-dir> <rows.json>\n");
    process.exit(2);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((e) => { log(e.message); process.exit(1); });
}
