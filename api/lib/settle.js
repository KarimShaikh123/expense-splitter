function computeBalances(memberIds, expenses) {
  const byMember = new Map(memberIds.map((id) => [id, 0]));
  for (const expense of expenses) {
    if (!byMember.has(expense.paidBy)) {
      throw new Error("payer " + expense.paidBy + " is not a member");
    }
    byMember.set(expense.paidBy, byMember.get(expense.paidBy) + expense.amountCents);
    for (const share of expense.shares) {
      if (!byMember.has(share.memberId)) {
        throw new Error("participant " + share.memberId + " is not a member");
      }
      byMember.set(share.memberId, byMember.get(share.memberId) - share.shareCents);
    }
  }
  return memberIds.map((id) => ({ memberId: id, balanceCents: byMember.get(id) }));
}

function settle(balances) {
  const sum = balances.reduce((s, b) => s + b.balanceCents, 0);
  if (sum !== 0) {
    throw new Error("invariant broken: balances sum to " + sum + ", expected 0");
  }

  const debtors = balances
    .filter((b) => b.balanceCents < 0)
    .map((b) => ({ memberId: b.memberId, left: -b.balanceCents }));
  const creditors = balances
    .filter((b) => b.balanceCents > 0)
    .map((b) => ({ memberId: b.memberId, left: b.balanceCents }));

  const byLargestFirst = (a, b) => b.left - a.left || a.memberId - b.memberId;
  debtors.sort(byLargestFirst);
  creditors.sort(byLargestFirst);

  const payments = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].left, creditors[j].left);
    payments.push({ from: debtors[i].memberId, to: creditors[j].memberId, amountCents: amount });
    debtors[i].left -= amount;
    creditors[j].left -= amount;
    if (debtors[i].left === 0) i++;
    if (creditors[j].left === 0) j++;
  }
  return payments;
}

module.exports = { computeBalances, settle };
