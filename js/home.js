const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

const createForm = document.getElementById("create-form");
const createError = document.getElementById("create-error");
const joinForm = document.getElementById("join-form");
const joinError = document.getElementById("join-error");
const joinCode = document.getElementById("join-code");

function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
}

createForm.addEventListener("submit", (event) => {
  event.preventDefault();
  createError.hidden = true;
  const name = document.getElementById("group-name").value.trim();
  const members = document
    .getElementById("member-names")
    .value.split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!name) {
    showError(createError, "Give the group a name.");
    return;
  }
  if (members.length < 2) {
    showError(createError, "A group needs at least two members — one name per line.");
    return;
  }
  window.location.href = "/group?code=K4B2QX";
});

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  joinError.hidden = true;
  const code = joinCode.value.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    showError(joinError, "Codes are 6 letters/digits — check it with whoever shared it.");
    return;
  }
  window.location.href = "/group?code=" + encodeURIComponent(code);
});
