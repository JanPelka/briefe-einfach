const express = require("express");
const cors = require("cors");

const app = express();

/* =========================
   CONFIG
========================= */
app.use(cors());
app.use(express.json({ limit: "1mb" }));

/* =========================
   HEALTH / ROOT
========================= */
app.get("/", (req, res) => {
  res.status(200).send("🚀 briefe-einfach läuft!");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

/* =========================
   API
========================= */
app.post("/erklaeren", (req, res) => {
  const { text } = req.body;

  if (!text || text.trim().length === 0) {
    return res.status(400).json({
      error: "Kein Text übergeben",
    });
  }

  // MVP: Dummy-Erklärung
  const erklaerung =
    "📄 Einfache Erklärung (MVP):\n\n" +
    text.slice(0, 200) +
    (text.length > 200 ? " …" : "");

  res.json({
    ok: true,
    explanation: erklaerung,
  });
});

/* =========================
   START SERVER (RAILWAY FIX)
========================= */
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server läuft auf Port ${PORT}`);
});
