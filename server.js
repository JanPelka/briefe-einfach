import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 3000;

// Für ES-Module: __dirname nachbauen
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Statische Dateien ausliefern (index.html etc.)
app.use(express.static(__dirname));

// Health-Check (Railway mag das)
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Fallback: immer index.html (wichtig für SPA)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Server starten
app.listen(PORT, () => {
  console.log(`✅ Server läuft auf Port ${PORT}`);
});
