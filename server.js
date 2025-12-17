const express = require("express");
const cors = require("cors");

const app = express();

// ===== Middleware =====
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ===== Health / Root Endpoint (WICHTIG für Railway!) =====
app.get("/", (req, res) => {
  res.status(200).send("🚀 briefe-einfach läuft!");
});

// ===== API Endpoint =====
app.post("/erklaeren", async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        error: "Kein Text übergeben",
      });
    }

    // MVP: Platzhalter-Erklärung
    const explanation = `📄 Einfache Erklärung (MVP):
    
Dieser Text ist ein offizielles Schreiben.
Er enthält wichtige Informationen oder Forderungen.
Bitte lies ihn aufmerksam und beachte Fristen.`;

    res.json({
      ok: true,
      explanation,
    });
  } catch (err) {
    console.error("Fehler:", err);
    res.status(500).json({ error: "Serverfehler" });
  }
});

// ===== Railway PORT (ABSOLUT KRITISCH) =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server läuft auf Port ${PORT}`);
});
