/* ============================================================
   Sala de Sorteio — frontend
   voz (reconhecimento + síntese) + animações + API
   ============================================================ */
"use strict";

const $ = (id) => document.getElementById(id);
const els = {
  confetti: $("confetti"),
  micPill: $("micPill"),
  micPillText: $("micPillText"),
  rangeMin: $("rangeMin"),
  rangeMax: $("rangeMax"),
  applyRange: $("applyRange"),
  rangeBrief: $("rangeBrief"),
  voiceSelect: $("voiceSelect"),
  voiceTest: $("voiceTest"),
  voiceNote: $("voiceNote"),
  configToggle: $("configToggle"),
  configZone: $("configZone"),
  configBody: $("configBody"),
  wheel: $("wheel"),
  numberLabel: $("numberLabel"),
  numberBig: $("numberBig"),
  drawBtn: $("drawBtn"),
  micBtn: $("micBtn"),
  micBtnText: $("micBtnText"),
  resetBtn: $("resetBtn"),
  resetBtnText: $("resetBtnText"),
  lastNote: $("lastNote"),
  progressLabel: $("progressLabel"),
  progressPct: $("progressPct"),
  progressFill: $("progressFill"),
  remainingCount: $("remainingCount"),
  remainingGrid: $("remainingGrid"),
  remainingEmpty: $("remainingEmpty"),
  remainingPanel: $("remainingPanel"),
  drawnPanel: $("drawnPanel"),
  drawnCount: $("drawnCount"),
  drawnRow: $("drawnRow"),
  roundsPanel: $("roundsPanel"),
  roundsList: $("roundsList"),
  historyZone: $("historyZone"),
  historyToggle: $("historyToggle"),
  historyBody: $("historyBody"),
  sheetBackdrop: $("sheetBackdrop"),
  histDrawnPill: $("histDrawnPill"),
  histRemainPill: $("histRemainPill"),
  toast: $("toast"),
};

/* ---------------- estado ---------------- */
const store = SorteioStore.createStore(window.localStorage);

let state = null;
let busy = false;
let armed = false;
let armedTimer = null;

const CAP = 240; // máximo de "chips" renderizados por painel

/* ---------------- confetti (canvas) ---------------- */
const ctx = els.confetti.getContext("2d");
let parts = [];
let raf = null;
const CONFETTI_COLORS = ["#ffc54d", "#8b5cf6", "#ec4899", "#22d3ee", "#34d399", "#ffffff"];

function resizeConfetti() {
  const dpr = window.devicePixelRatio || 1;
  els.confetti.width = Math.floor(innerWidth * dpr);
  els.confetti.height = Math.floor(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resizeConfetti);
resizeConfetti();

function spawnConfetti(count, opts = {}) {
  const { originX = innerWidth / 2, originY = innerHeight * 0.3, spread = 360, power = 1 } = opts;
  for (let i = 0; i < count; i++) {
    const angle = (Math.random() * spread - spread / 2) * (Math.PI / 180) - Math.PI / 2;
    const speed = (3 + Math.random() * 8) * power;
    parts.push({
      x: originX + (Math.random() - 0.5) * 60,
      y: originY + (Math.random() - 0.5) * 60,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.9 - 1,
      w: 6 + Math.random() * 7,
      h: 8 + Math.random() * 8,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      life: 1,
      shape: Math.random() < 0.2 ? "circle" : "rect",
    });
  }
  if (!raf) loopConfetti();
}

function loopConfetti() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter((p) => p.life > 0 && p.y < innerHeight + 60);
  for (const p of parts) {
    p.vy += 0.18;
    p.vx *= 0.99;
    p.vy *= 0.992;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    p.life -= 0.008;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.6));
    ctx.fillStyle = p.color;
    if (p.shape === "circle") {
      ctx.beginPath();
      ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot)));
    }
    ctx.restore();
  }
  raf = parts.length ? requestAnimationFrame(loopConfetti) : null;
}

/* ---------------- voz: síntese (fala) ---------------- */
let voices = [];
let recPaused = false;
const VOICE_KEY = "sorteador.voice";      // localStorage: "auto" ou o nome da voz

const ROBOTIC = /espeak|pico|mbrola|festival|flite|sam\b|robot/i;   // motores que soam robô
const FEMALE = /francisca|luciana|maria|helena|laura|julia|alice|camila|fernanda|paula|ana|raquel|female|woman|femini|vitoria|beatriz|sofia|giovanna/i;
const NATURAL = /natural|neural|online|google|microsoft|premium|high/i;

function loadVoices() {
  voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  refreshVoiceList();
}
if ("speechSynthesis" in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

function nameScore(v) {
  const n = v.name;
  let s = 0;
  if (!ROBOTIC.test(n)) s += 20;
  if (FEMALE.test(n)) s += 12;
  if (NATURAL.test(n)) s += 8;
  if (/Google|google/i.test(n)) s += 6;          // Google pt-BR costuma ser feminina e boa
  if (/bra|Brazil|brasil|pt-BR|pt_BR/i.test(v.lang)) s += 4;
  if (ROBOTIC.test(n)) s -= 40;
  return s;
}

/* Voz feminina mais natural disponível (ou a melhor pt-BR que existir) */
function autoVoice() {
  const pt = voices.filter((v) => /^pt/i.test(v.lang) && !ROBOTIC.test(v.name));
  if (!pt.length) return voices.find((v) => /^pt/i.test(v.lang)) || null;
  return pt.sort((a, b) => nameScore(b) - nameScore(a))[0];
}

/* Voz efetiva: a escolhida pelo usuário (se ainda existir) ou a automática */
function currentVoice() {
  const chosen = localStorage.getItem(VOICE_KEY);
  if (chosen && chosen !== "auto") {
    const m = voices.find((v) => v.name === chosen);
    if (m) return m;
  }
  return autoVoice();
}

function ptVoices() {
  return voices.filter((v) => /^pt/i.test(v.lang));
}

/* Monta o <select> com "Automático" + vozes pt-BR (femininas/naturais primeiro) */
function refreshVoiceList() {
  const sel = els.voiceSelect;
  const prev = localStorage.getItem(VOICE_KEY) || "auto";
  sel.textContent = "";

  const auto = document.createElement("option");
  auto.value = "auto";
  auto.textContent = "✨ Automático (recomendado)";
  sel.appendChild(auto);

  const ranked = ptVoices().sort((a, b) => nameScore(b) - nameScore(a));
  for (const v of ranked) {
    const o = document.createElement("option");
    o.value = v.name;
    o.textContent = `${v.name}${ROBOTIC.test(v.name) ? " (robótica)" : ""}`;
    sel.appendChild(o);
  }

  sel.value = [...sel.options].some((o) => o.value === prev) ? prev : "auto";

  // aviso se não houver vozes pt-BR razoáveis no aparelho
  const hasDecent = ranked.some((v) => !ROBOTIC.test(v.name));
  els.voiceNote.hidden = ranked.length !== 0 && hasDecent;
  if (ranked.length === 0 && "speechSynthesis" in window) {
    els.voiceNote.hidden = false;
    els.voiceNote.textContent =
      "Seu dispositivo não expôs vozes em português. A fala usará a voz padrão do sistema.";
  } else if (ranked.length && !hasDecent) {
    els.voiceNote.hidden = false;
    els.voiceNote.textContent =
      "Seu aparelho só tem vozes robóticas em português. O sorteio ainda fala, mas o ideal é usar um aparelho com voz Google/Microsoft.";
  } else {
    els.voiceNote.textContent = "";
  }
}

function speak(text, then) {
  if (!("speechSynthesis" in window)) {
    if (then) then();
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = currentVoice();
  if (v) u.voice = v;
  u.lang = v ? v.lang : "pt-BR";
  u.rate = 0.95;   // um pouco mais calmo/fluido
  u.pitch = 1.0;
  recPaused = true;
  const done = () => {
    recPaused = false;
    setTimeout(ensureMicRestart, 200);
    if (then) then();
  };
  u.onend = done;
  u.onerror = done;
  speechSynthesis.speak(u);
}

/* ---------------- voz: reconhecimento ---------------- */
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
const supported = Boolean(SpeechRec);
let rec = null;
let listening = false;
let recActive = false;

function setMicUI(on, errText) {
  listening = on;
  els.micBtn.setAttribute("aria-pressed", String(on));
  if (on) {
    els.micBtnText.textContent = "Desligar microfone";
    els.micPill.dataset.state = "listening";
    els.micPillText.textContent = "Ouvindo comandos";
  } else {
    els.micBtnText.textContent = "Ativar microfone";
    if (errText) {
      els.micPill.dataset.state = "error";
      els.micPillText.textContent = errText;
    } else {
      els.micPill.dataset.state = "off";
      els.micPillText.textContent = "Microfone desligado";
    }
  }
}

function stopRecognition() {
  recActive = false;
  if (rec) {
    try { rec.abort(); } catch { /* noop */ }
    rec = null;
  }
}

function ensureMicRestart() {
  if (!listening || busy || recActive || !supported) return;
  startRecognition();
}

function startRecognition() {
  if (!supported || !listening) return;
  try {
    rec = new SpeechRec();
    rec.lang = "pt-BR";
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const text = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join(" ");
      if (!recPaused && text) handleVoice(text);
    };
    rec.onend = () => {
      recActive = false;
      ensureMicRestart();
    };
    rec.onerror = (err) => {
      if (err.error === "not-allowed" || err.error === "service-not-allowed") {
        stopRecognition();
        setMicUI(false, "Microfone bloqueado");
        showToast("Permita o acesso ao microfone nas configurações do navegador.", true);
      }
      // erros de rede/"no-speech" apenas reiniciam pelo onend
    };
    rec.start();
    recActive = true;
  } catch {
    recActive = false;
  }
}

async function toggleMic() {
  if (!supported) {
    showToast("Seu navegador não suporta reconhecimento de voz. Use Chrome ou Edge.", true);
    return;
  }
  if (listening) {
    stopRecognition();
    setMicUI(false);
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    setMicUI(false, "Microfone bloqueado");
    showToast("Não foi possível acessar o microfone. Libere a permissão e tente novamente.", true);
    return;
  }
  setMicUI(true);
  speak(
    "Microfone ativado. Diga sortear, para sortear, ou reiniciar, para começar uma nova rodada.",
    () => {
      if (listening && !recActive) startRecognition();
    }
  );
}

/* ---------------- comandos de voz ---------------- */
const DRAW_WORDS = new Set([
  "sortear", "sorteia", "sorteie", "sortear", "sorteio", "sorteia", "sorteie",
  "proximo", "proxima", "próximo", "próxima",
  "gira", "girar", "roda", "roleta", "gira",
]);
const RESET_WORDS = new Set([
  "reiniciar", "reinicia", "zerar", "zera", "recomecar", "recomeça", "recomeca",
  "reset", "limpar", "recarregar", "novamente",
]);

function tokens(text) {
  const norm = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return { norm, words: new Set(norm.split(/[^a-z0-9]+/).filter(Boolean)) };
}

function handleVoice(raw) {
  const { norm, words } = tokens(raw);

  const isReset =
    words.has("reiniciar") || words.has("reinicia") || words.has("recomecar") ||
    words.has("recomeca") || words.has("zerar") || words.has("zera") ||
    words.has("reset") || words.has("limpar") || norm.includes("do zero") ||
    norm.includes("de novo");

  const isDraw =
    words.has("sortear") || words.has("sorteia") || words.has("sorteie") ||
    words.has("proximo") || words.has("proxima") || words.has("próximo") ||
    words.has("próxima") || words.has("roda") || words.has("gira") ||
    norm.includes("manda ver") || norm.includes("manda bala") || norm.includes("pode vir");

  if (isReset) doReset();
  else if (isDraw) doDraw();
}

/* ---------------- ações ---------------- */
let toastTimer = null;
function showToast(msg, isError = false) {
  els.toast.textContent = msg;
  els.toast.classList.toggle("error", isError);
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3600);
}

function setNote(text) {
  els.lastNote.textContent = text || "";
}

function makeChip(n, kind) {
  const el = document.createElement("div");
  el.className = `chip ${kind}`;
  el.dataset.n = n;
  el.textContent = n;
  return el;
}

const remainingEls = new Map();
const drawnEls = new Map();

function syncChips(container, orderedNumbers, kind, map) {
  const want = new Set(orderedNumbers);
  for (const [n, el] of map) {
    if (!want.has(n)) {
      if (kind === "remaining") {
        el.classList.add("picked");
        setTimeout(() => el.remove(), 520);
      } else {
        el.remove();
      }
      map.delete(n);
    }
  }
  for (const n of orderedNumbers) {
    if (!map.has(n)) {
      const el = makeChip(n, kind);
      container.appendChild(el);
      map.set(n, el);
    }
  }
}

function renderChipPanel(container, orderedNumbers, kind, map, noteText) {
  if (noteText) {
    if (!container._note) {
      container.textContent = "";
      map.clear();
      const note = document.createElement("div");
      note.className = "empty-note";
      note.textContent = noteText;
      container.appendChild(note);
      container._note = note;
    } else {
      container._note.textContent = noteText;
    }
    return;
  }
  if (container._note) {
    container._note.remove();
    container._note = null;
    map.clear();
  }
  syncChips(container, orderedNumbers, kind, map);
}

function renderState(s, opts = {}) {
  state = s;
  const total = s.total;
  const drawnCount = s.drawn.length;

  els.progressLabel.textContent = `${drawnCount} de ${total} sorteados`;
  els.progressPct.textContent = `${Math.round((100 * drawnCount) / total)}%`;
  els.progressFill.style.width = `${(100 * drawnCount) / total}%`;
  els.rangeBrief.textContent = `${s.range.min} – ${s.range.max}`;

  // badges do histórico
  els.histDrawnPill.textContent = `${drawnCount} sorteados`;
  els.histRemainPill.textContent = `${s.remaining.length} restantes`;

  // restantes
  els.remainingCount.textContent = s.remaining.length;
  els.remainingEmpty.hidden = !s.exhausted;
  const ordered = [...s.remaining].sort((a, b) => a - b);
  const remainingNote =
    ordered.length > CAP
      ? `Intervalo muito grande para exibir (${s.remaining.length} restantes). Acompanhe pelo histórico e pela barra de progresso.`
      : "";
  renderChipPanel(els.remainingGrid, ordered, "remaining", remainingEls, remainingNote);

  // sorteados
  els.drawnCount.textContent = s.drawn.length;
  els.drawnPanel.hidden = s.drawn.length === 0;
  const shownDrawn = s.drawn.slice(-CAP);
  const drawnNote = s.drawn.length > CAP ? `… e mais ${s.drawn.length - CAP} anteriores` : "";
  renderChipPanel(els.drawnRow, shownDrawn, "drawn", drawnEls, drawnNote);

  // rodadas anteriores
  els.roundsPanel.hidden = s.rounds.length === 0;
  els.roundsList.textContent = "";
  for (const r of [...s.rounds].reverse()) {
    const row = document.createElement("div");
    row.className = "round";
    const label = document.createElement("span");
    label.textContent = `Rodada ${r.id} — ${r.numbers.length} nºs`;
    const nums = document.createElement("span");
    nums.className = "nums";
    for (const n of r.numbers.slice(-60)) {
      const m = document.createElement("span");
      m.className = "mini";
      m.textContent = n;
      nums.appendChild(m);
    }
    row.append(label, nums);
    els.roundsList.appendChild(row);
  }

  // botões
  els.drawBtn.disabled = s.exhausted || busy;
  els.numberLabel.textContent = s.exhausted ? "Rodada completa" : "Pronto para sortear";
  if (!opts.keepNumber && state.drawn.length === 0) setIdleNumber();

  if (s.exhausted) {
    els.wheel.classList.add("boiling");
    els.numberBig.classList.remove("spinning");
  }
}

function setIdleNumber() {
  els.numberBig.textContent = "–";
  els.numberBig.className = "number-big idle";
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function doDraw() {
  if (!state || busy) return;
  if (state.exhausted) {
    doReset();
    return;
  }
  busy = true;
  els.drawBtn.classList.add("busy");
  els.drawBtn.disabled = true;
  els.numberLabel.textContent = "Sorteando…";
  els.numberBig.classList.remove("revealed");
  els.numberBig.classList.add("spinning");
  els.wheel.classList.add("boiling");

  const spinner = setInterval(() => {
    const rand = randInt(state.range.min, state.range.max);
    els.numberBig.textContent = rand;
    applyDigitClass(rand);
  }, 80);

  let res;
  try {
    res = store.draw();
  } catch (err) {
    clearInterval(spinner);
    els.wheel.classList.remove("boiling");
    els.numberBig.classList.remove("spinning");
    busy = false;
    els.drawBtn.classList.remove("busy");
    if (err.data?.exhausted) {
      renderState(store.view());
      els.numberLabel.textContent = "Rodada completa";
    } else {
      showToast(err.message, true);
    }
    return;
  }

  const n = res.n;
  const next = res.state;
  await sleep(1900);
  clearInterval(spinner);

  els.numberBig.textContent = n;
  applyDigitClass(n);
  els.numberBig.classList.remove("spinning");
  els.numberBig.classList.add("revealed");
  els.wheel.classList.remove("boiling");
  renderState(next, { keepNumber: true });
  els.numberLabel.textContent = next.exhausted ? "Rodada completa" : "Número sorteado";
  spawnConfetti(next.exhausted ? 220 : 90, { originY: innerHeight * 0.32 });

  const phrase = `O número sorteado é ${n}.` + (next.exhausted ? " A rodada terminou. Todos os números foram usados." : "");
  speak(phrase, () => {
    busy = false;
    els.drawBtn.classList.remove("busy");
    els.drawBtn.disabled = !state || state.exhausted;
    ensureMicRestart();
  });
  if (!next.exhausted) setNote(`Último sorteado: ${n}`);
}

/* ---------------- reset com confirmação ---------------- */
function disarm() {
  armed = false;
  clearTimeout(armedTimer);
  els.resetBtn.classList.remove("armed");
  els.resetBtnText.textContent = "Reiniciar";
}

function doReset() {
  if (!state) return;
  if (!armed) {
    armed = true;
    els.resetBtn.classList.add("armed");
    els.resetBtnText.textContent = "Confirmar reinício";
    speak("Confirme para começar uma nova rodada. Repita o comando para confirmar, ou toque no botão.");
    clearTimeout(armedTimer);
    armedTimer = setTimeout(disarm, 6000);
    return;
  }
  disarm();
  executeReset();
}

async function executeReset() {
  busy = true;
  els.drawBtn.disabled = true;
  els.numberLabel.textContent = "Preparando nova rodada…";
  try {
    const s = store.reset();
    renderState(s);
    setIdleNumber();
    els.wheel.classList.remove("boiling");
    els.numberLabel.textContent = "Pronto para sortear";
    setNote("Nova rodada iniciada.");
    const spoken = `Nova rodada com números de ${s.range.min} a ${s.range.max}. Diga sortear para começar.`;
    speak(spoken, () => {
      busy = false;
      els.drawBtn.disabled = false;
      ensureMicRestart();
    });
  } catch (err) {
    busy = false;
    showToast(err.message, true);
    ensureMicRestart();
  }
}

/* ---------------- config de intervalo ---------------- */
async function applyRange() {
  const min = parseInt(els.rangeMin.value, 10);
  const max = parseInt(els.rangeMax.value, 10);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min >= max) {
    showToast("Informe um intervalo válido (mínimo menor que o máximo).", true);
    return;
  }
  els.applyRange.disabled = true;
  try {
    const s = store.setRange(min, max);
    els.rangeMin.value = s.range.min;
    els.rangeMax.value = s.range.max;
    renderState(s);
    setIdleNumber();
    els.wheel.classList.remove("boiling");
    els.numberLabel.textContent = "Pronto para sortear";
    setNote(`Intervalo definido: ${s.range.min} a ${s.range.max}.`);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    els.applyRange.disabled = false;
  }
}

/* ---------------- decoração do globo ---------------- */
const ORB_COLORS = ["#ffc54d", "#8b5cf6", "#ec4899", "#22d3ee", "#34d399", "#f472b6", "#60a5fa"];
/* Bolinhas concêntricas: dois anéis ao redor do CENTRO (número fica exatamente no meio) */
(function buildOrbs() {
  const rings = els.wheel.querySelector(".wheel-rings");
  const wrap = els.wheel.querySelector(".wheel-orbs");

  const ring3 = document.createElement("div");
  ring3.className = "ring3";
  rings.appendChild(ring3);

  function place(count, radiusFrac, baseSize) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const size = baseSize + ((i * 3) % 7);
      const orb = document.createElement("div");
      orb.className = "orb";
      orb.style.left = `${50 + Math.cos(angle) * radiusFrac * 50}%`;
      orb.style.top = `${50 + Math.sin(angle) * radiusFrac * 50}%`;
      orb.style.width = `${size}px`;
      orb.style.height = `${size}px`;
      orb.style.marginLeft = `${-size / 2}px`;
      orb.style.marginTop = `${-size / 2}px`;
      orb.style.setProperty("--c", ORB_COLORS[(i + count) % ORB_COLORS.length]);
      orb.style.setProperty("--dx", `${((i % 3) - 1) * 4}px`);
      orb.style.setProperty("--dy", `${((i % 2) - 0.5) * 6}px`);
      orb.style.setProperty("--dur", `${2.6 + (i % 6) * 0.5}s`);
      wrap.appendChild(orb);
    }
  }
  place(14, 0.72, 9);   // anel interno
  place(18, 0.9, 12);   // anel externo (perto da borda)
})();

/* Ajusta o tamanho da fonte conforme o nº de algarismos (p/ caber na roda) */
function applyDigitClass(n) {
  const digits = String(n).replace(/[^0-9]/g, "").length;
  els.numberBig.classList.remove("dc-1", "dc-2", "dc-3", "dc-4", "dc-5", "dc-6");
  if (digits >= 2 && digits <= 6) els.numberBig.classList.add(`dc-${digits}`);
}

/* ---------------- eventos ---------------- */
els.drawBtn.addEventListener("click", doDraw);
els.resetBtn.addEventListener("click", doReset);
els.micBtn.addEventListener("click", toggleMic);
els.applyRange.addEventListener("click", applyRange);
for (const inp of [els.rangeMin, els.rangeMax]) {
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") applyRange();
  });
}

/* ---------------- config recolhível (mobile) ---------------- */
els.configToggle.addEventListener("click", () => {
  const open = els.configZone.classList.toggle("open");
  els.configToggle.setAttribute("aria-expanded", String(open));
});

/* ---------------- seletor de voz ---------------- */
els.voiceSelect.addEventListener("change", () => {
  localStorage.setItem(VOICE_KEY, els.voiceSelect.value);
  setNote(`Voz: ${els.voiceSelect.value === "auto" ? "automática" : els.voiceSelect.value}`);
});
els.voiceTest.addEventListener("click", () => {
  if (!("speechSynthesis" in window)) {
    showToast("Seu navegador não suporta síntese de voz.", true);
    return;
  }
  speak("Olá! Esta é a voz do sorteio. Pronta para anunciar os números.");
});

/* ---------------- histórico (drawer mobile / coluna desktop) ---------------- */
function setHistoryOpen(open) {
  els.historyZone.classList.toggle("open", open);
  els.historyToggle.setAttribute("aria-expanded", String(open));
  els.sheetBackdrop.hidden = !open;
}
els.historyToggle.addEventListener("click", () => {
  setHistoryOpen(!els.historyZone.classList.contains("open"));
});
els.sheetBackdrop.addEventListener("click", () => setHistoryOpen(false));
// ao voltar do desktop para o mobile, recolhe o drawer
matchMedia("(min-width: 900px)").addEventListener("change", (e) => {
  if (!e.matches) setHistoryOpen(false);
});

if (!supported) {
  els.micBtn.disabled = true;
  els.micBtnText.textContent = "Voz não suportada";
  setNote("Para comandos por voz use Chrome ou Edge com microfone.");
}

/* ---------------- backup do histórico (atalhos, sem UI) ---------------- */
function exportHistory() {
  const blob = new Blob([store.exportState()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sorteios-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  setNote("Histórico exportado.");
}

function importHistory() {
  if (busy) {
    showToast("Aguarde o sorteio terminar para importar.", true);
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!confirm("Importar substitui a rodada atual e todo o histórico. Continuar?")) return;
    try {
      const s = store.importState(await file.text());
      els.rangeMin.value = s.range.min;
      els.rangeMax.value = s.range.max;
      renderState(s);
      setIdleNumber();
      els.wheel.classList.remove("boiling");
      els.numberLabel.textContent = "Pronto para sortear";
      setNote("Histórico importado.");
    } catch (err) {
      showToast(err.message, true);
    }
  });
  input.click();
}

window.addEventListener("keydown", (e) => {
  // Ctrl+Alt (e não Ctrl+Shift): Ctrl+Shift+I é DevTools do Chrome e nunca chega à página.
  if (!e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey) return;
  const key = e.key.toLowerCase();
  if (key === "e") {
    e.preventDefault();
    exportHistory();
  } else if (key === "i") {
    e.preventDefault();
    importHistory();
  }
});

/* ---------------- sincronização entre abas ---------------- */
window.addEventListener("storage", (e) => {
  if (e.key !== null && e.key !== SorteioStore.STATE_KEY) return;
  if (busy) return;
  renderState(store.reload());
});

/* ---------------- boot ---------------- */
(function boot() {
  try {
    const s = store.view();
    els.rangeMin.value = s.range.min;
    els.rangeMax.value = s.range.max;
    renderState(s);
    if (s.exhausted) {
      els.numberBig.textContent = "✓";
      els.numberBig.classList.add("revealed");
    }
  } catch (err) {
    showToast("Não foi possível carregar o estado: " + err.message, true);
  }
})();
