const { neon } = require("@neondatabase/serverless");
const { readJsonBody, toKarachiIso } = require("../../../lib/http.js");
const { normalizeCode, CODE_PATTERN } = require("../../../lib/groups.js");
const { validateExpense, karachiWeekBounds, EXPENSE_LIMIT } = require("../../../lib/expenses.js");

async function countGroupExpenses(sql, groupId) {
  const rows = await sql.query("SELECT COUNT(*) AS count FROM expenses WHERE group_id = $1", [groupId]);
  return Number(rows[0].count);
}

async function addExpense(sql, groupId, expense) {
  const values = [];
  const params = [
    groupId,
    expense.description,
    expense.amountCents,
    expense.paidBy,
    expense.splitType,
    expense.date
  ];
  expense.shares.forEach((share, i) => {
    values.push("($" + (7 + i * 2) + "::bigint, $" + (8 + i * 2) + "::integer)");
    params.push(share.memberId, share.shareCents);
  });
  const rows = await sql.query(
    "WITH e AS (" +
      "INSERT INTO expenses (group_id, description, amount_cents, paid_by, split_type, expense_date) " +
      "VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at, updated_at" +
      ") " +
      "INSERT INTO expense_shares (expense_id, member_id, share_cents) " +
      "SELECT e.id, v.member_id, v.share_cents FROM e, (VALUES " + values.join(", ") + ") v(member_id, share_cents) " +
      "RETURNING expense_id, member_id, share_cents",
    params
  );
  return { id: Number(rows[0].expense_id), rows };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const code = normalizeCode(req.query && req.query.code);
  if (!CODE_PATTERN.test(code)) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const body = await readJsonBody(req);
  if (!body) {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }
  if (body.__oversized) {
    res.status(400).json({ error: "Payload too large" });
    return;
  }

  if (!process.env.DATABASE_URL) {
    res.status(500).json({ error: "Database not configured" });
    return;
  }

  const sql = neon(process.env.DATABASE_URL);

  let groupRows;
  try {
    groupRows = await sql.query("SELECT id FROM groups WHERE code = $1", [code]);
  } catch (err) {
    res.status(500).json({ error: "Could not add the expense" });
    return;
  }
  if (groupRows.length === 0) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  const groupId = groupRows[0].id;

  let count;
  let memberRows;
  try {
    count = await countGroupExpenses(sql, groupId);
    memberRows = await sql.query("SELECT id FROM members WHERE group_id = $1", [groupId]);
  } catch (err) {
    res.status(500).json({ error: "Could not add the expense" });
    return;
  }

  if (count >= EXPENSE_LIMIT) {
    res.status(429).json({ error: "Expense limit reached (" + EXPENSE_LIMIT + "). Delete one to add another." });
    return;
  }

  const memberIds = memberRows.map((m) => Number(m.id));
  const validation = validateExpense(body, memberIds, karachiWeekBounds());
  if (validation.error) {
    res.status(400).json({ error: validation.error });
    return;
  }

  let created;
  try {
    created = await addExpense(sql, groupId, validation.expense);
  } catch (err) {
    res.status(500).json({ error: "Could not add the expense" });
    return;
  }

  res.status(201).json({
    id: created.id,
    description: validation.expense.description,
    amountCents: validation.expense.amountCents,
    paidBy: validation.expense.paidBy,
    splitType: validation.expense.splitType,
    date: validation.expense.date,
    shares: validation.expense.shares
  });
};

module.exports.addExpense = addExpense;
module.exports.countGroupExpenses = countGroupExpenses;
