const express = require("express");
const cors = require("cors");

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Root → extrem wichtig für Railway
app.get("/", (req, res) => {
  res.status(200).send("🚀 briefe-einfach läuft!");
});

// Healthcheck (Railway nutzt das intern)
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// API Endpoint
app.post("/erklaeren", (req, res) => {
  const { text } = req.body || {};

  if (!text || String(text).trim().length === 0) {
    return res.status(400).json({ error: "Kein Text übergeben" });
  }

  const erklaerung =
    "📄 Einfache Erklärung (MVP):\n\n" +
    String(text).slice(0, 300) +
    (text.length > 300 ? " …" : "");

  res.json({
    ok: true,
    explanation: erklaerung,
  });
});

// 🔴 DAS WAR DER FEHLER BEI DIR:
const PORT = process.env.PORT || 3000;

// ⚠️ WICHTIG: 0.0.0.0
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server läuft auf Port ${PORT}`);
});
