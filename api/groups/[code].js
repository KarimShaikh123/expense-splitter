const { neon } = require("@neondatabase/serverless");
const { toKarachiIso, toKarachiDate } = require("../lib/http.js");
const { normalizeCode, CODE_PATTERN } = require("../lib/groups.js");
const { computeBalances, settle } = require("../lib/settle.js");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const code = normalizeCode(req.query && req.query.code);
  if (!CODE_PATTERN.test(code)) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  if (!process.env.DATABASE_URL) {
    res.status(500).json({ error: "Database not configured" });
    return;
  }

  const sql = neon(process.env.DATABASE_URL);

  let groupRows;
  try {
    groupRows = await sql.query(
      "SELECT id, code, name, currency, created_at FROM groups WHERE code = $1",
      [code]
    );
  } catch (err) {
    res.status(500).json({ error: "Could not load the group" });
    return;
  }
  if (groupRows.length === 0) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  const group = groupRows[0];

  let memberRows;
  try {
    memberRows = await sql.query(
      "SELECT id, name FROM members WHERE group_id = $1 ORDER BY id",
      [group.id]
    );
  } catch (err) {
    res.status(500).json({ error: "Could not load the group" });
    return;
  }

  let expenseRows;
  try {
    expenseRows = await sql.query(
      "SELECT ex.id, ex.description, ex.amount_cents, ex.paid_by, ex.split_type, ex.expense_date, " +
        "ex.created_at, ex.updated_at, s.member_id, s.share_cents " +
        "FROM expenses ex JOIN expense_shares s ON s.expense_id = ex.id " +
        "WHERE ex.group_id = $1 " +
        "ORDER BY ex.expense_date DESC, ex.id DESC, s.member_id",
      [group.id]
    );
  } catch (err) {
    res.status(500).json({ error: "Could not load the group" });
    return;
  }

  const expensesById = new Map();
  for (const row of expenseRows) {
    let expense = expensesById.get(row.id);
    if (!expense) {
      expense = {
        id: Number(row.id),
        description: row.description,
        amountCents: row.amount_cents,
        paidBy: Number(row.paid_by),
        splitType: row.split_type,
        date: toKarachiDate(row.expense_date),
        createdAt: toKarachiIso(row.created_at),
        updatedAt: toKarachiIso(row.updated_at),
        shares: []
      };
      expensesById.set(row.id, expense);
    }
    expense.shares.push({ memberId: Number(row.member_id), shareCents: row.share_cents });
  }
  const expenses = Array.from(expensesById.values());

  for (const expense of expenses) {
    const shareSum = expense.shares.reduce((sum, s) => sum + s.shareCents, 0);
    if (shareSum !== expense.amountCents) {
      res.status(500).json({ error: "Data inconsistency — expense shares do not sum to its amount" });
      return;
    }
  }

  let balances;
  let settlements;
  try {
    balances = computeBalances(memberRows.map((m) => Number(m.id)), expenses);
    settlements = settle(balances);
  } catch (err) {
    res.status(500).json({ error: "Data inconsistency — balances do not sum to zero" });
    return;
  }

  res.status(200).json({
    group: {
      code: group.code,
      name: group.name,
      currency: group.currency,
      createdAt: toKarachiIso(group.created_at)
    },
    members: memberRows.map((m) => ({ id: Number(m.id), name: m.name })),
    expenses,
    balances,
    settlements
  });
};

module.exports.normalizeCode = normalizeCode;
