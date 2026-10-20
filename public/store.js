/* ============================================================
   Sala de Sorteio — store
   Domínio do sorteio + persistência em localStorage.
   Sem DOM: carregável no Node para os testes (test/store.test.js).
   ============================================================ */
"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SorteioStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const STATE_KEY = "sorteador.state.v1";
  const STATE_VERSION = 2;
  const MAX_ROUNDS = 20;
  const MAX_CHARS = 4 * 1024 * 1024; // teto de segurança: localStorage costuma parar em ~5 MB

  /* Fonte criptográfica: window.crypto no browser, node:crypto no Node < 19. */
  const RNG = (() => {
    if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.getRandomValues === "function") {
      return globalThis.crypto;
    }
    if (typeof require === "function") return require("node:crypto").webcrypto;
    return null;
  })();

  function fail(message, status, data) {
    const err = new Error(message);
    if (status) err.status = status;
    if (data) err.data = data;
    return err;
  }

  function defaultState() {
    return {
      version: STATE_VERSION,
      range: { min: 1, max: 20 },
      roundId: 1,
      drawn: [],
      rounds: [],
    };
  }

  /* Inteiro uniforme em [0, n): descarta a cauda que enviesaria o módulo. */
  function randomBelow(n) {
    if (n <= 1) return 0;
    if (!RNG) throw fail("Gerador aleatório indisponível neste navegador.", 500);
    const limit = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    let x;
    do {
      RNG.getRandomValues(buf);
      x = buf[0];
    } while (x >= limit);
    return x % n;
  }

  function isRound(r) {
    return Boolean(r) && Number.isInteger(r.id) && Array.isArray(r.numbers) && typeof r.endedAt === "string";
  }

  /* Valida/normaliza o que veio do storage (ou de um import). null = inválido. */
  function normalize(raw) {
    if (!raw || typeof raw !== "object") return null;
    const range = raw.range;
    if (!range || !Number.isInteger(range.min) || !Number.isInteger(range.max)) return null;
    if (range.min >= range.max) return null;
    if (!Array.isArray(raw.drawn) || !Array.isArray(raw.rounds)) return null;

    const seen = new Set();
    const drawn = raw.drawn.filter((n) => {
      if (!Number.isInteger(n) || n < range.min || n > range.max) return false;
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });

    const rounds = raw.rounds.filter(isRound).map((r) => ({
      id: r.id,
      numbers: r.numbers.filter((n) => Number.isInteger(n)),
      endedAt: r.endedAt,
    }));

    return {
      version: STATE_VERSION,
      range: { min: range.min, max: range.max },
      roundId: Number.isInteger(raw.roundId) ? raw.roundId : 1,
      drawn,
      rounds,
    };
  }

  function createStore(storage, opts) {
    const options = opts || {};
    const key = options.key || STATE_KEY;
    const maxRounds = options.maxRounds || MAX_ROUNDS;
    const maxChars = options.maxChars || MAX_CHARS;

    function readRaw() {
      try {
        return storage.getItem(key);
      } catch {
        return null;
      }
    }

    function load() {
      const raw = readRaw();
      if (!raw) return defaultState();
      try {
        const parsed = normalize(JSON.parse(raw));
        if (parsed) return parsed;
      } catch {
        // arquivo corrompido -> recomeça
      }
      return defaultState();
    }

    let state = load();
    trimRounds(state);

    function trimRounds(s) {
      if (s.rounds.length > maxRounds) s.rounds.splice(0, s.rounds.length - maxRounds);
    }

    function persist() {
      for (;;) {
        trimRounds(state);
        const payload = JSON.stringify(state);
        if (payload.length > maxChars && state.rounds.length > 0) {
          state.rounds.shift();
          continue;
        }
        try {
          storage.setItem(key, payload);
          return;
        } catch {
          if (state.rounds.length === 0) {
            throw fail("Não foi possível salvar no navegador (armazenamento cheio). Exporte o histórico e limpe os dados do site.");
          }
          state.rounds.shift();
        }
      }
    }

    function numbersInRange(range) {
      const out = [];
      for (let i = range.min; i <= range.max; i++) out.push(i);
      return out;
    }

    function remainingNumbers(s) {
      const drawn = new Set(s.drawn);
      return numbersInRange(s.range).filter((n) => !drawn.has(n));
    }

    function view() {
      const total = state.range.max - state.range.min + 1;
      const remaining = remainingNumbers(state);
      return {
        range: { ...state.range },
        roundId: state.roundId,
        drawn: state.drawn.slice(),
        remaining,
        total,
        exhausted: remaining.length === 0,
        rounds: state.rounds
          .slice(-maxRounds)
          .map((r) => ({ id: r.id, numbers: r.numbers.slice(), endedAt: r.endedAt })),
      };
    }

    function archiveRound() {
      if (state.drawn.length === 0) return;
      state.rounds.push({
        id: state.roundId,
        numbers: state.drawn.slice(),
        endedAt: new Date().toISOString(),
      });
      trimRounds(state);
    }

    function startNewRound() {
      archiveRound();
      state.roundId += 1;
      state.drawn = [];
    }

    function draw() {
      const remaining = remainingNumbers(state);
      if (remaining.length === 0) {
        throw fail("Todos os números já foram sorteados. Reinicie para uma nova rodada.", 409, { exhausted: true });
      }
      const n = remaining[randomBelow(remaining.length)];
      state.drawn.push(n);
      persist();
      return { n, state: view() };
    }

    function reset() {
      startNewRound();
      persist();
      return view();
    }

    function setRange(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max)) {
        throw fail("min e max devem ser inteiros", 400);
      }
      if (min >= max) {
        throw fail("max deve ser maior que min", 400);
      }
      const size = max - min + 1;
      if (size < 2 || size > 100000) {
        throw fail("intervalo deve ter entre 2 e 100.000 números", 400);
      }
      if (state.range.min !== min || state.range.max !== max) {
        state.range = { min, max };
        startNewRound();
        persist();
      }
      return view();
    }

    function exportState() {
      return JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
    }

    function importState(text) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw fail("Arquivo inválido: não é um JSON válido.", 400);
      }
      const next = normalize(parsed);
      if (!next) throw fail("Arquivo inválido: não parece um estado do sorteador.", 400);
      state = next;
      persist();
      return view();
    }

    /* Relê o storage: usado quando outra aba gravou (evento "storage"). */
    function reload() {
      const raw = readRaw();
      if (raw) {
        try {
          const parsed = normalize(JSON.parse(raw));
          if (parsed) state = parsed;
        } catch {
          // mantém o estado em memória
        }
      }
      return view();
    }

    return { view, draw, reset, setRange, exportState, importState, reload };
  }

  return { createStore, STATE_KEY, MAX_ROUNDS };
});
