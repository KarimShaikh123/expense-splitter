const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const MAX_AMOUNT_CENTS = 1000000000;
const CURRENCY_SYMBOLS = { PKR: "Rs", USD: "$", GBP: "£", EUR: "€", AED: "د.إ", SAR: "﷼", CAD: "C$" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const state = {
  code: "",
  group: null,
  members: [],
  expenses: [],
  balances: [],
  settlements: [],
  editingId: null
};

function el(id) {
  return document.getElementById(id);
}

function memberName(id) {
  const member = state.members.find((m) => m.id === id);
  return member ? member.name : "?";
}

function formatMoney(cents) {
  const symbol = (state.group && CURRENCY_SYMBOLS[state.group.currency]) || (state.group && state.group.currency) || "Rs";
  const amount = Math.abs(cents) / 100;
  const formatted = amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return /[A-Za-z\u0600-\u06FF]/.test(symbol) ? symbol + " " + formatted : symbol + formatted;
}

function formatDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return day + " " + MONTHS[month - 1] + " " + year;
}

function rupeesToPaisa(value) {
  const rupees = Number(value);
  if (!isFinite(rupees) || rupees <= 0) return null;
  return Math.round(rupees * 100);
}

function paisaToInput(cents) {
  return (cents / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function showFormError(message) {
  const errorEl = el("expense-error");
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function hideFormError() {
  el("expense-error").hidden = true;
}

function showPageError(message) {
  el("group-loading").hidden = true;
  el("group-error-message").textContent = message;
  el("group-error").hidden = false;
}

async function loadGroup() {
  const params = new URLSearchParams(window.location.search);
  const rawCode = params.get("code");
  const code = (rawCode || "").trim().toUpperCase();
  state.code = code;

  if (!code) {
    showPageError("No group code in the link — head home to create a group or join one.");
    return;
  }
  if (!CODE_PATTERN.test(code)) {
    showPageError("That group code doesn't look right — it should be 6 letters/digits.");
    return;
  }

  let response;
  try {
    response = await fetch("/api/groups/" + encodeURIComponent(code));
  } catch {
    showPageError("Could not reach the server. Try again.");
    return;
  }

  if (response.status === 404) {
    showPageError("No group with that code — check it and try again.");
    return;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    showPageError((payload && payload.error) || "Could not load the group. Try again.");
    return;
  }

  state.group = payload.group;
  state.members = payload.members;
  state.expenses = payload.expenses;
  state.balances = payload.balances;
  state.settlements = payload.settlements;

  renderAll();
  el("group-loading").hidden = true;
  el("group-content").hidden = false;
}

function renderAll() {
  renderHead();
  renderStats();
  renderExpenses();
  renderForm();
  renderBalances();
  renderSettlements();
}

function renderHead() {
  document.title = state.group.name + " — Split";
  el("group-name").textContent = state.group.name;
  el("group-code").textContent = state.group.code;
  const symbol = CURRENCY_SYMBOLS[state.group.currency] || state.group.currency;
  el("exp-amount-label").textContent = "Amount (" + symbol + ")";
  const row = el("member-row");
  row.textContent = "";
  for (const member of state.members) {
    const chip = document.createElement("span");
    chip.className = "member-chip";
    chip.textContent = member.name;
    row.appendChild(chip);
  }
  const addChip = document.createElement("button");
  addChip.type = "button";
  addChip.className = "member-chip";
  addChip.id = "add-member-chip";
  addChip.textContent = "+ Add member";
  addChip.addEventListener("click", () => {
    el("member-error").hidden = true;
    el("add-member-row").hidden = false;
    el("new-member-name").focus();
  });
  row.appendChild(addChip);
}

function renderStats() {
  const total = state.expenses.reduce((sum, e) => sum + e.amountCents, 0);
  el("stat-expenses").textContent = state.expenses.length;
  el("stat-total").textContent = formatMoney(total);
  el("stat-transfers").textContent = state.settlements.length;
}

function renderExpenses() {
  const body = el("expense-body");
  body.textContent = "";
  el("expense-empty").hidden = state.expenses.length > 0;

  for (const expense of state.expenses) {
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
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () => startEdit(expense.id));

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => armDelete(deleteButton, expense.id));

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

function armDelete(button, expenseId) {
  if (button.dataset.armed === "true") {
    clearTimeout(button.dataset.timer);
    deleteExpense(button, expenseId);
    return;
  }
  button.dataset.armed = "true";
  button.textContent = "Sure?";
  button.dataset.timer = setTimeout(() => {
    button.dataset.armed = "";
    button.textContent = "Delete";
  }, 3000);
}

async function deleteExpense(button, expenseId) {
  button.disabled = true;
  button.textContent = "Deleting…";
  try {
    const response = await fetch("/api/groups/" + encodeURIComponent(state.code) + "/expenses/" + expenseId, {
      method: "DELETE"
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      showFormError((payload && payload.error) || "Could not delete the expense. Try again.");
      button.disabled = false;
      button.dataset.armed = "";
      button.textContent = "Delete";
      return;
    }
    hideFormError();
    resetForm();
    await loadGroup();
  } catch {
    showFormError("Could not reach the server. Try again.");
    button.disabled = false;
    button.dataset.armed = "";
    button.textContent = "Delete";
  }
}

function renderBalances() {
  const list = el("balance-list");
  list.textContent = "";
  for (const balance of state.balances) {
    const li = document.createElement("li");
    const phrase = document.createElement("span");
    phrase.className = "balance-phrase";
    const name = document.createTextNode(memberName(balance.memberId) + " ");
    const note = document.createElement("span");
    note.className = "balance-note";
    const amount = document.createElement("span");
    amount.className = "balance-amount";
    if (balance.balanceCents > 0) {
      note.textContent = "is owed";
      amount.classList.add("balance-pos");
      amount.textContent = "+" + formatMoney(balance.balanceCents);
    } else if (balance.balanceCents < 0) {
      note.textContent = "owes";
      amount.classList.add("balance-neg");
      amount.textContent = "−" + formatMoney(balance.balanceCents);
    } else {
      note.textContent = "settled";
      amount.classList.add("balance-zero");
      amount.textContent = formatMoney(0);
    }
    phrase.appendChild(name);
    phrase.appendChild(note);
    li.appendChild(phrase);
    li.appendChild(amount);
    list.appendChild(li);
  }
}

function renderSettlements() {
  const list = el("settle-list");
  list.textContent = "";
  el("settle-empty").hidden = state.settlements.length > 0;
  for (const settlement of state.settlements) {
    const li = document.createElement("li");
    const phrase = document.createElement("span");
    phrase.className = "settle-phrase";
    const from = document.createTextNode(memberName(settlement.from) + " ");
    const arrow = document.createElement("span");
    arrow.className = "settle-arrow";
    arrow.textContent = "pays";
    const to = document.createTextNode(" " + memberName(settlement.to));
    phrase.appendChild(from);
    phrase.appendChild(arrow);
    phrase.appendChild(to);
    const amount = document.createElement("span");
    amount.className = "settle-amount";
    amount.textContent = formatMoney(settlement.amountCents);
    li.appendChild(phrase);
    li.appendChild(amount);
    list.appendChild(li);
  }
}

function karachiWeekEnd() {
  const shifted = new Date(Date.now() + 5 * 60 * 60 * 1000);
  const day = shifted.getUTCDay();
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  const sunday = new Date(shifted.getTime() + daysUntilSunday * 24 * 60 * 60 * 1000);
  return sunday.toISOString().slice(0, 10);
}

function renderForm() {
  el("exp-date").max = karachiWeekEnd();
  const select = el("exp-payer");
  select.textContent = "";
  for (const member of state.members) {
    const option = document.createElement("option");
    option.value = member.id;
    option.textContent = member.name;
    select.appendChild(option);
  }

  const equalGrid = el("split-equal");
  const exactGrid = el("split-exact");
  equalGrid.textContent = "";
  exactGrid.textContent = "";
  for (const member of state.members) {
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

  if (!el("exp-date").value) {
    const today = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    el("exp-date").value = today.getFullYear() + "-" + pad(today.getMonth() + 1) + "-" + pad(today.getDate());
  }
}

function currentSplitType() {
  return document.querySelector("input[name='split-type']:checked").value;
}

function startEdit(expenseId) {
  const expense = state.expenses.find((e) => e.id === expenseId);
  if (!expense) return;
  state.editingId = expenseId;
  hideFormError();

  el("exp-desc").value = expense.description;
  el("exp-amount").value = paisaToInput(expense.amountCents);
  el("exp-payer").value = expense.paidBy;
  el("exp-date").value = expense.date;

  const splitType = expense.splitType;
  document.querySelector("input[name='split-type'][value='" + splitType + "']").checked = true;
  el("split-equal").hidden = splitType === "exact";
  el("split-exact").hidden = splitType !== "exact";

  if (splitType === "equal") {
    const participantIds = new Set(expense.shares.map((s) => s.memberId));
    for (const checkbox of el("split-equal").querySelectorAll("input[type='checkbox']")) {
      checkbox.checked = participantIds.has(Number(checkbox.dataset.memberId));
    }
  } else {
    const shareByMember = new Map(expense.shares.map((s) => [s.memberId, s.shareCents]));
    for (const input of el("split-exact").querySelectorAll("input[type='number']")) {
      const share = shareByMember.get(Number(input.dataset.memberId));
      input.value = share === undefined ? "" : paisaToInput(share);
    }
  }

  el("form-title").textContent = "Edit expense";
  el("expense-submit").textContent = "Save changes";
  el("expense-cancel").hidden = false;
  el("expense-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetForm() {
  state.editingId = null;
  el("expense-form").reset();
  el("form-title").textContent = "Add an expense";
  el("expense-submit").textContent = "Add expense";
  el("expense-cancel").hidden = true;
  hideFormError();
  const today = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  el("exp-date").value = today.getFullYear() + "-" + pad(today.getMonth() + 1) + "-" + pad(today.getDate());
  for (const checkbox of el("split-equal").querySelectorAll("input[type='checkbox']")) {
    checkbox.checked = true;
  }
  for (const input of el("split-exact").querySelectorAll("input[type='number']")) {
    input.value = "";
  }
  el("split-equal").hidden = false;
  el("split-exact").hidden = true;
}

function collectPayload() {
  const description = el("exp-desc").value.trim();
  if (!description) {
    showFormError("Give the expense a description.");
    return null;
  }

  const amountCents = rupeesToPaisa(el("exp-amount").value);
  if (!amountCents) {
    showFormError("Enter an amount greater than zero.");
    return null;
  }
  if (amountCents > MAX_AMOUNT_CENTS) {
    showFormError("That amount is too large — the limit is " + formatMoney(MAX_AMOUNT_CENTS) + ".");
    return null;
  }

  const splitType = currentSplitType();
  let participants;
  if (splitType === "equal") {
    participants = Array.from(el("split-equal").querySelectorAll("input[type='checkbox']:checked")).map((box) =>
      Number(box.dataset.memberId)
    );
    if (participants.length === 0) {
      showFormError("Pick at least one person to split between.");
      return null;
    }
  } else {
    participants = [];
    for (const input of el("split-exact").querySelectorAll("input[type='number']")) {
      if (input.value.trim() === "") continue;
      const shareCents = Math.round(Number(input.value) * 100);
      if (!isFinite(shareCents) || shareCents < 0) {
        showFormError("Exact amounts must be zero or more.");
        return null;
      }
      participants.push({ memberId: Number(input.dataset.memberId), shareCents });
    }
    if (participants.length === 0) {
      showFormError("Enter at least one exact amount.");
      return null;
    }
  }

  return {
    description,
    amountCents,
    paidBy: Number(el("exp-payer").value),
    splitType,
    participants,
    date: el("exp-date").value
  };
}

function setSubmitBusy(busy) {
  const button = el("expense-submit");
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = state.editingId ? "Saving…" : "Adding…";
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

async function submitExpense(event) {
  event.preventDefault();
  hideFormError();
  const payload = collectPayload();
  if (!payload) return;

  const editing = state.editingId !== null;
  const url =
    "/api/groups/" + encodeURIComponent(state.code) + "/expenses" + (editing ? "/" + state.editingId : "");
  setSubmitBusy(true);
  try {
    const response = await fetch(url, {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      showFormError((result && result.error) || "Could not save the expense. Try again.");
      return;
    }
    resetForm();
    await loadGroup();
  } catch {
    showFormError("Could not reach the server. Try again.");
  } finally {
    setSubmitBusy(false);
  }
}

document.querySelectorAll("input[name='split-type']").forEach((radio) => {
  radio.addEventListener("change", () => {
    const exact = currentSplitType() === "exact";
    el("split-equal").hidden = exact;
    el("split-exact").hidden = !exact;
  });
});

el("expense-form").addEventListener("submit", submitExpense);
el("expense-cancel").addEventListener("click", resetForm);

el("add-member-cancel").addEventListener("click", () => {
  el("add-member-row").hidden = true;
  el("new-member-name").value = "";
  el("member-error").hidden = true;
});

el("add-member-submit").addEventListener("click", async () => {
  const errorEl = el("member-error");
  const input = el("new-member-name");
  const button = el("add-member-submit");
  const name = input.value.trim();
  errorEl.hidden = true;
  if (!name) {
    errorEl.textContent = "Enter a name first.";
    errorEl.hidden = false;
    return;
  }
  button.disabled = true;
  button.textContent = "Adding…";
  try {
    const response = await fetch("/api/groups/" + encodeURIComponent(state.code) + "/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      errorEl.textContent = (payload && payload.error) || "Could not add the member. Try again.";
      errorEl.hidden = false;
      return;
    }
    input.value = "";
    el("add-member-row").hidden = true;
    await loadGroup();
  } catch {
    errorEl.textContent = "Could not reach the server. Try again.";
    errorEl.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "Add";
  }
});

el("copy-code").addEventListener("click", async () => {
  const button = el("copy-code");
  try {
    await navigator.clipboard.writeText(state.group.code);
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = "Copy";
    }, 1500);
  } catch {
    window.prompt("Copy the group code:", state.group.code);
  }
});

function groupUrl() {
  return window.location.origin + "/group?code=" + encodeURIComponent(state.group.code);
}

el("copy-link").addEventListener("click", async () => {
  const button = el("copy-link");
  try {
    await navigator.clipboard.writeText(groupUrl());
    button.textContent = "Link copied";
    setTimeout(() => {
      button.textContent = "Copy link";
    }, 1500);
  } catch {
    window.prompt("Copy the group link:", groupUrl());
  }
});

function removeSavedGroup(code) {
  try {
    const parsed = JSON.parse(localStorage.getItem("my-groups") || "[]");
    const groups = Array.isArray(parsed) ? parsed.filter((g) => g && g.code !== code) : [];
    localStorage.setItem("my-groups", JSON.stringify(groups));
  } catch {
    return;
  }
}

el("delete-group").addEventListener("click", async () => {
  const button = el("delete-group");
  if (button.dataset.armed !== "true") {
    button.dataset.armed = "true";
    button.textContent = "Sure? Deletes everything";
    setTimeout(() => {
      button.dataset.armed = "";
      button.textContent = "Delete group";
    }, 3000);
    return;
  }
  button.disabled = true;
  button.textContent = "Deleting…";
  try {
    const response = await fetch("/api/groups/" + encodeURIComponent(state.code), { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      showFormError((payload && payload.error) || "Could not delete the group. Try again.");
      button.disabled = false;
      button.dataset.armed = "";
      button.textContent = "Delete group";
      return;
    }
    removeSavedGroup(state.code);
    window.location.href = "/";
  } catch {
    showFormError("Could not reach the server. Try again.");
    button.disabled = false;
    button.dataset.armed = "";
    button.textContent = "Delete group";
  }
});

loadGroup();
