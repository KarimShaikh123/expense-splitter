const { test } = require("node:test");
const assert = require("node:assert");
const { computeBalances, settle } = require("../api/lib/settle.js");

function expense(amountCents, paidBy, shares) {
  return { amountCents, paidBy, shares: shares.map(([memberId, shareCents]) => ({ memberId, shareCents })) };
}

test("computeBalances: the Flat 4B walkthrough", () => {
  const expenses = [
    expense(420000, 1, [[1, 140000], [2, 140000], [3, 140000]]),
    expense(360000, 2, [[1, 180000], [2, 180000]]),
    expense(250000, 3, [[1, 100000], [2, 100000], [3, 50000]])
  ];
  assert.deepStrictEqual(computeBalances([1, 2, 3], expenses), [
    { memberId: 1, balanceCents: 0 },
    { memberId: 2, balanceCents: -60000 },
    { memberId: 3, balanceCents: 60000 }
  ]);
});

test("computeBalances: payer who is not a participant is still credited", () => {
  const balances = computeBalances([1, 2, 3], [expense(50000, 1, [[2, 25000], [3, 25000]])]);
  assert.deepStrictEqual(balances, [
    { memberId: 1, balanceCents: 50000 },
    { memberId: 2, balanceCents: -25000 },
    { memberId: 3, balanceCents: -25000 }
  ]);
});

test("computeBalances: untouched members stay at zero, empty expenses zero everyone", () => {
  assert.deepStrictEqual(computeBalances([1, 2], []), [
    { memberId: 1, balanceCents: 0 },
    { memberId: 2, balanceCents: 0 }
  ]);
  const balances = computeBalances([1, 2, 3], [expense(100, 1, [[1, 100]])]);
  assert.deepStrictEqual(balances.find((b) => b.memberId === 2), { memberId: 2, balanceCents: 0 });
});

test("computeBalances rejects payers/participants that are not members", () => {
  assert.throws(() => computeBalances([1], [expense(100, 99, [[1, 100]])]), /payer/);
  assert.throws(() => computeBalances([1], [expense(100, 1, [[99, 100]])]), /participant/);
});

test("settle: Ali pays Sana 600 — the walkthrough result", () => {
  const balances = [
    { memberId: 1, balanceCents: 0 },
    { memberId: 2, balanceCents: -60000 },
    { memberId: 3, balanceCents: 60000 }
  ];
  assert.deepStrictEqual(settle(balances), [{ from: 2, to: 3, amountCents: 60000 }]);
});

test("settle: the four-person walkthrough runs exactly three rounds", () => {
  const balances = [
    { memberId: 1, balanceCents: 500 },
    { memberId: 2, balanceCents: 100 },
    { memberId: 3, balanceCents: -400 },
    { memberId: 4, balanceCents: -200 }
  ];
  assert.deepStrictEqual(settle(balances), [
    { from: 3, to: 1, amountCents: 400 },
    { from: 4, to: 1, amountCents: 100 },
    { from: 4, to: 2, amountCents: 100 }
  ]);
});

test("settle: all settled up means no payments", () => {
  assert.deepStrictEqual(settle([{ memberId: 1, balanceCents: 0 }, { memberId: 2, balanceCents: 0 }]), []);
});

test("settle: one debtor paying several creditors, biggest creditor first", () => {
  const balances = [
    { memberId: 1, balanceCents: 300 },
    { memberId: 2, balanceCents: 200 },
    { memberId: 3, balanceCents: -500 }
  ];
  assert.deepStrictEqual(settle(balances), [
    { from: 3, to: 1, amountCents: 300 },
    { from: 3, to: 2, amountCents: 200 }
  ]);
});

test("settle: payments always settle everyone exactly and never exceed n-1", () => {
  const cases = [
    [{ memberId: 1, balanceCents: 7 }, { memberId: 2, balanceCents: -7 }],
    [
      { memberId: 1, balanceCents: 33334 },
      { memberId: 2, balanceCents: 33333 },
      { memberId: 3, balanceCents: -66667 }
    ],
    [
      { memberId: 1, balanceCents: 100 },
      { memberId: 2, balanceCents: -50 },
      { memberId: 3, balanceCents: -50 }
    ]
  ];
  for (const balances of cases) {
    const payments = settle(balances);
    assert.ok(payments.length <= balances.length - 1, "at most n-1 payments");
    const net = new Map(balances.map((b) => [b.memberId, b.balanceCents]));
    for (const p of payments) {
      net.set(p.from, net.get(p.from) + p.amountCents);
      net.set(p.to, net.get(p.to) - p.amountCents);
    }
    for (const value of net.values()) assert.strictEqual(value, 0, "everyone settles exactly");
  }
});

test("settle: ties break by member id, deterministically", () => {
  const balances = [
    { memberId: 5, balanceCents: -100 },
    { memberId: 2, balanceCents: -100 },
    { memberId: 9, balanceCents: 100 },
    { memberId: 3, balanceCents: 100 }
  ];
  const first = settle(balances);
  const second = settle(balances);
  assert.deepStrictEqual(first, second);
  assert.strictEqual(first[0].from, 2, "biggest-debtor tie goes to the lower member id");
  assert.strictEqual(first[0].to, 3, "biggest-creditor tie goes to the lower member id");
});

test("settle: throws when balances do not sum to zero", () => {
  assert.throws(
    () => settle([{ memberId: 1, balanceCents: 100 }, { memberId: 2, balanceCents: -99 }]),
    /invariant broken/
  );
});
