const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const STORAGE_KEY = "my-groups";

const createForm = document.getElementById("create-form");
const createError = document.getElementById("create-error");
const createButton = document.getElementById("create-button");
const joinForm = document.getElementById("join-form");
const joinError = document.getElementById("join-error");
const joinButton = document.getElementById("join-button");
const joinCode = document.getElementById("join-code");

function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
}

function hideError(el) {
  el.hidden = true;
}

function loadMyGroups() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((g) => g && CODE_PATTERN.test(g.code)) : [];
  } catch {
    return [];
  }
}

function saveGroup(code, name) {
  const groups = loadMyGroups().filter((g) => g.code !== code);
  groups.unshift({ code, name });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  } catch {
    return;
  }
}

function renderMyGroups() {
  const list = document.getElementById("your-groups");
  const empty = document.getElementById("your-groups-empty");
  const groups = loadMyGroups();
  list.textContent = "";
  empty.hidden = groups.length > 0;
  for (const group of groups) {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.href = "/group?code=" + encodeURIComponent(group.code);
    const name = document.createElement("span");
    name.className = "your-group-name";
    name.textContent = group.name;
    const code = document.createElement("code");
    code.textContent = group.code;
    link.appendChild(name);
    link.appendChild(code);
    li.appendChild(link);
    list.appendChild(li);
  }
}

function setBusy(button, busy, busyText) {
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError(createError);
  const name = document.getElementById("group-name").value.trim();
  const members = document
    .getElementById("member-names")
    .value.split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const currency = document.getElementById("group-currency").value;
  if (!name) {
    showError(createError, "Give the group a name.");
    return;
  }
  if (members.length < 2) {
    showError(createError, "A group needs at least two members — one name per line.");
    return;
  }
  setBusy(createButton, true, "Creating…");
  try {
    const response = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, members, currency })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      showError(createError, (payload && payload.error) || "Could not create the group. Try again.");
      return;
    }
    saveGroup(payload.code, payload.name);
    window.location.href = "/group?code=" + encodeURIComponent(payload.code);
  } catch {
    showError(createError, "Could not reach the server. Try again.");
  } finally {
    setBusy(createButton, false);
  }
});

joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError(joinError);
  const code = joinCode.value.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    showError(joinError, "Codes are 6 letters/digits — check it with whoever shared it.");
    return;
  }
  setBusy(joinButton, true, "Opening…");
  try {
    const response = await fetch("/api/groups/" + encodeURIComponent(code));
    const payload = await response.json().catch(() => null);
    if (response.status === 404) {
      showError(joinError, "No group with that code — check it and try again.");
      return;
    }
    if (!response.ok) {
      showError(joinError, (payload && payload.error) || "Could not open the group. Try again.");
      return;
    }
    saveGroup(payload.group.code, payload.group.name);
    window.location.href = "/group?code=" + encodeURIComponent(code);
  } catch {
    showError(joinError, "Could not reach the server. Try again.");
  } finally {
    setBusy(joinButton, false);
  }
});

renderMyGroups();
