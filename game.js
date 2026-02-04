import { listenRoom, updateRoom } from "./firestore-utils.js";
import { REGLAS } from "./reglas.js"; // si aún no lo usas, ok
import { movies } from "./movies.js";

// ============================
// LOCAL ROUND STATE
// ============================
let hintsUsedThisRound = 0;
let revealedHintBtns = new Set();
let pendingAnswerForStartAt = null;

// Desbloqueo autoplay
let audioUnlocked = false;
let pendingPlay = null; // { startAtMs, audioUrl }

// Control de timers
let unsub = null;
let countdownInterval = null;
let scheduledPlayTimeout = null;
let lastScheduledStartAt = null;
let lastRoundIndex = -1;

// ============================
// DOM HELPERS
// ============================
function $(id) { return document.getElementById(id); }

function setText(id, txt) {
  const el = $(id);
  if (el) el.textContent = txt;
}

function setDisplay(id, value) {
  const el = $(id);
  if (el) el.style.display = value;
}

function setDisabled(id, disabled) {
  const el = $(id);
  if (el) el.disabled = disabled;
}

function setError(msg) {
  const el = $("gameError");
  if (!el) return;

  if (!msg) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  el.textContent = msg;
  el.style.display = "block";
}

function setStatus(txt) {
  setText("statusText", txt || "");
}

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// ============================
// PLAYER ID (device + tab)
// ============================
function getOrCreateDeviceId() {
  const deviceKey = "qsdcmulti_deviceId";
  let deviceId = localStorage.getItem(deviceKey);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(deviceKey, deviceId);
  }
  return deviceId;
}

function getOrCreateTabId() {
  const tabKey = "qsdcmulti_tabId";

  const urlTab = getParam("tab");
  if (urlTab) {
    sessionStorage.setItem(tabKey, urlTab);
    return urlTab;
  }

  let tabId = sessionStorage.getItem(tabKey);
  if (tabId) return tabId;

  tabId = crypto.randomUUID();
  sessionStorage.setItem(tabKey, tabId);
  return tabId;
}

function getOrCreatePlayerId() {
  return `${getOrCreateDeviceId()}:${getOrCreateTabId()}`;
}

// ============================
// NORMALIZACIÓN / MOVIES
// ============================
function normalizeAnswer(s) {
  return (s || "")
    .trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getMovie(movieIndex) {
  return movies && movies[movieIndex] ? movies[movieIndex] : null;
}

function getAudioUrlFromMovieIndex(movieIndex) {
  const m = getMovie(movieIndex);
  return m && m.audio ? m.audio : "";
}

function getPrimaryTitle(movieIndex) {
  const m = getMovie(movieIndex);
  if (!m) return "??";
  if (Array.isArray(m.title)) return m.title[0] || "??";
  return m.title || "??";
}

function isCorrectAnswer(raw, movieIndex) {
  const m = getMovie(movieIndex);
  if (!m) return false;

  const guess = normalizeAnswer(raw);
  const titles = Array.isArray(m.title) ? m.title : [m.title];
  return titles.some(t => normalizeAnswer(t) === guess);
}

// ============================
// AUDIO UNLOCK (primer gesto)
// ============================
function unlockAudioOnce() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  const audio = $("audio");
  if (!audio) return;

  const prevMuted = audio.muted;
  audio.muted = true;

  audio.play()
    .then(() => {
      audio.pause();
      audio.currentTime = 0;
      audio.muted = prevMuted;

      if (pendingPlay) {
        const startAtMs = pendingPlay.startAtMs;
        const audioUrl = pendingPlay.audioUrl;
        pendingPlay = null;
        scheduleSynchronizedPlay(startAtMs, audioUrl);
      }
    })
    .catch((e) => {
      audio.muted = prevMuted;
      console.warn("[QSDC-MULTI] audio unlock failed:", e);
    });
}

["click", "touchstart", "keydown"].forEach(ev => {
  window.addEventListener(ev, unlockAudioOnce, { once: true, passive: true });
});

// ============================
// ROOM / NAV
// ============================
const roomId = (getParam("room") || "").toUpperCase().trim();
const tabId = getOrCreateTabId();
const playerId = getOrCreatePlayerId();

if (!roomId) setError("Falta el parámetro de sala. Vuelve al lobby.");

setText("roomIdText", roomId);

const backBtn = $("btnBack");
if (backBtn) {
  backBtn.addEventListener("click", () => {
    window.location.href = `lobby.html?room=${encodeURIComponent(roomId)}&tab=${encodeURIComponent(tabId)}`;
  });
}

// ============================
// TIMERS / AUDIO SYNC
// ============================
function clearTimers() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = null;

  if (scheduledPlayTimeout) clearTimeout(scheduledPlayTimeout);
  scheduledPlayTimeout = null;
}

function scheduleSynchronizedPlay(startAtMs, audioUrl) {
  if (!audioUrl) return;
  if (lastScheduledStartAt === startAtMs) return;
  lastScheduledStartAt = startAtMs;

  clearTimers();

  const audio = $("audio");
  if (!audio) return;

  audio.pause();
  audio.currentTime = 0;
  audio.src = audioUrl;
  audio.load();

  if (!audioUnlocked) {
    pendingPlay = { startAtMs, audioUrl };
    setStatus("Toca la pantalla una vez para activar el audio 🔊");
    return;
  }

  setStatus("Preparando audio...");

  function tick() {
    const now = Date.now();
    const diff = startAtMs - now;
    const sec = Math.max(0, Math.floor((diff + 999) / 1000));
    setText("countdownText", diff <= 0 ? "¡YA!" : String(sec));
  }

  tick();
  countdownInterval = setInterval(tick, 200);

  const delay = Math.max(0, startAtMs - Date.now());
  scheduledPlayTimeout = setTimeout(async () => {
    try {
      setStatus("Reproduciendo...");
      await audio.play();
    } catch (e) {
      setStatus("Pulsa play si el navegador bloquea el autoplay.");
      console.warn("Autoplay bloqueado:", e);
    }
  }, delay);
}

// ============================
// RENDER PLAYERS / SCORES
// ============================
function renderPlayers(playersObj) {
  const ul = $("playersList");
  if (!ul) return;

  ul.innerHTML = "";
  const arr = Object.entries(playersObj || {}).map(([id, p]) => ({ id, ...p }));
  arr.sort((a, b) => (a.nick || "").localeCompare(b.nick || ""));
  for (const p of arr) {
    const li = document.createElement("li");
    li.textContent = p.nick || "?";
    ul.appendChild(li);
  }
}

function renderScores(playersObj) {
  const ul = $("scoreList");
  if (!ul) return;

  ul.innerHTML = "";
  const arr = Object.entries(playersObj || {}).map(([id, p]) => ({
    id,
    nick: p.nick || "?",
    puntos: p.puntos ?? 0,
    racha: p.racha ?? 0
  }));

  arr.sort((a, b) => (b.puntos - a.puntos) || a.nick.localeCompare(b.nick));

  for (const p of arr) {
    const li = document.createElement("li");
    li.textContent = `${p.nick}: ${p.puntos} pts (racha: ${p.racha})`;
    ul.appendChild(li);
  }
}

// ============================
// ROUND INIT (HOST)
// ============================
async function ensureRoundInitialized(room) {
  const isHost = room.hostId === playerId;
  if (!isHost) return;

  const round = room.round || {};
  if (round.startAt && round.movieIndex != null) return;

  const playlist = room.playlist || [];
  const idx = room.indiceActual ?? 0;
  const movieIndex = playlist[idx];

  if (movieIndex == null) return;

  const startAt = Date.now() + 3000;

  await updateRoom(roomId, {
    round: {
      movieIndex,
      startAt,
      answers: {},
      hintsUsed: {},
      hintsUsedStartAt: {},
      revealUntil: null
    }
  });
}

// ============================
// MODE UI (descripción + rendirse)
// ============================
function renderModeUI(room) {
  const mode = room.config?.modoJuego || "normal";
  const descEl = $("descriptionText");
  const surrenderBtn = $("btnSurrender");

  if (mode === "locura") {
    if (descEl) descEl.textContent = "";
    if (surrenderBtn) surrenderBtn.style.display = "none";
    return;
  }

  if (surrenderBtn) surrenderBtn.style.display = "inline-block";

  const round = room.round || {};
  const m = getMovie(round.movieIndex);
  if (descEl) descEl.textContent = m?.description || "";
}

// ============================
// HINTS (solo normal/contrarreloj)
// ============================
async function updateHintsUsedFirestore(roundStartAt) {
  try {
    await updateRoom(roomId, {
      [`round.hintsUsed.${playerId}`]: hintsUsedThisRound,
      [`round.hintsUsedStartAt.${playerId}`]: roundStartAt
    });
  } catch {
    // silencioso
  }
}

function renderHintsForRound(room) {
  const hc = $("hintsContainer");
  if (!hc) return;

  hc.innerHTML = "";

  const mode = room.config?.modoJuego || "normal";
  if (mode !== "normal" && mode !== "contrarreloj") return;

  const round = room.round || {};
  const m = getMovie(round.movieIndex);
  const hints = m?.hints || [];
  if (!hints.length) return;

  hints.forEach((hint, i) => {
    const btn = document.createElement("button");
    btn.textContent = `Mostrar pista ${i + 1}`;

    const div = document.createElement("div");
    div.style.display = "none";
    div.className = "spoiler";
    div.textContent = hint;

    btn.addEventListener("click", async () => {
      const isHidden = div.style.display === "none";
      div.style.display = isHidden ? "block" : "none";

      if (isHidden && !revealedHintBtns.has(i)) {
        revealedHintBtns.add(i);
        hintsUsedThisRound++;
        await updateHintsUsedFirestore(round.startAt);
      }
    });

    hc.appendChild(btn);
    hc.appendChild(div);
  });
}

// ============================
// SUBMIT ANSWER / SURRENDER / PASS VACÍO
// ============================
async function submitAnswer(room, { surrendered = false } = {}) {
  const round = room.round || {};
  if (!round.startAt || round.movieIndex == null) return;

  const myAns = round.answers?.[playerId];
  if (myAns && myAns.roundStartAt === round.startAt) return;

  const input = $("answerInput");
  const raw = (input?.value ?? "").trim(); // puede ser ""
  const correct = surrendered ? false : isCorrectAnswer(raw, round.movieIndex);

  pendingAnswerForStartAt = round.startAt;

  setDisabled("answerInput", true);
  setDisabled("btnAnswer", true);
  setDisabled("btnSurrender", true);

  const title = getPrimaryTitle(round.movieIndex);

  if (surrendered) setText("answerStatus", `Te has rendido 🏳️ Era: ${title} (esperando al resto)`);
  else if (correct) setText("answerStatus", "¡Correcto! ✅ (esperando al resto)");
  else setText("answerStatus", `Incorrecto ❌ Era: ${title} (esperando al resto)`);

  await updateRoom(roomId, {
    [`round.answers.${playerId}`]: {
      raw,
      correct,
      surrendered: !!surrendered,
      ts: Date.now(),
      roundStartAt: round.startAt
    }
  });
}

// ============================
// SCORING (HOST) + REVEAL DELAY
// ============================
function allPlayersAnswered(room) {
  const players = Object.keys(room.players || {});
  const answers = room.round?.answers || {};
  const startAt = room.round?.startAt;
  if (!startAt) return false;

  return players.length > 0 && players.every(pid => {
    const a = answers[pid];
    return a && a.roundStartAt === startAt;
  });
}

async function hostScoreAndAdvance(room) {
  const isHost = room.hostId === playerId;
  if (!isHost) return;

  const round = room.round || {};
  if (!round.answers) return;
  if (!allPlayersAnswered(room)) return;

  const now = Date.now();

  if (!round.revealUntil) {
    await updateRoom(roomId, { "round.revealUntil": now + 1500 });
    return;
  }
  if (now < round.revealUntil) return;

  if (room.lastScoredIndex === (room.indiceActual ?? 0)) return;

  const mode = room.config?.modoJuego || "normal";
  const answers = round.answers;
  const updates = {};
  const playersObj = room.players || {};

  for (const [pid, pdata] of Object.entries(playersObj)) {
    const ans = answers[pid] || {};
    const correct = !!ans.correct;
    const surrendered = !!ans.surrendered;

    let delta = 0;

    if (mode === "locura") {
      delta = correct ? 10 : -20;
    } else if (mode === "extremo") {
      if (surrendered) delta = -5;
      else delta = correct ? 7 : -3;
    } else {
      if (surrendered) {
        delta = -3;
      } else if (correct) {
        const hintsUsed = round.hintsUsed?.[pid] ?? 0;
        const hintsStartOk = round.hintsUsedStartAt?.[pid] === round.startAt;
        const used = hintsStartOk ? hintsUsed : 0;
        delta = Math.max(0, 5 - used);
      } else {
        delta = 0;
      }
    }

    const prevPts = pdata.puntos ?? 0;
    const prevRacha = pdata.racha ?? 0;
    const prevBest = pdata.mejorRacha ?? 0;

    const newRacha = correct ? prevRacha + 1 : 0;
    const best = Math.max(prevBest, newRacha);

    let bonus = 0;
    if (correct && newRacha > 0 && newRacha % 10 === 0) bonus = newRacha;

    updates[`players.${pid}.puntos`] = prevPts + delta + bonus;
    updates[`players.${pid}.racha`] = newRacha;
    updates[`players.${pid}.mejorRacha`] = best;
  }

  const currentIndex = room.indiceActual ?? 0;
  const nextIndex = currentIndex + 1;
  const total = room.config?.numPeliculas ?? (room.playlist?.length ?? 0);

  updates.lastScoredIndex = currentIndex;
  updates.lastScoredAt = now;

  if (nextIndex >= total) {
    updates.estado = "finalizada";
    updates.round = { finishedAt: now };
  } else {
    const playlist = room.playlist || [];
    const nextMovieIndex = playlist[nextIndex];

    updates.indiceActual = nextIndex;
    updates.round = {
      movieIndex: nextMovieIndex,
      startAt: now + 3000,
      answers: {},
      hintsUsed: {},
      hintsUsedStartAt: {},
      revealUntil: null
    };
  }

  await updateRoom(roomId, updates);
}

// ============================
// UI PER ROUND
// ============================
function resetAnswerUIForNewRound() {
  pendingAnswerForStartAt = null;

  const input = $("answerInput");
  if (input) {
    input.value = "";
    input.disabled = false;
    setTimeout(() => input.focus(), 0);
  }

  hintsUsedThisRound = 0;
  revealedHintBtns = new Set();

  const hc = $("hintsContainer");
  if (hc) hc.innerHTML = "";

  setText("answerStatus", "Nueva ronda: escribe tu respuesta 👇");

  setDisabled("btnAnswer", false);
  setDisabled("btnSurrender", false);
}

function syncAnswerUI(room) {
  const round = room.round || {};
  const hasRound = !!round.startAt && round.movieIndex != null;

  if (!hasRound) {
    setDisabled("answerInput", true);
    setDisabled("btnAnswer", true);
    setDisabled("btnSurrender", true);
    setText("answerStatus", "Esperando a que empiece la ronda...");
    return;
  }

  const myAns = round.answers?.[playerId];
  const already = !!myAns && myAns.roundStartAt === round.startAt;

  if (!already && pendingAnswerForStartAt != null && pendingAnswerForStartAt === round.startAt) {
    setDisabled("answerInput", true);
    setDisabled("btnAnswer", true);
    setDisabled("btnSurrender", true);
    return;
  }

  if (already && pendingAnswerForStartAt === round.startAt) {
    pendingAnswerForStartAt = null;
  }

  setDisabled("answerInput", already);
  setDisabled("btnAnswer", already);
  setDisabled("btnSurrender", already);

  if (already) {
    const title = getPrimaryTitle(round.movieIndex);
    if (myAns.surrendered) setText("answerStatus", `Te rendiste 🏳️ Era: ${title} (esperando al resto)`);
    else if (myAns.correct) setText("answerStatus", "¡Correcto! ✅ (esperando al resto)");
    else setText("answerStatus", `Incorrecto ❌ Era: ${title} (esperando al resto)`);
    return;
  }

  setText("answerStatus", "Aún no has respondido.");
}

// ============================
// RENDER ROOM
// ============================
function renderRoom(room) {
  if (!room) {
    setError("La sala no existe o ha sido eliminada.");
    return;
  }

  if (room.estado === "finalizada") {
    window.location.href = `results.html?room=${encodeURIComponent(roomId)}`;
    return;
  }

  if (room.estado === "esperando") {
    setText("countdownText", "-");
    setStatus("Esperando a que el host inicie la partida...");

    setDisabled("answerInput", true);
    setDisabled("btnAnswer", true);
    setDisabled("btnSurrender", true);
    setText("answerStatus", "Esperando a que empiece la ronda...");

    setError("");
    return;
  }

  if (room.estado !== "jugando") {
    window.location.href = `lobby.html?room=${encodeURIComponent(roomId)}&tab=${encodeURIComponent(tabId)}`;
    return;
  }

  setError("");

  const cfg = room.config || {};
  setText("modoText", cfg.modoJuego || "-");
  setText("modoRondaText", cfg.modoRonda || "-");

  const idx = room.indiceActual ?? 0;
  const total = cfg.numPeliculas ?? (room.playlist?.length ?? "?");
  setText("roundText", `${idx + 1} / ${total}`);

  renderPlayers(room.players);
  renderScores(room.players);

  ensureRoundInitialized(room).catch(err => console.error("init round:", err));

  if (idx !== lastRoundIndex) {
    lastRoundIndex = idx;
    lastScheduledStartAt = null;
    clearTimers();
    resetAnswerUIForNewRound();
  }

  const round = room.round || {};
  const hasRound = !!round.startAt && round.movieIndex != null;

  if (hasRound) {
    renderModeUI(room);
    const url = getAudioUrlFromMovieIndex(round.movieIndex);
    scheduleSynchronizedPlay(round.startAt, url);
    renderHintsForRound(room);
  } else {
    setText("countdownText", "-");
    setStatus("Esperando sincronización...");
  }

  syncAnswerUI(room);
  hostScoreAndAdvance(room).catch(err => console.error("score:", err));
}

// ============================
// EVENTS
// ============================
const btnAnswer = $("btnAnswer");
if (btnAnswer) {
  btnAnswer.addEventListener("click", async () => {
    if (!window.__currentRoom) return;
    try {
      await submitAnswer(window.__currentRoom);
    } catch (e) {
      setError(e?.message || "No se pudo enviar la respuesta.");
    }
  });
}

const btnSurrender = $("btnSurrender");
if (btnSurrender) {
  btnSurrender.addEventListener("click", async () => {
    if (!window.__currentRoom) return;
    try {
      await submitAnswer(window.__currentRoom, { surrendered: true });
    } catch (e) {
      setError(e?.message || "No se pudo rendir.");
    }
  });
}

const answerInput = $("answerInput");
if (answerInput) {
  answerInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      if (!window.__currentRoom) return;
      try {
        await submitAnswer(window.__currentRoom);
      } catch (err) {
        setError(err?.message || "No se pudo enviar la respuesta.");
      }
    }
  });
}

// ============================
// START LISTEN
// ============================
if (roomId) {
  unsub = listenRoom(roomId, (room) => {
    window.__currentRoom = room;
    renderRoom(room);
  });
}

window.addEventListener("beforeunload", () => {
  clearTimers();
  if (unsub) unsub();
});
