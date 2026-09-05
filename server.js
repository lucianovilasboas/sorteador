const express = require("express");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const http = require("node:http");
const https = require("node:https");

const { randomInt } = crypto;

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "sorteios.json");
const PUBLIC_DIR = path.join(__dirname, "public");

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      if (raw && Number.isInteger(raw.range?.min) && Number.isInteger(raw.range?.max)) {
        return raw;
      }
    } catch {
      // arquivo corrompido -> recomeça
    }
  }
  return defaultState();
}

function defaultState() {
  return {
    version: 1,
    range: { min: 1, max: 20 },
    roundId: 1,
    drawn: [],
    rounds: [],
  };
}

let state = loadState();

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

function numbersInRange(range) {
  const out = [];
  for (let i = range.min; i <= range.max; i++) out.push(i);
  return out;
}

function remainingNumbers() {
  const drawn = new Set(state.drawn.map((d) => d.n));
  return numbersInRange(state.range).filter((n) => !drawn.has(n));
}

function publicState() {
  const remaining = remainingNumbers();
  return {
    range: { ...state.range },
    roundId: state.roundId,
    drawn: state.drawn.map((d) => ({ n: d.n, at: d.at })),
    remaining: remaining,
    total: state.range.max - state.range.min + 1,
    exhausted: remaining.length === 0,
    rounds: state.rounds
      .slice(-20)
      .map((r) => ({ id: r.id, numbers: r.numbers, endedAt: r.endedAt })),
  };
}

function archiveRound() {
  if (state.drawn.length === 0) return;
  state.rounds.push({
    id: state.roundId,
    numbers: state.drawn.map((d) => d.n),
    endedAt: new Date().toISOString(),
  });
  if (state.rounds.length > 500) state.rounds.splice(0, state.rounds.length - 500);
}

function startNewRound() {
  archiveRound();
  state.roundId += 1;
  state.drawn = [];
}

function setRange(min, max) {
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    return { error: "min e max devem ser inteiros", code: 400 };
  }
  if (min >= max) {
    return { error: "max deve ser maior que min", code: 400 };
  }
  const size = max - min + 1;
  if (size < 2 || size > 100000) {
    return { error: "intervalo deve ter entre 2 e 100.000 números", code: 400 };
  }
  const changed = state.range.min !== min || state.range.max !== max;
  if (changed) {
    state.range = { min, max };
    startNewRound();
  }
  return null;
}

const app = express();
app.use(express.json());

app.use(express.static(PUBLIC_DIR));

app.get("/api/state", (_req, res) => {
  res.json(publicState());
});

app.post("/api/config", (req, res) => {
  const { min, max } = req.body ?? {};
  const err = setRange(min, max);
  if (err) return res.status(err.code).json({ error: err.error });
  persist();
  res.json(publicState());
});

app.post("/api/draw", (_req, res) => {
  const remaining = remainingNumbers();
  if (remaining.length === 0) {
    return res.status(409).json({ error: "Todos os números já foram sorteados. Reinicie para uma nova rodada.", exhausted: true });
  }
  const n = remaining[randomInt(remaining.length)];
  state.drawn.push({ n, at: new Date().toISOString() });
  persist();
  res.json({ n, at: state.drawn[state.drawn.length - 1].at, state: publicState() });
});

app.post("/api/reset", (_req, res) => {
  startNewRound();
  persist();
  res.json(publicState());
});

function ensureHttpsCerts() {
  const certDir = path.join(DATA_DIR, "certs");
  const keyPath = path.join(certDir, "key.pem");
  const certPath = path.join(certDir, "cert.pem");
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { keyPath, certPath };
  }
  // eslint-disable-next-line global-require
  const selfsigned = require("selfsigned");
  const attrs = [{ name: "commonName", value: "localhost" }];
  const pems = selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    algorithm: "sha256",
    extensions: [
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" },
          { type: 7, ip: "127.0.0.1" },
        ],
      },
    ],
  });
  fs.mkdirSync(certDir, { recursive: true });
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  return { keyPath, certPath };
}

const useHttps = process.env.HTTPS === "1" || process.env.HTTPS === "true";
if (useHttps) {
  const { keyPath, certPath } = ensureHttpsCerts();
  https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app).listen(PORT, () => {
    console.log(`Sorteador HTTPS em https://localhost:${PORT}`);
  });
} else {
  http.createServer(app).listen(PORT, () => {
    console.log(`Sorteador HTTP em http://localhost:${PORT}`);
    console.log("Dica: acesse via localhost para o comando de voz funcionar, ou use HTTPS em rede local.");
  });
}
