<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>briefe-einfach</title>
  <style>
    body{margin:0;font-family:system-ui,Segoe UI,Arial;background:#0b1220;color:#e9eefc}
    .wrap{max-width:1200px;margin:28px auto;padding:0 18px}
    .title{display:flex;align-items:center;gap:12px;margin-bottom:18px}
    .logo{width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,#2b6cff,#00d4ff)}
    .sub{opacity:.8;font-size:14px}
    .grid{display:grid;grid-template-columns:1.2fr .8fr;gap:18px}
    .card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:16px}
    .row{display:flex;gap:10px;flex-wrap:wrap}
    button{border:0;border-radius:10px;padding:10px 14px;background:#2b6cff;color:white;cursor:pointer}
    button.secondary{background:rgba(255,255,255,.10)}
    button.danger{background:#ff3b3b}
    input,textarea{width:100%;box-sizing:border-box;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.25);color:#e9eefc;padding:12px}
    textarea{min-height:220px;resize:vertical}
    .badge{float:right;background:rgba(255,255,255,.10);padding:6px 10px;border-radius:999px;font-size:12px}
    .statusbox{margin-top:10px;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:10px;font-family:ui-monospace,Consolas,monospace;font-size:12px;white-space:pre-wrap}
    .muted{opacity:.75;font-size:12px;margin-top:8px}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="title">
      <div class="logo"></div>
      <div>
        <div style="font-size:22px;font-weight:700">briefe-einfach</div>
        <div class="sub">Briefe erklären & übersetzen (MVP) – stabiler Server, UI wieder „normal“.</div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div class="row">
            <button class="secondary" id="tabExplain">Brief erklären</button>
            <button class="secondary" id="tabTranslate">Übersetzen</button>
          </div>
          <div class="muted">Text einfügen → „Erklären“ drücken.</div>
        </div>

        <div style="margin-top:12px">
          <label class="muted">Brieftext</label>
          <textarea id="inputText" placeholder="Brief hier einfügen..."></textarea>
        </div>

        <div class="row" style="margin-top:12px">
          <button id="btnRun">Erklären</button>
          <button class="secondary" id="btnCopy">Ergebnis kopieren</button>
          <button class="secondary" id="btnClear">Leeren</button>
        </div>

        <div style="margin-top:12px">
          <label class="muted">Ergebnis</label>
          <div class="statusbox" id="resultBox">—</div>
        </div>
      </div>

      <div class="card">
        <div>
          <div style="font-weight:700;font-size:18px">Login <span class="badge" id="loginBadge">Nicht eingeloggt</span></div>
          <div style="margin-top:10px">
            <label class="muted">E-Mail</label>
            <input id="email" placeholder="name@mail.de" />
          </div>
          <div style="margin-top:10px">
            <label class="muted">Passwort</label>
            <input id="password" type="password" />
          </div>

          <div class="row" style="margin-top:12px">
            <button class="secondary" id="btnRegister">Registrieren</button>
            <button id="btnLogin">Login</button>
            <button class="secondary" id="btnLogout">Logout</button>
          </div>

          <div class="muted" style="margin-top:10px">Status</div>
          <div class="statusbox" id="authStatus">—</div>

          <div style="margin-top:14px;font-weight:700">Abo</div>
          <div class="muted">Startet Stripe Checkout (monatlich). Danach schalten wir „Pro“ frei.</div>
          <div class="row" style="margin-top:10px">
            <button id="btnStripe" style="width:100%">Abo starten (Stripe)</button>
          </div>
          <div class="statusbox" id="stripeStatus" style="margin-top:10px">—</div>
        </div>
      </div>
    </div>

    <div class="muted" style="text-align:center;margin-top:14px">MVP • Railway • Cookie Sessions • UI wieder produktiv</div>
  </div>

<script>
  // ✅ WICHTIG: credentials: "include" muss bei ALLEN Requests rein
  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = { ok:false, error:"Keine JSON Antwort", status: res.status }; }
    if (!res.ok && data && !data.status) data.status = res.status;
    return data;
  }

  const el = (id) => document.getElementById(id);

  async function refreshMe() {
    const me = await api("/auth/me");
    el("authStatus").textContent = JSON.stringify(me, null, 2);
    el("loginBadge").textContent = me.loggedIn ? "Eingeloggt" : "Nicht eingeloggt";
    return me;
  }

  // Tabs (nur UI)
  let mode = "explain";
  el("tabExplain").onclick = () => { mode="explain"; el("btnRun").textContent="Erklären"; };
  el("tabTranslate").onclick = () => { mode="translate"; el("btnRun").textContent="Übersetzen"; };

  el("btnRegister").onclick = async () => {
    const data = await api("/auth/register", {
      method:"POST",
      body: JSON.stringify({ email: el("email").value, password: el("password").value })
    });
    el("authStatus").textContent = JSON.stringify(data, null, 2);
    await refreshMe();
  };

  el("btnLogin").onclick = async () => {
    const data = await api("/auth/login", {
      method:"POST",
      body: JSON.stringify({ email: el("email").value, password: el("password").value })
    });
    el("authStatus").textContent = JSON.stringify(data, null, 2);
    await refreshMe();
  };

  el("btnLogout").onclick = async () => {
    const data = await api("/auth/logout", { method:"POST" });
    el("authStatus").textContent = JSON.stringify(data, null, 2);
    await refreshMe();
  };

  el("btnStripe").onclick = async () => {
    const data = await api("/stripe/create-checkout-session", { method:"POST" });
    el("stripeStatus").textContent = JSON.stringify(data, null, 2);
    if (data.ok && data.url) window.location.href = data.url;
  };

  el("btnRun").onclick = async () => {
    // MVP: wir zeigen erstmal nur Login-Zustand sauber an
    const me = await refreshMe();
    if (!me.loggedIn) {
      el("resultBox").textContent = "Not logged in";
      return;
    }
    const txt = el("inputText").value || "";
    if (!txt.trim()) { el("resultBox").textContent = "Bitte Text einfügen."; return; }
    el("resultBox").textContent = (mode==="translate")
      ? "Übersetzen kommt als nächstes – Backend folgt."
      : "Erklären kommt als nächstes – Backend folgt.";
  };

  el("btnCopy").onclick = async () => {
    await navigator.clipboard.writeText(el("resultBox").textContent || "");
  };
  el("btnClear").onclick = () => {
    el("inputText").value = "";
    el("resultBox").textContent = "—";
  };

  refreshMe();
</script>
</body>
</html>
