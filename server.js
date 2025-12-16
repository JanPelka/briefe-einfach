/**
 * server.js
 * Briefe-einfach – Railway kompatibler Server
 */

const express = require("express");
const path = require("path");

const app = express();

/* ==============================
   KONFIGURATION
============================== */

// Railway / Cloud Port oder lokal 3000
const PORT = process.env.PORT || 3000;

// JSON Body erlauben (für spätere API)
app.use(express.json());

// URL-encoded Body
app.use(express.urlencoded({ extended: true }));

/* ==============================
   STATISCHE DATEIEN (Frontend)
============================== */

// Root-Verzeichnis
const PUBLIC_DIR = __dirname;

// Statische Dateien ausliefern
app.use(express.static(PUBLIC_DIR));

/* ==============================
   ROUTES
============================== */

// Startseite
app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// Health-Check (Railway / Monitoring)
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "briefe-einfach",
    timestamp: new Date().toISOString(),
  });
});

/* ==============================
   404 FALLBACK
============================== */

app.use((req, res) => {
  res.status(404).json({
    error: "Not Found",
    path: req.originalUrl,
  });
});

/* ==============================
   SERVER START
============================== */

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Server läuft");
  console.log("📡 Port:", PORT);
});
