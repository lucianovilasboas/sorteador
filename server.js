const express = require("express");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");

const app = express();
app.use(express.static(PUBLIC_DIR));

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
