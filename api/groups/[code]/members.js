const { neon } = require("@neondatabase/serverless");
const { readJsonBody, isUniqueViolation } = require("../../lib/http.js");
const { normalizeCode, validateMemberName, CODE_PATTERN, MAX_MEMBERS } = require("../../lib/groups.js");

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

  const validation = validateMemberName(body);
  if (validation.error) {
    res.status(400).json({ error: validation.error });
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
    res.status(500).json({ error: "Could not add the member" });
    return;
  }
  if (groupRows.length === 0) {
    res.status(404).json({ error: "Group not found" });
    return;
  }
  const groupId = groupRows[0].id;

  let countRows;
  let memberRows;
  try {
    countRows = await sql.query("SELECT COUNT(*) AS count FROM members WHERE group_id = $1", [groupId]);
    memberRows = await sql.query("SELECT name FROM members WHERE group_id = $1", [groupId]);
  } catch (err) {
    res.status(500).json({ error: "Could not add the member" });
    return;
  }

  if (Number(countRows[0].count) >= MAX_MEMBERS) {
    res.status(429).json({ error: "Member limit reached (" + MAX_MEMBERS + ")." });
    return;
  }

  const newKey = validation.name.toLowerCase();
  const duplicate = memberRows.find((m) => m.name.toLowerCase() === newKey);
  if (duplicate) {
    res.status(409).json({ error: duplicate.name + " is already a member." });
    return;
  }

  let inserted;
  try {
    const rows = await sql.query(
      "INSERT INTO members (group_id, name) VALUES ($1, $2) RETURNING id, name",
      [groupId, validation.name]
    );
    inserted = rows[0];
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: validation.name + " is already a member." });
      return;
    }
    res.status(500).json({ error: "Could not add the member" });
    return;
  }

  res.status(201).json({ id: Number(inserted.id), name: inserted.name });
};
