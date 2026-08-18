const { randomInt } = require("crypto");
const { isUniqueViolation } = require("./http.js");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const MAX_ATTEMPTS = 5;
const MAX_GROUP_NAME_LENGTH = 50;
const MAX_MEMBER_NAME_LENGTH = 30;
const MIN_MEMBERS = 2;
const MAX_MEMBERS = 20;
const CURRENCIES = ["PKR", "USD", "GBP", "EUR", "AED", "SAR", "CAD"];

function generateCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function normalizeCode(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function validateNewGroup(body) {
  if (!body || typeof body !== "object") return { error: "Invalid JSON body" };

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > MAX_GROUP_NAME_LENGTH) {
    return { error: "Group name must be 1-" + MAX_GROUP_NAME_LENGTH + " characters." };
  }

  if (!Array.isArray(body.members)) {
    return { error: "Members must be a list of names." };
  }
  if (body.members.length < MIN_MEMBERS) {
    return { error: "A group needs at least " + MIN_MEMBERS + " members." };
  }
  if (body.members.length > MAX_MEMBERS) {
    return { error: "A group can have at most " + MAX_MEMBERS + " members." };
  }

  const members = [];
  const seen = new Set();
  for (const raw of body.members) {
    const member = typeof raw === "string" ? raw.trim() : "";
    if (member.length < 1 || member.length > MAX_MEMBER_NAME_LENGTH) {
      return { error: "Member names must be 1-" + MAX_MEMBER_NAME_LENGTH + " characters." };
    }
    const key = member.toLowerCase();
    if (seen.has(key)) {
      return { error: "Duplicate member name: " + member + "." };
    }
    seen.add(key);
    members.push(member);
  }

  let currency = "PKR";
  if (body.currency !== undefined) {
    if (typeof body.currency !== "string" || !CURRENCIES.includes(body.currency.trim().toUpperCase())) {
      return { error: "Currency must be one of: " + CURRENCIES.join(", ") + "." };
    }
    currency = body.currency.trim().toUpperCase();
  }

  return { group: { name, members, currency } };
}

function validateMemberName(body) {
  if (!body || typeof body !== "object") return { error: "Invalid JSON body" };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > MAX_MEMBER_NAME_LENGTH) {
    return { error: "Member names must be 1-" + MAX_MEMBER_NAME_LENGTH + " characters." };
  }
  return { name };
}

async function createGroup(sql, input) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateCode();
    let group;
    try {
      const rows = await sql.query(
        "INSERT INTO groups (code, name, currency) VALUES ($1, $2, $3) RETURNING id, code, name, currency, created_at",
        [code, input.name, input.currency]
      );
      group = rows[0];
    } catch (err) {
      if (isUniqueViolation(err)) continue;
      throw err;
    }
    const placeholders = [];
    const params = [];
    input.members.forEach((member, i) => {
      placeholders.push("($" + (i * 2 + 1) + ", $" + (i * 2 + 2) + ")");
      params.push(group.id, member);
    });
    const memberRows = await sql.query(
      "INSERT INTO members (group_id, name) VALUES " + placeholders.join(", ") + " RETURNING id, name",
      params
    );
    memberRows.sort((a, b) => Number(a.id) - Number(b.id));
    return {
      code: group.code,
      name: group.name,
      currency: group.currency,
      createdAt: group.created_at,
      members: memberRows.map((m) => ({ id: Number(m.id), name: m.name }))
    };
  }
  throw new Error("could not find a free group code");
}

module.exports = {
  generateCode,
  normalizeCode,
  validateNewGroup,
  validateMemberName,
  createGroup,
  CODE_PATTERN,
  MAX_ATTEMPTS,
  MAX_GROUP_NAME_LENGTH,
  MAX_MEMBER_NAME_LENGTH,
  MIN_MEMBERS,
  MAX_MEMBERS,
  CURRENCIES
};
