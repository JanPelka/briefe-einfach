import express from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const users = []; // MVP: In-Memory (später DB)

app.get("/health", (req, res) => {
  res.json({ ok: true, status: "healthy" });
});

app.post("/auth/register", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Fehlende Daten" });
  }

  if (users.find(u => u.email === email)) {
    return res.status(409).json({ error: "User existiert bereits" });
  }

  const hash = await bcrypt.hash(password, 10);
  users.push({ email, password: hash });

  res.json({ success: true });
});

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  const user = users.find(u => u.email === email);
  if (!user) return res.status(401).json({ error: "Falsche Daten" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: "Falsche Daten" });

  res.json({ success: true });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

app.listen(PORT, () => {
  console.log("Server läuft auf Port", PORT);
});
