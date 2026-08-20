const MAX_DESCRIPTION_LENGTH = 100;
const MAX_AMOUNT_CENTS = 1000000000;
const EXPENSE_LIMIT = 500;
const SPLIT_TYPES = ["equal", "exact"];

function karachiWeekBounds(now = new Date()) {
  const shifted = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const today = shifted.toISOString().slice(0, 10);
  const day = shifted.getUTCDay();
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  const sunday = new Date(shifted.getTime() + daysUntilSunday * 24 * 60 * 60 * 1000);
  return { today, weekEnd: sunday.toISOString().slice(0, 10) };
}

function isValidExpenseDate(value, bounds) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    return false;
  }
  return value <= bounds.weekEnd;
}

function resolveEqualShares(amountCents, participantIds) {
  const base = Math.floor(amountCents / participantIds.length);
  const remainder = amountCents % participantIds.length;
  return participantIds.map((memberId, i) => ({
    memberId,
    shareCents: base + (i < remainder ? 1 : 0)
  }));
}

function validateExpense(body, memberIds, bounds) {
  if (!body || typeof body !== "object") return { error: "Invalid JSON body" };

  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (description.length < 1 || description.length > MAX_DESCRIPTION_LENGTH) {
    return { error: "Description must be 1-" + MAX_DESCRIPTION_LENGTH + " characters." };
  }

  const amountCents = body.amountCents;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { error: "Amount must be a positive whole number of paisa." };
  }
  if (amountCents > MAX_AMOUNT_CENTS) {
    return { error: "Amount must be at most Rs 10,000,000." };
  }

  if (!SPLIT_TYPES.includes(body.splitType)) {
    return { error: "Split type must be 'equal' or 'exact'." };
  }

  if (!memberIds.includes(body.paidBy)) {
    return { error: "Payer must be a member of the group." };
  }

  if (!isValidExpenseDate(body.date, bounds)) {
    return { error: "Date must be a real date (YYYY-MM-DD) no later than this week's Sunday." };
  }

  let shares;
  if (body.splitType === "equal") {
    if (!Array.isArray(body.participants) || body.participants.length === 0) {
      return { error: "Pick at least one participant." };
    }
    const seen = new Set();
    for (const id of body.participants) {
      if (!memberIds.includes(id)) return { error: "Every participant must be a member of the group." };
      if (seen.has(id)) return { error: "A participant appears twice." };
      seen.add(id);
    }
    shares = resolveEqualShares(amountCents, body.participants);
  } else {
    if (!Array.isArray(body.participants) || body.participants.length === 0) {
      return { error: "Pick at least one participant." };
    }
    const seen = new Set();
    shares = [];
    for (const entry of body.participants) {
      if (!entry || typeof entry !== "object" || !memberIds.includes(entry.memberId)) {
        return { error: "Every participant must be a member of the group." };
      }
      if (seen.has(entry.memberId)) return { error: "A participant appears twice." };
      if (!Number.isInteger(entry.shareCents) || entry.shareCents < 0) {
        return { error: "Each exact share must be a whole number of paisa (0 or more)." };
      }
      seen.add(entry.memberId);
      shares.push({ memberId: entry.memberId, shareCents: entry.shareCents });
    }
    const total = shares.reduce((sum, s) => sum + s.shareCents, 0);
    if (total !== amountCents) {
      return { error: "Exact shares must add up to the total amount." };
    }
  }

  const shareSum = shares.reduce((sum, s) => sum + s.shareCents, 0);
  if (shareSum !== amountCents) {
    throw new Error("invariant broken: shares " + shareSum + " != amount " + amountCents);
  }

  return {
    expense: {
      description,
      amountCents,
      paidBy: body.paidBy,
      splitType: body.splitType,
      date: body.date,
      shares
    }
  };
}

module.exports = {
  karachiWeekBounds,
  isValidExpenseDate,
  resolveEqualShares,
  validateExpense,
  MAX_DESCRIPTION_LENGTH,
  MAX_AMOUNT_CENTS,
  EXPENSE_LIMIT,
  SPLIT_TYPES
};
