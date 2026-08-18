const { neon } = require("@neondatabase/serverless");
const { readJsonBody, toKarachiIso } = require("../lib/http.js");
const { validateNewGroup, createGroup } = require("../lib/groups.js");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
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

  const validation = validateNewGroup(body);
  if (validation.error) {
    res.status(400).json({ error: validation.error });
    return;
  }

  if (!process.env.DATABASE_URL) {
    res.status(500).json({ error: "Database not configured" });
    return;
  }

  const sql = neon(process.env.DATABASE_URL);

  let group;
  try {
    group = await createGroup(sql, validation.group);
  } catch (err) {
    res.status(500).json({ error: "Could not create the group" });
    return;
  }

  res.status(201).json({
    code: group.code,
    name: group.name,
    currency: group.currency,
    createdAt: toKarachiIso(group.createdAt),
    members: group.members
  });
};

module.exports.validateNewGroup = validateNewGroup;
module.exports.createGroup = createGroup;
