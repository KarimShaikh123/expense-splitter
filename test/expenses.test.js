const { test } = require("node:test");
const assert = require("node:assert");
const expenses = require("../api/lib/expenses.js");
const addHandler = require("../api/groups/[code]/expenses/index.js");
const itemHandler = require("../api/groups/[code]/expenses/[id].js");

function fakeRes() {
  const res = {
    statusCode: null,
    payload: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.payload = payload;
      return res;
    }
  };
  return res;
}

const MEMBERS = [1, 2, 3];
const BOUNDS = { today: "2026-08-18", weekEnd: "2026-08-23" };

test("resolveEqualShares deals the floor plus one paisa to the first participants", () => {
  assert.deepStrictEqual(expenses.resolveEqualShares(100000, [1, 2, 3]), [
    { memberId: 1, shareCents: 33334 },
    { memberId: 2, shareCents: 33333 },
    { memberId: 3, shareCents: 33333 }
  ]);
  assert.deepStrictEqual(expenses.resolveEqualShares(10, [1, 2, 3]), [
    { memberId: 1, shareCents: 4 },
    { memberId: 2, shareCents: 3 },
    { memberId: 3, shareCents: 3 }
  ]);
  assert.deepStrictEqual(expenses.resolveEqualShares(7, [1, 2]), [
    { memberId: 1, shareCents: 4 },
    { memberId: 2, shareCents: 3 }
  ]);
  assert.deepStrictEqual(expenses.resolveEqualShares(999, [1]), [{ memberId: 1, shareCents: 999 }]);
});

test("resolveEqualShares always sums to the amount", () => {
  for (const amount of [1, 2, 99, 1000, 100001, 1000000000]) {
    for (const ids of [[1], [1, 2], [1, 2, 3], [1, 2, 3, 4, 5, 6, 7]]) {
      const sum = expenses.resolveEqualShares(amount, ids).reduce((s, x) => s + x.shareCents, 0);
      assert.strictEqual(sum, amount, "amount " + amount + " across " + ids.length);
    }
  }
});

test("karachiWeekBounds returns today and this week's Sunday in Karachi time", () => {
  const tuesday = expenses.karachiWeekBounds(new Date("2026-08-18T09:00:00Z"));
  assert.deepStrictEqual(tuesday, { today: "2026-08-18", weekEnd: "2026-08-23" });

  const sundayKarachi = expenses.karachiWeekBounds(new Date("2026-08-23T10:00:00Z"));
  assert.deepStrictEqual(sundayKarachi, { today: "2026-08-23", weekEnd: "2026-08-23" });

  const saturdayKarachi = expenses.karachiWeekBounds(new Date("2026-08-22T12:00:00Z"));
  assert.strictEqual(saturdayKarachi.weekEnd, "2026-08-23");

  const lateUtcCrossesIntoWednesday = expenses.karachiWeekBounds(new Date("2026-08-18T19:30:00Z"));
  assert.strictEqual(lateUtcCrossesIntoWednesday.today, "2026-08-19");
});

test("isValidExpenseDate accepts real dates up to the week's Sunday", () => {
  assert.strictEqual(expenses.isValidExpenseDate("2026-08-23", BOUNDS), true);
  assert.strictEqual(expenses.isValidExpenseDate("2026-08-18", BOUNDS), true);
  assert.strictEqual(expenses.isValidExpenseDate("2020-01-01", BOUNDS), true);
});

test("isValidExpenseDate rejects future-week, impossible, and malformed dates", () => {
  assert.strictEqual(expenses.isValidExpenseDate("2026-08-24", BOUNDS), false);
  assert.strictEqual(expenses.isValidExpenseDate("2027-01-01", BOUNDS), false);
  assert.strictEqual(expenses.isValidExpenseDate("2026-02-30", BOUNDS), false);
  assert.strictEqual(expenses.isValidExpenseDate("2026-13-01", BOUNDS), false);
  assert.strictEqual(expenses.isValidExpenseDate("18-08-2026", BOUNDS), false);
  assert.strictEqual(expenses.isValidExpenseDate("2026-8-18", BOUNDS), false);
  assert.strictEqual(expenses.isValidExpenseDate(42, BOUNDS), false);
});

test("validateExpense accepts an equal split and resolves shares", () => {
  const result = expenses.validateExpense(
    { description: " Dinner ", amountCents: 100000, paidBy: 1, splitType: "equal", participants: [1, 2, 3], date: "2026-08-18" },
    MEMBERS,
    BOUNDS
  );
  assert.strictEqual(result.error, undefined);
  assert.strictEqual(result.expense.description, "Dinner");
  assert.strictEqual(result.expense.shares[0].shareCents, 33334);
});

test("validateExpense accepts an exact split that sums to the total (zero shares allowed)", () => {
  const result = expenses.validateExpense(
    {
      description: "Internet",
      amountCents: 250000,
      paidBy: 3,
      splitType: "exact",
      participants: [
        { memberId: 1, shareCents: 100000 },
        { memberId: 2, shareCents: 100000 },
        { memberId: 3, shareCents: 50000 }
      ],
      date: "2026-08-18"
    },
    MEMBERS,
    BOUNDS
  );
  assert.strictEqual(result.error, undefined);
  assert.strictEqual(result.expense.shares.length, 3);
});

test("validateExpense rejects bad descriptions and amounts", () => {
  const base = { amountCents: 100, paidBy: 1, splitType: "equal", participants: [1], date: "2026-08-18" };
  assert.match(expenses.validateExpense({ ...base, description: "" }, MEMBERS, BOUNDS).error, /description/i);
  assert.match(expenses.validateExpense({ ...base, description: "x".repeat(101) }, MEMBERS, BOUNDS).error, /description/i);
  assert.match(expenses.validateExpense({ ...base, description: "ok", amountCents: 0 }, MEMBERS, BOUNDS).error, /amount/i);
  assert.match(expenses.validateExpense({ ...base, description: "ok", amountCents: -5 }, MEMBERS, BOUNDS).error, /amount/i);
  assert.match(expenses.validateExpense({ ...base, description: "ok", amountCents: 10.5 }, MEMBERS, BOUNDS).error, /amount/i);
  assert.match(expenses.validateExpense({ ...base, description: "ok", amountCents: "100" }, MEMBERS, BOUNDS).error, /amount/i);
});

test("validateExpense accepts Rs 10,000,000 and rejects one paisa more", () => {
  const base = { description: "ok", paidBy: 1, splitType: "equal", participants: [1], date: "2026-08-18" };
  assert.strictEqual(expenses.validateExpense({ ...base, amountCents: 1000000000 }, MEMBERS, BOUNDS).error, undefined);
  assert.match(expenses.validateExpense({ ...base, amountCents: 1000000001 }, MEMBERS, BOUNDS).error, /at most/i);
});

test("validateExpense rejects bad split types, payers, dates, and participants", () => {
  const base = { description: "ok", amountCents: 100, splitType: "equal", participants: [1], date: "2026-08-18" };
  assert.match(expenses.validateExpense({ ...base, paidBy: 99 }, MEMBERS, BOUNDS).error, /payer/i);
  assert.match(expenses.validateExpense({ ...base, paidBy: 1, splitType: "half" }, MEMBERS, BOUNDS).error, /split type/i);
  assert.match(expenses.validateExpense({ ...base, paidBy: 1, date: "2026-08-24" }, MEMBERS, BOUNDS).error, /date/i);
  assert.match(expenses.validateExpense({ ...base, paidBy: 1, participants: [] }, MEMBERS, BOUNDS).error, /participant/i);
  assert.match(expenses.validateExpense({ ...base, paidBy: 1, participants: [1, 99] }, MEMBERS, BOUNDS).error, /member of the group/i);
  assert.match(expenses.validateExpense({ ...base, paidBy: 1, participants: [1, 1] }, MEMBERS, BOUNDS).error, /twice/i);
});

test("validateExpense rejects exact splits that do not sum to the total", () => {
  const base = { description: "ok", amountCents: 100, paidBy: 1, splitType: "exact", date: "2026-08-18" };
  const offByOne = expenses.validateExpense(
    { ...base, participants: [{ memberId: 1, shareCents: 60 }, { memberId: 2, shareCents: 39 }] },
    MEMBERS,
    BOUNDS
  );
  assert.match(offByOne.error, /add up/i);
  const negative = expenses.validateExpense(
    { ...base, participants: [{ memberId: 1, shareCents: -1 }, { memberId: 2, shareCents: 101 }] },
    MEMBERS,
    BOUNDS
  );
  assert.match(negative.error, /whole number/i);
});

test("add handler rejects non-POST, malformed codes, and malformed JSON before any DB access", async () => {
  const wrongMethod = fakeRes();
  await addHandler({ method: "GET", query: { code: "K4B2QX" } }, wrongMethod);
  assert.strictEqual(wrongMethod.statusCode, 405);

  const badCode = fakeRes();
  await addHandler({ method: "POST", query: { code: "bad" }, body: {} }, badCode);
  assert.strictEqual(badCode.statusCode, 404);

  const { EventEmitter } = require("node:events");
  const req = new EventEmitter();
  req.method = "POST";
  req.query = { code: "K4B2QX" };
  const badJson = fakeRes();
  const done = addHandler(req, badJson);
  req.emit("data", "{not json");
  req.emit("end");
  await done;
  assert.strictEqual(badJson.statusCode, 400);
  assert.match(badJson.payload.error, /invalid json/i);
});

test("item handler rejects unsupported methods and malformed ids before any DB access", async () => {
  const wrongMethod = fakeRes();
  await itemHandler({ method: "POST", query: { code: "K4B2QX", id: "1" } }, wrongMethod);
  assert.strictEqual(wrongMethod.statusCode, 405);

  const badCode = fakeRes();
  await itemHandler({ method: "DELETE", query: { code: "bad", id: "1" } }, badCode);
  assert.strictEqual(badCode.statusCode, 404);

  const badId = fakeRes();
  await itemHandler({ method: "DELETE", query: { code: "K4B2QX", id: "abc" } }, badId);
  assert.strictEqual(badId.statusCode, 404);

  const zeroId = fakeRes();
  await itemHandler({ method: "DELETE", query: { code: "K4B2QX", id: "0" } }, zeroId);
  assert.strictEqual(zeroId.statusCode, 404);
});

test("limits are the Karim-approved values", () => {
  assert.strictEqual(expenses.EXPENSE_LIMIT, 500);
  assert.strictEqual(expenses.MAX_AMOUNT_CENTS, 1000000000);
  assert.strictEqual(expenses.MAX_DESCRIPTION_LENGTH, 100);
});
