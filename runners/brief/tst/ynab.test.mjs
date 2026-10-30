// The arithmetic behind the Money section, held on invented rows so a change
// to the split is a change to a row here. Run with: node --test runners/brief/tst/
import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetsFromEnv, dollars, isTripMemo, monthsBack, spendFor } from "../ynab.mjs";

const TODAY = "2026-10-19";

const t = (date, amount, payee, category = "🛒 Groceries", memo = "") => ({
    id: `${date}-${payee}`, date, amount, payeeName: payee, categoryId: "c", categoryName: category, memo,
    transferAccountId: null, deleted: false,
});

const file = (transactions, accounts = []) => ({ budget: { name: "Personal", id: "p" }, accounts, categories: [], payees: [], queue: [], transactions });

test("milliunits become dollars", () => {
    assert.equal(dollars(-42100), -42.1);
    assert.equal(dollars(1750000), 1750);
});

test("the window opens on the first of the month three months back", () => {
    assert.equal(monthsBack("2026-10-19", 3), "2026-07-01");
    assert.equal(monthsBack("2026-01-15", 1), "2025-12-01");
});

test("YNAB_BUDGETS parses Name=id pairs and refuses a bare name", () => {
    assert.deepEqual(budgetsFromEnv("Personal=p1, Atelic=a1"), [{ name: "Personal", id: "p1" }, { name: "Atelic", id: "a1" }]);
    assert.throws(() => budgetsFromEnv("Personal"));
});

test("a trip memo opens with an emoji and a name; the practice's memo conventions do not", () => {
    assert.equal(isTripMemo("🇹🇭 Thailand"), true);
    assert.equal(isTripMemo("🏔️ Crested Butte"), true);
    assert.equal(isTripMemo("☕️ Business Coffee"), false);
    assert.equal(isTripMemo("☕️ Client Coffee"), false);
    assert.equal(isTripMemo("🤝 w/ Titus, working dinner"), false);
    assert.equal(isTripMemo("🇹🇭 Thailand w/ Jas"), true);
    assert.equal(isTripMemo("🇮🇹 Italy Coffee Tour"), true);
    assert.equal(isTripMemo("🪙 Sold ETH"), false);
    assert.equal(isTripMemo("🏥 HSA premium reimbursement"), false);
    assert.equal(isTripMemo("groceries for the week"), false);
    assert.equal(isTripMemo(""), false);
});

test("typical spend is the recurring rows; the pace is the three month average prorated", () => {
    const rows = [
        // Three full months of the mortgage and groceries, one big recurring payee.
        ...["2026-07", "2026-08", "2026-09"].flatMap((m) => [
            t(`${m}-01`, -2000, "Onity", "🏡 Housing"),
            t(`${m}-10`, -300, "Sprouts"),
        ]),
        // This month so far: the mortgage, groceries, a surgery, a trip charge, an adventure charge.
        t("2026-10-01", -2000, "Onity", "🏡 Housing"),
        t("2026-10-05", -150, "Sprouts"),
        t("2026-10-06", -1850, "Dr. Lowy", "🏥 Healthcare"),
        t("2026-10-08", -120, "Airbnb", "🏠 Lodging", "🇹🇭 Thailand"),
        t("2026-10-09", -400, "United Airlines", "🌏 Adventure"),
        // A transfer and an inflow never count.
        { ...t("2026-10-10", -500, "Transfer: Savings", "🏦 Transfer"), transferAccountId: "x" },
        t("2026-10-11", 3000, "Employer", "Inflow: Ready to Assign"),
    ];
    const s = spendFor(file(rows), TODAY, true);
    assert.equal(s.month, "2026-10");
    assert.equal(s.dayOfMonth, 19);
    assert.equal(s.daysInMonth, 31);
    assert.deepEqual(s.typical.months.map((m) => m.total), [-2300, -2300, -2300]);
    assert.equal(s.typical.monthlyAverage, -2300);
    assert.equal(s.typical.pace, Math.round(-2300 * 19 / 31 * 100) / 100);
    assert.equal(s.typical.spent, -2150);
    assert.deepEqual(s.outliers.map((o) => o.payee), ["Dr. Lowy"]);
    assert.deepEqual(s.trips, [{ memo: "🇹🇭 Thailand", total: -120, count: 1 }]);
});

test("the mortgage stays typical because it recurs, and the exclusions only bite on Personal", () => {
    const rows = [
        ...["2026-07", "2026-08", "2026-09", "2026-10"].map((m) => t(`${m}-01`, -2000, "Onity", "🏡 Housing")),
        t("2026-10-03", -600, "Home Depot", "🏡 Home Improvement"),
    ];
    const personal = spendFor(file(rows), TODAY, true);
    assert.equal(personal.typical.spent, -2000);
    assert.equal(personal.outliers.length, 0);
    const atelic = spendFor(file(rows), TODAY, false);
    // On Atelic nothing is excluded by name, so the one off is an outlier by size.
    assert.equal(atelic.typical.spent, -2000);
    assert.deepEqual(atelic.outliers.map((o) => o.payee), ["Home Depot"]);
});

test("a split transaction counts through its parts, not its uncategorized parent", () => {
    const split = {
        id: "split", date: "2026-10-12", amount: -150, payeeName: "Costco", categoryId: null, categoryName: "", memo: "",
        transferAccountId: null, deleted: false, accountName: "Card",
        subtransactions: [
            { id: "s1", amount: -100, categoryId: "c", categoryName: "🛒 Groceries", payeeName: "Costco", memo: "", transferAccountId: null },
            { id: "s2", amount: -50, categoryId: "c", categoryName: "🧥 Clothing", payeeName: "Costco", memo: "", transferAccountId: null },
        ],
    };
    const s = spendFor(file([split]), TODAY, true);
    assert.equal(s.typical.spent, -150);
});

test("accounts in error are the open, linked ones", () => {
    const accounts = [
        { name: "BofA Checking", closed: false, directImportLinked: true, directImportInError: true },
        { name: "Old Card", closed: true, directImportLinked: true, directImportInError: true },
        { name: "Cash", closed: false, directImportLinked: false, directImportInError: false },
    ];
    assert.deepEqual(spendFor(file([], accounts), TODAY, true).accountsInError, ["BofA Checking"]);
});
