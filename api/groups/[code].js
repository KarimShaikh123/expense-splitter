const { neon } = require("@neondatabase/serverless");
const { toKarachiIso } = require("../lib/http.js");
const { normalizeCode, CODE_PATTERN } = require("../lib/groups.js");

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

  res.status(200).json({
    group: {
      code: group.code,
      name: group.name,
      currency: group.currency,
      createdAt: toKarachiIso(group.created_at)
    },
    members: memberRows.map((m) => ({ id: Number(m.id), name: m.name })),
    expenses: [],
    balances: [],
    settlements: []
  });
};

module.exports.normalizeCode = normalizeCode;
