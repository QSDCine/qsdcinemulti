import { listenRoom, updateRoom } from "./firestore-utils.js";
import { REGLAS } from "./reglas.js";

function $(id) { return document.getElementById(id); }

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function getOrCreatePlayerId() {
  const key = "qsdcmulti_playerId";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
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

// ⚠️ TEMPORAL: sustituiremos esto por tu array real más adelante
function getSolutionForMovieIndex(movieIndex) {
  // Por ahora, para probar: la respuesta correcta es el número del índice
  return String(movieIndex);
}

// ⚠️ TEMPORAL: url por índice. Luego lo conectamos a tu estructura real
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

  // ordenar por puntos desc
  arr.sort((a, b) => (b.puntos - a.puntos) || a.nick.localeCompare(b.nick));

  for (const p of arr) {
    const li = document.createElement("li");
    li.textContent = `${p.nick}: ${p.puntos} pts (racha: ${p.racha})`;
    ul.appendChild(li);
  }
}

const roomId = (getParam("room") || "").toUpperCase().trim();
const playerId = getOrCreatePlayerId();

if (!roomId) {
  setError("Falta el parámetro de sala. Vuelve al lobby.");
}

$("roomIdText").textContent = roomId;
$("btnBack").addEventListener("click", () => {
  window.location.href = `lobby.html?room=${encodeURIComponent(roomId)}`;
});

let unsub = null;
let countdownInterval = null;
let scheduledPlayTimeout = null;
let lastScheduledStartAt = null;
let lastRoundStartAt = null;


function clearTimers() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = null;

  if (scheduledPlayTimeout) clearTimeout(scheduledPlayTimeout);
  scheduledPlayTimeout = null;
}

function scheduleSynchronizedPlay(startAtMs, audioUrl) {
  if (lastScheduledStartAt === startAtMs) return;
  lastScheduledStartAt = startAtMs;

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
    const sec = Math.ceil(diff / 1000);

    if (diff <= 0) $("countdownText").textContent = "¡YA!";
    else $("countdownText").textContent = String(sec);
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

// --- Respuesta: escribir a Firestore ---
async function submitAnswer(room) {
  const input = $("answerInput");
  const raw = input.value.trim();
  if (!raw) return;

  const round = room.round || {};
  const movieIndex = round.movieIndex;
  if (movieIndex == null) return;

  const correct = normalizeAnswer(raw) === normalizeAnswer(getSolutionForMovieIndex(movieIndex));

  // Guardamos la respuesta en la sala (por jugador)
  // Estructura: round.answers[playerId] = { raw, correct, ts }
  await updateRoom(roomId, {
    [`round.answers.${playerId}`]: {
      raw,
      correct,
      ts: Date.now()
    }
  });

  input.disabled = true;
  $("btnAnswer").disabled = true;
  $("answerStatus").textContent = "Respuesta enviada ✅ (esperando al resto)";
}

// --- Scoring: lo hace SOLO el host cuando todos respondieron ---
function allPlayersAnswered(room) {
  const players = Object.keys(room.players || {});
  const answers = room.round?.answers || {};
  return players.length > 0 && players.every(pid => answers[pid] != null);
}

function computePointsFor(mode, correct) {
  // MVP: sin pistas, sin rendición, sin intentos todavía.
  // Locura: +10 / -20
  // Extremo: +7 / -3
  // Normal y Contrarreloj: +5 / 0
  if (mode === "locura") return correct ? 10 : -20;
  if (mode === "extremo") return correct ? 7 : -3;
  // normal / contrarreloj
  return correct ? 5 : 0;
}

async function hostScoreAndAdvance(room) {
  const isHost = room.hostId === playerId;
  if (!isHost) return;

  const round = room.round || {};
  if (!round.answers) return;

  // Evitar doble scoring
  if (round.scoredAt) return;

  if (!allPlayersAnswered(room)) return;

  const mode = room.config?.modoJuego || "normal";
  const answers = round.answers;

  // Preparar updates
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

    // Bonus por racha cada 10 (igual que tu juego)
    let bonus = 0;
    if (correct && newRacha > 0 && newRacha % 10 === 0) {
      bonus = newRacha; // +10, +20, ...
    }

    updates[`players.${pid}.puntos`] = prevPts + delta + bonus;
    updates[`players.${pid}.racha`] = newRacha;
    updates[`players.${pid}.mejorRacha`] = best;
  }

  // Marcar ronda como puntuada
  updates["round.scoredAt"] = Date.now();

  // Avanzar a siguiente (o finalizar)
  const nextIndex = (room.indiceActual ?? 0) + 1;
  const total = room.config?.numPeliculas ?? (room.playlist?.length ?? 0);

if (nextIndex >= total) {
  updates.estado = "finalizada";
} else {
  updates.indiceActual = nextIndex;
  // Reset de la ronda para que el host inicialice la siguiente
  updates.round = {};
}

  await updateRoom(roomId, updates);
}

// Inicializar ronda si falta (solo host)
async function ensureRoundInitialized(room) {
  const isHost = room.hostId === playerId;
  if (!isHost) return;

  const round = room.round || {};
  if (round.startAt && round.movieIndex != null) return;

  const playlist = room.playlist || [];
  const idx = room.indiceActual ?? 0;
  const movieIndex = playlist[idx];

  const startAt = Date.now() + 3000;

  await updateRoom(roomId, {
    round: {
      movieIndex,
      startAt,
      answers: {} // empezamos limpio
    }
  });
}

function syncAnswerUI(room) {
  const round = room.round || {};
  const already = round.answers?.[playerId];

  $("answerInput").disabled = !!already;
  $("btnAnswer").disabled = !!already;
  $("answerStatus").textContent = already ? "Ya has respondido ✅" : "Aún no has respondido.";
}

function resetAnswerUIForNewRound() {
  const input = $("answerInput");
  const btn = $("btnAnswer");

  input.value = "";
  input.disabled = false;
  btn.disabled = false;

  $("answerStatus").textContent = "Nueva ronda: escribe tu respuesta 👇";

  // foco automático para que puedan teclear directo
  // (pequeño timeout para asegurar que el DOM está pintado)
  setTimeout(() => input.focus(), 0);
}


function renderRoom(room) {
  if (!room) {
    setError("La sala no existe o ha sido eliminada.");
    return;
  }

  // Fin de partida
if (room.estado === "finalizada") {
  window.location.href = `results.html?room=${encodeURIComponent(roomId)}`;
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

  // Inicializar ronda (host)
  ensureRoundInitialized(room).catch(err => console.error("init round:", err));

  // Reproducir sincronizado
  const round = room.round || {};
// ✅ Detectar ronda nueva por startAt y resetear UI
if (round.startAt && round.startAt !== lastRoundStartAt) {
  lastRoundStartAt = round.startAt;
  resetAnswerUIForNewRound();
}

  if (round.startAt && round.movieIndex != null) {
    const url = getAudioUrlFromMovieIndex(round.movieIndex);
    scheduleSynchronizedPlay(round.startAt, url);
  } else {
    $("countdownText").textContent = "-";
    setStatus("Esperando sincronización...");
  }

  // UI respuesta
  syncAnswerUI(room);

  // Scoring + avanzar (host)
  hostScoreAndAdvance(room).catch(err => console.error("score:", err));
}

// Botón enviar respuesta
$("btnAnswer").addEventListener("click", async () => {
  // Necesitamos el room actual; lo mantenemos en una variable
  if (!window.__currentRoom) return;
  try {
    await submitAnswer(window.__currentRoom);
  } catch (e) {
    setError(e?.message || "No se pudo enviar la respuesta.");
  }
});

// Enter en input
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
  unsub = listenRoom(roomId, (room) => {
    window.__currentRoom = room;
    renderRoom(room);
  });
}

window.addEventListener("beforeunload", () => {
  clearTimers();
  unsub?.();
});
