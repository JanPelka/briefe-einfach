async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body || {})
  });

  let data = null;
  try { data = await res.json(); }
  catch { data = { ok: false, error: "Keine JSON Antwort", status: res.status }; }

  if (!res.ok && data && typeof data.status === "undefined") {
    data.status = res.status;
  }
  return data;
}

async function apiGet(path) {
  const res = await fetch(path, { credentials: "include" });
  let data = null;
  try { data = await res.json(); }
  catch { data = { ok: false, error: "Keine JSON Antwort", status: res.status }; }
  if (!res.ok && data && typeof data.status === "undefined") data.status = res.status;
  return data;
}

const el = (id) => document.getElementById(id);

const tabExplain = el("tabExplain");
const tabTranslate = el("tabTranslate");
const btnRun = el("btnRun");
const btnCopy = el("btnCopy");
const btnClear = el("btnClear");
const inputText = el("inputText");
const outputText = el("outputText");

const btnRegister = el("btnRegister");
const btnLogin = el("btnLogin");
const btnLogout = el("btnLogout");
const email = el("email");
const password = el("password");
const authBox = el("authBox");
const loginState = el("loginState");

const btnStripe = el("btnStripe");
const stripeBox = el("stripeBox");
const pill = el("pill");

let mode = "explain"; // explain | translate

function setMode(m) {
  mode = m;
  tabExplain.classList.toggle("active", mode === "explain");
  tabTranslate.classList.toggle("active", mode === "translate");
  btnRun.textContent = mode === "explain" ? "Erklären" : "Übersetzen";
}

tabExplain.addEventListener("click", () => setMode("explain"));
tabTranslate.addEventListener("click", () => setMode("translate"));

btnClear.addEventListener("click", () => {
  inputText.value = "";
  outputText.value = "";
});

btnCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(outputText.value || "");
  } catch {
    // fallback
    outputText.select();
    document.execCommand("copy");
  }
});

btnRun.addEventListener("click", async () => {
  outputText.value = "…";

  if (mode === "explain") {
    const data = await api("/api/explain", { text: inputText.value });
    outputText.value = data.ok ? data.result : (data.error || "Fehler");
    return;
  }

  // translate
  const data = await api("/api/translate", { text: inputText.value, target: "de" });
  outputText.value = data.ok ? data.result : (data.error || "Fehler");
});

btnRegister.addEventListener("click", async () => {
  authBox.textContent = "…";
  const data = await api("/auth/register", { email: email.value, password: password.value });
  authBox.textContent = JSON.stringify(data, null, 2);
  await refreshMe();
});

btnLogin.addEventListener("click", async () => {
  authBox.textContent = "…";
  const data = await api("/auth/login", { email: email.value, password: password.value });
  authBox.textContent = JSON.stringify(data, null, 2);
  await refreshMe();
});

btnLogout.addEventListener("click", async () => {
  authBox.textContent = "…";
  const data = await api("/auth/logout", {});
  authBox.textContent = JSON.stringify(data, null, 2);
  await refreshMe();
});

btnStripe.addEventListener("click", async () => {
  stripeBox.textContent = "…";
  const data = await api("/api/stripe/create-checkout-session", {});
  stripeBox.textContent = JSON.stringify(data, null, 2);
  if (data.ok && data.url) {
    window.location.href = data.url;
  }
});

async function refreshMe() {
  const me = await apiGet("/auth/me");
  loginState.textContent = me.loggedIn ? `Eingeloggt: ${me.user.email}` : "Nicht eingeloggt";
  loginState.style.borderColor = me.loggedIn ? "rgba(34,197,94,0.45)" : "rgba(255,255,255,0.12)";
  pill.textContent = me.loggedIn ? "Status: Online (eingeloggt)" : "Status: Online";
}

(async function init() {
  setMode("explain");

  // Health check
  try {
    const r = await fetch("/health");
    if (r.ok) {
      pill.textContent = "Status: Online";
    } else {
      pill.textContent = "Status: Problem";
    }
  } catch {
    pill.textContent = "Status: Offline";
  }

  await refreshMe();
})();
