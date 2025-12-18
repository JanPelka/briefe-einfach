const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();

// Railway / Proxy friendly
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Static Frontend aus /public
const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir));

// Healthcheck
app.get("/health", (req, res) => {
  res.json({ ok: true, status: "healthy" });
});

// Root -> index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

// MVP Erklärung (ohne externe APIs, damit es stabil läuft)
function simpleExplain(text) {
  const t = String(text || "").trim();
  if (!t) return "Bitte Text einfügen.";

  // super simple Heuristik
  const lines = t.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const first = lines.slice(0, 3).join(" ");

  return (
`Das ist eine einfache Erklärung:

Kurz:
- Es geht um ein Schreiben/Anliegen. Wichtig ist: Was wird verlangt und bis wann?

Nächste sinnvolle Schritte:
1) Datum des Schreibens + Eingangsdatum notieren.
2) Im Text nach Frist/Termin/Betreff/Zeichen suchen.
3) Prüfen: wird eine Zahlung/Unterlage/Antwort verlangt?
4) Wenn unklar: schriftlich um kurze Erklärung bitten.

Hinweise aus deinem Text:
- Anfang: "${first.slice(0, 140)}${first.length > 140 ? "…" : ""}"`
  );
}

app.post("/erklaeren", (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || !String(text).trim()) {
      return res.status(400).json({ ok: false, error: "Bitte Text eingeben." });
    }
    const explanation = simpleExplain(text);
    return res.json({ ok: true, explanation });
  } catch (err) {
    console.error("POST /erklaeren error:", err);
    return res.status(500).json({ ok: false, error: "Serverfehler." });
  }
});

// 404 für API (damit du es im Browser klar siehst)
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not Found" });
});

// Fehler abfangen (damit es NICHT den Prozess killt)
process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err));
process.on("uncaughtException", (err) => console.error("uncaughtException:", err));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("✅ Server läuft auf Port", PORT);
});
