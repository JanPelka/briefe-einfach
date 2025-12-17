// server.js (komplett)
"use strict";

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

// Railway setzt PORT automatisch. Lokal: 3000
const PORT = process.env.PORT || 3000;

// ===== Basics =====
app.use(express.json({ limit: "1mb" }));

// Optional: CORS (wenn du später Frontend/Backend trennst)
// Für gleiche Domain brauchst du es NICHT, schadet aber nicht.
app.use(cors());

// ===== Static Frontend =====
// WICHTIG: deine index.html liegt in /public
app.use(express.static(path.join(__dirname, "public")));

// ===== Health / Status =====
app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "briefe-einfach",
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Root immer zur App
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ===== KI / Erklärung (MVP ohne API-Key) =====
// Hier ist die "MVP-Erklärung" wie vorher – später ersetzen wir das durch OpenAI-API.
function simpleExplain(text) {
  const t = String(text || "").trim();
  if (!t) return "Bitte gib einen Text ein.";

  // super simple Heuristik (MVP)
  const lower = t.toLowerCase();
  const hints = [];

  if (lower.includes("frist") || lower.includes("fristgerecht") || lower.includes("innerhalb")) {
    hints.push("• Es gibt sehr wahrscheinlich eine Frist. Prüfe Datum + Anzahl Tage genau.");
  }
  if (lower.includes("zahlung") || lower.includes("zahlen") || lower.includes("betrag")) {
    hints.push("• Es geht vermutlich um Geld (Zahlung / Forderung / Beitrag).");
  }
  if (lower.includes("widerspruch") || lower.includes("einspruch")) {
    hints.push("• Es geht um einen Widerspruch/Einspruch oder die Möglichkeit dazu.");
  }
  if (lower.includes("unterlagen") || lower.includes("nachweis") || lower.includes("belege")) {
    hints.push("• Du sollst wahrscheinlich Unterlagen/Nachweise einreichen.");
  }

  const base =
`Das ist eine einfache Erklärung:

• Der Brief richtet sich an dich.
• Er möchte dir etwas mitteilen oder fordert eine Reaktion.
• Lies die Fristen/Termine genau und notiere dir, was du tun sollst.

Nächste sinnvolle Schritte:
1) Datum des Schreibens + Eingangsdatum notieren
2) Frist ausrechnen (falls vorhanden)
3) Was wird verlangt? (Zahlung / Unterlagen / Rückmeldung)
4) Wenn unklar: kurz nachfragen oder schriftlich antworten`;

  if (hints.length) {
    return base + "\n\nHinweise aus deinem Text:\n" + hints.join("\n");
  }
  return base;
}

// Endpoint muss GENAU /erklaeren heißen (weil Frontend fetch("/erklaeren") macht)
app.post("/erklaeren", async (req, res) => {
  try {
    const text = req.body?.text;

    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ ok: false, error: "Kein Text erhalten." });
    }

    // MVP Erklärung
    const explanation = simpleExplain(text);

    return res.status(200).json({ ok: true, explanation });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "Serverfehler." });
  }
});

// ===== 404 (JSON für API, HTML für Browser) =====
app.use((req, res) => {
  // Wenn Browser (accept html) -> index.html (für sauberes SPA-Verhalten)
  const accept = req.headers.accept || "";
  if (accept.includes("text/html")) {
    return res.status(200).sendFile(path.join(__dirname, "public", "index.html"));
  }
  return res.status(404).json({ ok: false, error: "Not Found" });
});

// ===== Start =====
app.listen(PORT, () => {
  console.log(`✅ briefe-einfach läuft auf Port ${PORT}`);
});
