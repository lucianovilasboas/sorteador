"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createStore, STATE_KEY, MAX_ROUNDS } = require("../public/store.js");

function memStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

/* storage que estoura acima de `limit` caracteres (simula QuotaExceededError) */
function limitedStorage(limit) {
  const base = memStorage();
  return {
    map: base.map,
    getItem: base.getItem,
    setItem: (k, v) => {
      if (v.length > limit) {
        throw Object.assign(new Error("QuotaExceededError"), { name: "QuotaExceededError" });
      }
      base.setItem(k, v);
    },
  };
}

test("estado inicial padrão", () => {
  const store = createStore(memStorage());
  const s = store.view();
  assert.deepEqual(s.range, { min: 1, max: 20 });
  assert.equal(s.total, 20);
  assert.equal(s.remaining.length, 20);
  assert.equal(s.drawn.length, 0);
  assert.equal(s.roundId, 1);
  assert.equal(s.exhausted, false);
  assert.deepEqual(s.rounds, []);
});

test("sorteio não repete e esgota o intervalo", () => {
  const store = createStore(memStorage());
  store.setRange(1, 10);
  const seen = new Set();
  for (let i = 0; i < 10; i++) {
    const { n } = store.draw();
    assert.equal(seen.has(n), false, `número repetido: ${n}`);
    seen.add(n);
  }
  assert.equal(store.view().exhausted, true);
  assert.throws(() => store.draw(), (err) => err.status === 409 && err.data.exhausted === true);
});

test("reset arquiva a rodada e começa a próxima", () => {
  const store = createStore(memStorage());
  store.setRange(1, 5);
  const drawn = [store.draw().n, store.draw().n];
  const s = store.reset();
  assert.equal(s.roundId, 3); // 1 (padrão) -> 2 (setRange) -> 3 (reset)
  assert.equal(s.drawn.length, 0);
  assert.equal(s.remaining.length, 5);
  const last = s.rounds[s.rounds.length - 1];
  assert.deepEqual(last.numbers, drawn);
  assert.equal(typeof last.endedAt, "string");
});

test("reset sem sorteios não cria rodada vazia", () => {
  const store = createStore(memStorage());
  const s = store.reset();
  assert.equal(s.rounds.length, 0);
});

test("trocar o intervalo inicia nova rodada", () => {
  const store = createStore(memStorage());
  store.setRange(1, 10);
  store.draw();
  const s = store.setRange(10, 20);
  assert.deepEqual(s.range, { min: 10, max: 20 });
  assert.equal(s.drawn.length, 0);
  assert.equal(s.rounds.length, 1);
});

test("setRange repetido não cria rodada nova", () => {
  const store = createStore(memStorage());
  store.setRange(1, 10);
  store.draw();
  const s = store.setRange(1, 10);
  assert.equal(s.drawn.length, 1);
  assert.equal(s.rounds.length, 0);
});

test("validação do intervalo", () => {
  const store = createStore(memStorage());
  assert.throws(() => store.setRange(5, 1), /maior que min/);
  assert.throws(() => store.setRange(1, 1), /maior que min/);
  assert.throws(() => store.setRange(1.5, 10), /inteiros/);
  assert.throws(() => store.setRange(1, "20"), /inteiros/);
  assert.throws(() => store.setRange(1, 100001), /2 e 100\.000/);
  assert.doesNotThrow(() => store.setRange(0, 1));
});

test("histórico limitado a MAX_ROUNDS", () => {
  const store = createStore(memStorage());
  store.setRange(1, 2);
  for (let i = 0; i < MAX_ROUNDS + 10; i++) {
    store.draw();
    store.reset();
  }
  const s = store.view();
  assert.equal(s.rounds.length, MAX_ROUNDS);
  assert.equal(s.rounds[s.rounds.length - 1].id, s.roundId - 1);
});

test("JSON corrompido volta ao padrão", () => {
  const storage = memStorage();
  storage.setItem(STATE_KEY, "{ isso não é json");
  const s = createStore(storage).view();
  assert.deepEqual(s.range, { min: 1, max: 20 });
  assert.equal(s.roundId, 1);
});

test("estado inválido no storage é descartado", () => {
  const storage = memStorage();
  storage.setItem(STATE_KEY, JSON.stringify({ range: { min: 10, max: 1 }, drawn: [], rounds: [] }));
  assert.equal(createStore(storage).view().range.min, 1);
});

test("estado persiste entre instâncias", () => {
  const storage = memStorage();
  const first = createStore(storage);
  first.setRange(1, 4);
  const n = first.draw().n;

  const second = createStore(storage).view();
  assert.deepEqual(second.drawn, [n]);
  assert.equal(second.remaining.length, 3);
});

test("estado é copiado: mexer no view não altera o store", () => {
  const store = createStore(memStorage());
  const s = store.view();
  s.drawn.push(99);
  s.range.min = 50;
  assert.equal(store.view().drawn.length, 0);
  assert.equal(store.view().range.min, 1);
});

test("exportar e importar o histórico", () => {
  const storage = memStorage();
  const store = createStore(storage);
  store.setRange(1, 6);
  store.draw();
  store.draw();

  const dump = store.exportState();
  const json = JSON.parse(dump);
  assert.deepEqual(json.range, { min: 1, max: 6 });
  assert.equal(json.drawn.length, 2);

  const other = createStore(memStorage());
  const s = other.importState(dump);
  assert.deepEqual(s.drawn, json.drawn);
  assert.deepEqual(s.range, { min: 1, max: 6 });
});

test("importar arquivo inválido não destrói o estado atual", () => {
  const store = createStore(memStorage());
  store.draw();
  assert.throws(() => store.importState("nada"), /não é um JSON válido/);
  assert.throws(() => store.importState('{"foo":1}'), /não parece um estado/);
  assert.equal(store.view().drawn.length, 1);
});

test("armazenamento cheio: descarta rodadas antigas e mantém o sorteio", () => {
  const storage = limitedStorage(150);
  const store = createStore(storage);
  store.setRange(1, 5);
  store.draw();
  store.reset();
  store.draw();
  store.reset();
  store.draw();
  const s = store.view();
  assert.equal(s.drawn.length, 1);
  assert.ok(s.rounds.length < 2, `rounds=${s.rounds.length}`);
});

test("teto de tamanho (maxChars) descarta rodadas antigas", () => {
  const store = createStore(memStorage(), { maxChars: 400 });
  store.setRange(1, 30);
  for (let i = 0; i < 20; i++) {
    for (let k = 0; k < 15; k++) store.draw();
    store.reset();
  }
  const s = store.view();
  assert.ok(s.rounds.length < 20, `rounds=${s.rounds.length}`);
  assert.ok(JSON.stringify(s).length < 400 * 4);
});
