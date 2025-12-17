const express = require("express");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// 👉 Frontend aus /public ausliefern
app.use(express.static(path.join(__dirname, "public")));

// Root-Endpunkt (sehr wichtig für Railway)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Test-Endpunkt
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// Railway-Port oder lokal 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server läuft auf Port", PORT);
});
