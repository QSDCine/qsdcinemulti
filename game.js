import { listenRoom, updateRoom } from "./firestore-utils.js";
import { REGLAS } from "./reglas.js";

let pendingAnswerForStartAt = null;

function $(id) { return document.getElementById(id); }

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

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

  // 1) Si viene en URL, úsalo y persístelo
  const urlTab = getParam("tab");
  if (urlTab) {
    sessionStorage.setItem(tabKey, urlTab);
    return urlTab;
  }

  // 2) Si existe en sessionStorage, úsalo
  let tabId = sessionStorage.getItem(tabKey);
  if (tabId) return tabId;

  // 3) Si no, créalo
  tabId = crypto.randomUUID();
  sessionStorage.setItem(tabKey, tabId);
  return tabId;
}

function getOrCreatePlayerId() {
  const deviceId = getOrCreateDeviceId();
  const tabId = getOrCreateTabId();
  return `${deviceId}:${tabId}`;
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

function normalizeAnswer(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ⚠️ TEMPORAL
function getSolutionForMovieIndex(movieIndex) {
  return String(movieIndex);
}

// ⚠️ TEMPORAL
function getAudioUrlFromMovieIndex(movieIndex) {
  return `audio/${movieIndex}.mp3`;
}

function setStatus(txt) {
  $("statusText").textContent = txt;
}

function renderPlayers(playersObj) {
  const ul = $("playersList");
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

const roomId = (getParam("room") || "").toUpperCase().trim();
const tabId = getOrCreateTabId();
const playerId = getOrCreatePlayerId();


if (!roomId) setError("Falta el parámetro de sala. Vuelve al lobby.");

$("roomIdText").textContent = roomId;

$("btnBack").addEventListener("click", () => {
window.location.href = `lobby.html?room=${encodeURIComponent(roomId)}&tab=${encodeURIComponent(tabId)}`;

});

let unsub = null;
let countdownInterval = null;
let scheduledPlayTimeout = null;

let lastScheduledStartAt = null;
let lastRoundIndex = -1;

// ============================
// DEBUG / LOGGING
// ============================
const DEBUG = true;
const LOG_PREFIX = "[QSDC-MULTI]";
let __snapN = 0;

function dlog(...args) {
  if (!DEBUG) return;
  console.log(LOG_PREFIX, ...args);
}

function dgroup(title, obj) {
  if (!DEBUG) return;
  console.groupCollapsed(`${LOG_PREFIX} ${title}`);
  if (obj !== undefined) console.log(obj);
  console.groupEnd();
}

const __logOnce = new Set();
function dlogOnce(key, ...args) {
  if (!DEBUG) return;
  if (__logOnce.has(key)) return;
  __logOnce.add(key);
  console.log(LOG_PREFIX, ...args);
}

function snapMini(room) {
  const idx = room?.indiceActual ?? null;
  const r = room?.round || {};
  const startAt = r.startAt ?? null;
  const movieIndex = r.movieIndex ?? null;

  const answers = r.answers || {};
  const answersKeys = Object.keys(answers);

  const myAns = answers?.[playerId] || null;

  return {
    estado: room?.estado,
    hostId: room?.hostId,
    playerId,
    idx,
    startAt,
    movieIndex,
    playersCount: Object.keys(room?.players || {}).length,
    answersCount: answersKeys.length,
    answersKeys,
    hasMyAnswerObj: !!myAns,
    myAnswerRoundStartAt: myAns?.roundStartAt ?? null,
    pendingAnswerForStartAt,
    lastRoundIndex,
    lastScheduledStartAt,
  };
}

// ------------------------------------------------------
// Timers / audio sync
// ------------------------------------------------------
function clearTimers() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = null;

  if (scheduledPlayTimeout) clearTimeout(scheduledPlayTimeout);
  scheduledPlayTimeout = null;
}

function scheduleSynchronizedPlay(startAtMs, audioUrl) {
  if (lastScheduledStartAt === startAtMs) return;
  lastScheduledStartAt = startAtMs;

  dlog("scheduleSynchronizedPlay()", { startAtMs, audioUrl });

  clearTimers();

  const audio = $("audio");
  audio.pause();
  audio.currentTime = 0;
  audio.src = audioUrl;
  audio.load();

  setStatus("Preparando audio...");

  const tick = () => {
    const now = Date.now();
    const diff = startAtMs - now;
    const sec = Math.max(0, Math.floor((diff + 999) / 1000));
    $("countdownText").textContent = diff <= 0 ? "¡YA!" : String(sec);
  };

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

// ------------------------------------------------------
// Round init (host)
// ------------------------------------------------------
async function ensureRoundInitialized(room) {
  const isHost = room.hostId === playerId;
  if (!isHost) return;

  const round = room.round || {};
  if (round.startAt && round.movieIndex != null) return;

  const playlist = room.playlist || [];
  const idx = room.indiceActual ?? 0;
  const movieIndex = playlist[idx];

  // Si no hay playlist o índice inválido, no init
  if (movieIndex == null) {
    dlog("ensureRoundInitialized(): movieIndex null -> skip", { idx, playlistLen: playlist.length });
    return;
  }

  const startAt = Date.now() + 3000;

  dlog("ensureRoundInitialized(): creating round", { idx, movieIndex, startAt });

  await updateRoom(roomId, {
    round: { movieIndex, startAt, answers: {} }
  });
}

// ------------------------------------------------------
// Submit answer
// ------------------------------------------------------
async function submitAnswer(room) {
  dgroup("submitAnswer() ENTER", snapMini(room));

  const round = room.round || {};
  if (!round.startAt || round.movieIndex == null) {
    dlog("submitAnswer() abort: no valid round", { startAt: round.startAt, movieIndex: round.movieIndex });
    return;
  }

  // si ya existe mi respuesta en Firestore, no reenviar
  const myAns = round.answers?.[playerId];
  if (myAns && myAns.roundStartAt === round.startAt) {
    dlog("submitAnswer() SKIP: already answered this round", { myAns, roundStartAt: round.startAt });
    return;
  }

  const input = $("answerInput");
  const raw = input.value.trim();
  if (!raw) {
    dlog("submitAnswer() abort: empty raw");
    return;
  }

  const correct = normalizeAnswer(raw) === normalizeAnswer(getSolutionForMovieIndex(round.movieIndex));

  // “parche UI”: bloqueo inmediato aunque snapshot tarde
  pendingAnswerForStartAt = round.startAt;
  input.disabled = true;
  $("btnAnswer").disabled = true;
  $("answerStatus").textContent = "Respuesta enviada ✅ (sincronizando...)";

  dlog("submitAnswer() -> writing Firestore", {
    writingKey: `round.answers.${playerId}`,
    roundStartAt: round.startAt,
    raw,
    correct
  });

  await updateRoom(roomId, {
    [`round.answers.${playerId}`]: {
      raw,
      correct,
      ts: Date.now(),
      roundStartAt: round.startAt
    }
  });

  dlog("submitAnswer() -> write OK (waiting snapshot)");
}

// ------------------------------------------------------
// Scoring (host only)
// ------------------------------------------------------
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

function computePointsFor(mode, correct) {
  if (mode === "locura") return correct ? 10 : -20;
  if (mode === "extremo") return correct ? 7 : -3;
  return correct ? 5 : 0;
}

async function hostScoreAndAdvance(room) {
  dgroup("hostScoreAndAdvance() ENTER", snapMini(room));

  const isHost = room.hostId === playerId;
  if (!isHost) { dlog("hostScoreAndAdvance() skip: not host"); return; }

  const round = room.round || {};
  if (!round.answers) { dlog("hostScoreAndAdvance() skip: no answers obj"); return; }
  if (!allPlayersAnswered(room)) { dlog("hostScoreAndAdvance() skip: not all answered"); return; }

  // Evitar doble scoring
  if (room.lastScoredIndex === (room.indiceActual ?? 0)) {
    dlog("hostScoreAndAdvance() skip: already scored idx", room.lastScoredIndex);
    return;
  }

  const mode = room.config?.modoJuego || "normal";
  const answers = round.answers;
  const updates = {};
  const playersObj = room.players || {};

  for (const [pid, pdata] of Object.entries(playersObj)) {
    const ans = answers[pid];
    const correct = !!ans?.correct;

    const delta = computePointsFor(mode, correct);
    const prevPts = pdata.puntos ?? 0;
    const prevRacha = pdata.racha ?? 0;
    const prevBest = pdata.mejorRacha ?? 0;

    const newRacha = correct ? prevRacha + 1 : 0;
    const best = Math.max(prevBest, newRacha);

    let bonus = 0;
    if (correct && newRacha > 0 && newRacha % 10 === 0) {
      bonus = newRacha;
    }

    updates[`players.${pid}.puntos`] = prevPts + delta + bonus;
    updates[`players.${pid}.racha`] = newRacha;
    updates[`players.${pid}.mejorRacha`] = best;
  }

  const currentIndex = room.indiceActual ?? 0;
  const nextIndex = currentIndex + 1;
  const total = room.config?.numPeliculas ?? (room.playlist?.length ?? 0);
  const now = Date.now();

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
      answers: {}
    };
  }

  dlog("hostScoreAndAdvance() -> updating room", {
    updatesKeys: Object.keys(updates),
    nextEstado: updates.estado || "jugando",
    nextIndice: updates.indiceActual ?? "(same)",
    nextRound: updates.round ? { startAt: updates.round.startAt, movieIndex: updates.round.movieIndex } : null
  });

  await updateRoom(roomId, updates);
}

// ------------------------------------------------------
// UI helpers
// ------------------------------------------------------
function resetAnswerUIForNewRound() {
  dlog("resetAnswerUIForNewRound()");

  pendingAnswerForStartAt = null;
  const input = $("answerInput");
  input.value = "";
  $("answerStatus").textContent = "Nueva ronda: escribe tu respuesta 👇";
  setTimeout(() => input.focus(), 0);
}

function syncAnswerUI(room) {
  dgroup("syncAnswerUI() ENTER", snapMini(room));

  const round = room.round || {};
  const hasRound = !!round.startAt && round.movieIndex != null;

  if (!hasRound) {
    dlog("syncAnswerUI() -> no round yet -> DISABLE input");
    $("answerInput").disabled = true;
    $("btnAnswer").disabled = true;
    $("answerStatus").textContent = "Esperando a que empiece la ronda...";
    return;
  }

  const myAns = round.answers?.[playerId];
  const already = !!myAns && myAns.roundStartAt === round.startAt;

  // Si acabo de enviar pero snapshot aún no lo refleja
  if (!already && pendingAnswerForStartAt != null && pendingAnswerForStartAt === round.startAt) {
    dlog("syncAnswerUI() -> pending local send -> DISABLE input");
    $("answerInput").disabled = true;
    $("btnAnswer").disabled = true;
    $("answerStatus").textContent = "Respuesta enviada ✅ (sincronizando...)";
    return;
  }

  // Si ya se confirmó, limpia pending
  if (already && pendingAnswerForStartAt === round.startAt) {
    dlog("syncAnswerUI() -> snapshot confirmed -> clear pending");
    pendingAnswerForStartAt = null;
  }

  dlog("syncAnswerUI() -> set disabled =", already);
  $("answerInput").disabled = already;
  $("btnAnswer").disabled = already;

  $("answerStatus").textContent = already
    ? "Respuesta enviada ✅ (esperando al resto)"
    : "Aún no has respondido.";
}

// ------------------------------------------------------
// renderRoom
// ------------------------------------------------------
function renderRoom(room) {
  dgroup("renderRoom() ENTER", snapMini(room));

  if (!room) {
    setError("La sala no existe o ha sido eliminada.");
    return;
  }

  if (room.estado === "finalizada") {
    window.location.href = `results.html?room=${encodeURIComponent(roomId)}`;
    return;
  }

  // IMPORTANTE: aquí NO redirigimos al host.
  if (room.estado === "esperando") {
    $("countdownText").textContent = "-";
    setStatus("Esperando a que el host inicie la partida...");
    $("answerInput").disabled = true;
    $("btnAnswer").disabled = true;
    $("answerStatus").textContent = "Esperando a que empiece la ronda...";
    setError("");
    return;
  }

  if (room.estado !== "jugando") {
    window.location.href = `lobby.html?room=${encodeURIComponent(roomId)}`;
    return;
  }

  setError("");

  const cfg = room.config || {};
  $("modoText").textContent = cfg.modoJuego || "-";
  $("modoRondaText").textContent = cfg.modoRonda || "-";

  const idx = room.indiceActual ?? 0;
  const total = cfg.numPeliculas ?? (room.playlist?.length ?? "?");
  $("roundText").textContent = `${idx + 1} / ${total}`;

  renderPlayers(room.players);
  renderScores(room.players);

  // Host asegura que existe ronda
  ensureRoundInitialized(room).catch(err => console.error("init round:", err));

  // Detectar ronda nueva por índice
  if (idx !== lastRoundIndex) {
    dlog("NEW ROUND detected by idx change", { prev: lastRoundIndex, next: idx });
    lastRoundIndex = idx;
    lastScheduledStartAt = null;
    clearTimers();
    resetAnswerUIForNewRound();
  }

  const round = room.round || {};
  const hasRound = !!round.startAt && round.movieIndex != null;

  if (hasRound) {
    const url = getAudioUrlFromMovieIndex(round.movieIndex);
    scheduleSynchronizedPlay(round.startAt, url);
  } else {
    $("countdownText").textContent = "-";
    setStatus("Esperando sincronización...");
  }

  // UI respuesta (UNA sola vez)
  syncAnswerUI(room);

  // Scoring host
  hostScoreAndAdvance(room).catch(err => console.error("score:", err));
}

// ------------------------------------------------------
// Events
// ------------------------------------------------------
$("btnAnswer").addEventListener("click", async () => {
  if (!window.__currentRoom) return;
  try {
    await submitAnswer(window.__currentRoom);
  } catch (e) {
    setError(e?.message || "No se pudo enviar la respuesta.");
  }
});

$("answerInput").addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    if (!window.__currentRoom) return;
    try {
      await submitAnswer(window.__currentRoom);
    } catch (err) {
      setError(err?.message || "No se pudo enviar la respuesta.");
    }
  }
});

// Listen
if (roomId) {
  dlogOnce("startup", "Starting listenRoom()", { roomId, playerId });

  unsub = listenRoom(roomId, (room) => {
    window.__currentRoom = room;

    __snapN++;
    dgroup(`SNAP #${__snapN}`, snapMini(room));

    renderRoom(room);
  });
}

window.addEventListener("beforeunload", () => {
  clearTimers();
  unsub?.();
});
