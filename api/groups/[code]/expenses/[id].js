const { neon } = require("@neondatabase/serverless");
const { readJsonBody } = require("../../../lib/http.js");
const { normalizeCode, CODE_PATTERN } = require("../../../lib/groups.js");
const { validateExpense, karachiWeekBounds } = require("../../../lib/expenses.js");

async function replaceExpense(sql, expenseId, groupId, expense) {
  const updated = await sql.query(
    "UPDATE expenses SET description = $3, amount_cents = $4, paid_by = $5, split_type = $6, expense_date = $7, updated_at = now() " +
      "WHERE id = $1 AND group_id = $2 RETURNING id",
    [expenseId, groupId, expense.description, expense.amountCents, expense.paidBy, expense.splitType, expense.date]
  );
  if (updated.length === 0) return null;
  await sql.query("DELETE FROM expense_shares WHERE expense_id = $1", [expenseId]);
  const values = [];
  const params = [];
  expense.shares.forEach((share, i) => {
    values.push("($" + (i * 3 + 1) + ", $" + (i * 3 + 2) + ", $" + (i * 3 + 3) + ")");
    params.push(expenseId, share.memberId, share.shareCents);
  });
  await sql.query(
    "INSERT INTO expense_shares (expense_id, member_id, share_cents) VALUES " + values.join(", "),
    params
  );
  return expenseId;
}

module.exports = async function handler(req, res) {
  if (req.method !== "PUT" && req.method !== "DELETE") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const code = normalizeCode(req.query && req.query.code);
  if (!CODE_PATTERN.test(code)) {
    res.status(404).json({ error: "Group not found" });
    return;
  }

  const expenseId = Number(req.query && req.query.id);
  if (!Number.isInteger(expenseId) || expenseId <= 0) {
    res.status(404).json({ error: "Expense not found" });
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
    res.status(500).json({ error: "Could not update the expense" });
    return;
  }
  if (groupRows.length === 0) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  const groupId = groupRows[0].id;

  if (req.method === "DELETE") {
    let deleted;
    try {
      deleted = await sql.query(
        "DELETE FROM expenses WHERE id = $1 AND group_id = $2 RETURNING id",
        [expenseId, groupId]
      );
    } catch (err) {
      res.status(500).json({ error: "Could not delete the expense" });
      return;
    }
    if (deleted.length === 0) {
      res.status(404).json({ error: "Expense not found" });
      return;
    }
    res.status(200).json({ id: expenseId });
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

  let memberRows;
  let existing;
  try {
    memberRows = await sql.query("SELECT id FROM members WHERE group_id = $1", [groupId]);
    existing = await sql.query("SELECT id FROM expenses WHERE id = $1 AND group_id = $2", [expenseId, groupId]);
  } catch (err) {
    res.status(500).json({ error: "Could not update the expense" });
    return;
  }
  if (existing.length === 0) {
    res.status(404).json({ error: "Expense not found" });
    return;
  }

  const memberIds = memberRows.map((m) => Number(m.id));
  const validation = validateExpense(body, memberIds, karachiWeekBounds());
  if (validation.error) {
    res.status(400).json({ error: validation.error });
    return;
  }

  try {
    await replaceExpense(sql, expenseId, groupId, validation.expense);
  } catch (err) {
    res.status(500).json({ error: "Could not update the expense" });
    return;
  }

  res.status(200).json({
    id: expenseId,
    description: validation.expense.description,
    amountCents: validation.expense.amountCents,
    paidBy: validation.expense.paidBy,
    splitType: validation.expense.splitType,
    date: validation.expense.date,
    shares: validation.expense.shares
  });
};

module.exports.replaceExpense = replaceExpense;
