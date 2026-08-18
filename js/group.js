const MOCK_GROUP = {
  group: { code: "K4B2QX", name: "Flat 4B", currency: "PKR", createdAt: "2026-08-13T12:00:00+05:00" },
  members: [
    { id: 1, name: "Karim" },
    { id: 2, name: "Ali" },
    { id: 3, name: "Sana" }
  ],
  expenses: [
    {
      id: 1,
      description: "Groceries — week 33",
      amountCents: 420000,
      paidBy: 1,
      splitType: "equal",
      date: "2026-08-14",
      shares: [
        { memberId: 1, shareCents: 140000 },
        { memberId: 2, shareCents: 140000 },
        { memberId: 3, shareCents: 140000 }
      ]
    },
    {
      id: 2,
      description: "Dinner at BBQ Tonight",
      amountCents: 360000,
      paidBy: 2,
      splitType: "equal",
      date: "2026-08-16",
      shares: [
        { memberId: 1, shareCents: 180000 },
        { memberId: 2, shareCents: 180000 }
      ]
    },
    {
      id: 3,
      description: "Internet bill",
      amountCents: 250000,
      paidBy: 3,
      splitType: "exact",
      date: "2026-08-17",
      shares: [
        { memberId: 1, shareCents: 100000 },
        { memberId: 2, shareCents: 100000 },
        { memberId: 3, shareCents: 50000 }
      ]
    }
  ],
  balances: [
    { memberId: 1, balanceCents: 0 },
    { memberId: 2, balanceCents: -60000 },
    { memberId: 3, balanceCents: 60000 }
  ],
  settlements: [{ from: 2, to: 3, amountCents: 60000 }]
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const CURRENCY_SYMBOLS = { PKR: "Rs", USD: "$", GBP: "£", EUR: "€", AED: "AED", SAR: "SAR", CAD: "C$" };

function memberName(id) {
  const member = MOCK_GROUP.members.find((m) => m.id === id);
  return member ? member.name : "?";
}

function formatMoney(cents) {
  const symbol = CURRENCY_SYMBOLS[MOCK_GROUP.group.currency] || MOCK_GROUP.group.currency;
  const amount = Math.abs(cents) / 100;
  return symbol + " " + amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return day + " " + MONTHS[month - 1] + " " + year;
}

function renderHead() {
  document.title = MOCK_GROUP.group.name + " — Split";
  document.getElementById("group-name").textContent = MOCK_GROUP.group.name;
  document.getElementById("group-code").textContent = MOCK_GROUP.group.code;
  const row = document.getElementById("member-row");
  row.textContent = "";
  for (const member of MOCK_GROUP.members) {
    const chip = document.createElement("span");
    chip.className = "member-chip";
    chip.textContent = member.name;
    row.appendChild(chip);
  }
}

function renderStats() {
  const total = MOCK_GROUP.expenses.reduce((sum, e) => sum + e.amountCents, 0);
  document.getElementById("stat-expenses").textContent = MOCK_GROUP.expenses.length;
  document.getElementById("stat-total").textContent = formatMoney(total);
  document.getElementById("stat-transfers").textContent = MOCK_GROUP.settlements.length;
}

function renderExpenses() {
  const body = document.getElementById("expense-body");
  const empty = document.getElementById("expense-empty");
  body.textContent = "";
  empty.hidden = MOCK_GROUP.expenses.length > 0;
  for (const expense of MOCK_GROUP.expenses) {
    const tr = document.createElement("tr");

    const dateTd = document.createElement("td");
    dateTd.className = "date";
    dateTd.textContent = formatDate(expense.date);

    const descTd = document.createElement("td");
    descTd.textContent = expense.description;

    const payerTd = document.createElement("td");
    payerTd.textContent = memberName(expense.paidBy);

    const splitTd = document.createElement("td");
    splitTd.className = "split";
    splitTd.textContent = expense.splitType === "equal" ? expense.shares.length + " ways" : "exact";

    const amountTd = document.createElement("td");
    amountTd.className = "amount";
    amountTd.textContent = formatMoney(expense.amountCents);

    const actionsTd = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const editButton = document.createElement("button");
    editButton.className = "edit-button";
    editButton.type = "button";
    editButton.dataset.id = expense.id;
    editButton.textContent = "Edit";
    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-button";
    deleteButton.type = "button";
    deleteButton.dataset.id = expense.id;
    deleteButton.textContent = "Delete";
    actions.appendChild(editButton);
    actions.appendChild(deleteButton);
    actionsTd.appendChild(actions);

    tr.appendChild(dateTd);
    tr.appendChild(descTd);
    tr.appendChild(payerTd);
    tr.appendChild(splitTd);
    tr.appendChild(amountTd);
    tr.appendChild(actionsTd);
    body.appendChild(tr);
  }
}

function renderBalances() {
  const list = document.getElementById("balance-list");
  list.textContent = "";
  for (const balance of MOCK_GROUP.balances) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = memberName(balance.memberId);
    const note = document.createElement("span");
    note.className = "balance-note";
    const amount = document.createElement("span");
    amount.className = "balance-amount";
    if (balance.balanceCents > 0) {
      note.textContent = "is owed";
      amount.classList.add("balance-pos");
      amount.textContent = "+ " + formatMoney(balance.balanceCents);
    } else if (balance.balanceCents < 0) {
      note.textContent = "owes";
      amount.classList.add("balance-neg");
      amount.textContent = "− " + formatMoney(balance.balanceCents);
    } else {
      note.textContent = "settled";
      amount.classList.add("balance-zero");
      amount.textContent = formatMoney(0);
    }
    li.appendChild(name);
    li.appendChild(note);
    li.appendChild(amount);
    list.appendChild(li);
  }
}

function renderSettlements() {
  const list = document.getElementById("settle-list");
  const empty = document.getElementById("settle-empty");
  list.textContent = "";
  empty.hidden = MOCK_GROUP.settlements.length > 0;
  for (const settlement of MOCK_GROUP.settlements) {
    const li = document.createElement("li");
    const from = document.createElement("span");
    from.textContent = memberName(settlement.from);
    const arrow = document.createElement("span");
    arrow.className = "settle-arrow";
    arrow.textContent = "pays";
    const to = document.createElement("span");
    to.textContent = memberName(settlement.to);
    const amount = document.createElement("span");
    amount.className = "settle-amount";
    amount.textContent = formatMoney(settlement.amountCents);
    li.appendChild(from);
    li.appendChild(arrow);
    li.appendChild(to);
    li.appendChild(amount);
    list.appendChild(li);
  }
}

function render() {
  renderHead();
  renderStats();
  renderExpenses();
  renderBalances();
  renderSettlements();
}

function buildSplitGrids() {
  const equalGrid = document.getElementById("split-equal");
  const exactGrid = document.getElementById("split-exact");
  for (const member of MOCK_GROUP.members) {
    const equalRow = document.createElement("label");
    equalRow.className = "split-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.dataset.memberId = member.id;
    equalRow.appendChild(checkbox);
    equalRow.appendChild(document.createTextNode(member.name));
    equalGrid.appendChild(equalRow);

    const exactRow = document.createElement("label");
    exactRow.className = "split-row";
    const amountInput = document.createElement("input");
    amountInput.type = "number";
    amountInput.min = "0";
    amountInput.step = "0.01";
    amountInput.placeholder = "0.00";
    amountInput.dataset.memberId = member.id;
    exactRow.appendChild(document.createTextNode(member.name));
    exactRow.appendChild(amountInput);
    exactGrid.appendChild(exactRow);
  }
}

function buildPayerSelect() {
  const select = document.getElementById("exp-payer");
  for (const member of MOCK_GROUP.members) {
    const option = document.createElement("option");
    option.value = member.id;
    option.textContent = member.name;
    select.appendChild(option);
  }
}

function initForm() {
  buildPayerSelect();
  buildSplitGrids();
  const today = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  document.getElementById("exp-date").value =
    today.getFullYear() + "-" + pad(today.getMonth() + 1) + "-" + pad(today.getDate());

  document.querySelectorAll("input[name='split-type']").forEach((radio) => {
    radio.addEventListener("change", () => {
      const exact = document.querySelector("input[name='split-type']:checked").value === "exact";
      document.getElementById("split-equal").hidden = exact;
      document.getElementById("split-exact").hidden = !exact;
    });
  });

  document.getElementById("expense-form").addEventListener("submit", (event) => {
    event.preventDefault();
  });
}

document.getElementById("copy-code").addEventListener("click", async () => {
  const button = document.getElementById("copy-code");
  const code = MOCK_GROUP.group.code;
  try {
    await navigator.clipboard.writeText(code);
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = "Copy";
    }, 1500);
  } catch {
    window.prompt("Copy the group code:", code);
  }
});

render();
initForm();
