const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());

// Health / Root Check (Railway braucht das)
app.get("/", (req, res) => {
  res.send("🚀 briefe-einfach läuft!");
});

// 🔴 DAS HAT GEFEHLT
app.post("/erklaeren", (req, res) => {
  const { text } = req.body;

  if (!text || text.trim() === "") {
    return res.status(400).json({
      error: "Kein Text übergeben"
    });
  }

  // MVP-Erklärung (erstmal simpel)
  const erklaerung = `
Das ist eine einfache Erklärung:

Der Brief richtet sich höflich an Sie.
Es geht darum, Informationen verständlich zu erklären.
Sie müssen den Text genau lesen und ggf. reagieren.
  `.trim();

  res.json({
    explanation: erklaerung
  });
});

// Server starten
app.listen(PORT, () => {
  console.log(`✅ Server läuft auf Port ${PORT}`);
});
