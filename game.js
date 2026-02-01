import { listenRoom, updateRoom } from "./firestore-utils.js";

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

const roomId = (getParam("room") || "").toUpperCase().trim();
const playerId = getOrCreatePlayerId();

if (!roomId) {
  setError("Falta el parámetro de sala. Vuelve al lobby.");
}

$("roomIdText").textContent = roomId;

// Volver al lobby
$("btnBack").addEventListener("click", () => {
  window.location.href = `lobby.html?room=${encodeURIComponent(roomId)}`;
});

// AUDIO: aquí vamos a usar una función placeholder.
// Luego la conectamos a tu array real (script.js) sin dolor.
function getAudioUrlFromMovieIndex(movieIndex) {
  // Ajusta esto cuando conectemos tu array real.
  // Ejemplo típico si tus mp3 están en /audio/xxx.mp3:
  // return `audio/${movieIndex}.mp3`;
  return `audio/${movieIndex}.mp3`;
}

let unsub = null;
let countdownInterval = null;
let scheduledPlayTimeout = null;
let lastScheduledStartAt = null;

function clearTimers() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = null;

  if (scheduledPlayTimeout) clearTimeout(scheduledPlayTimeout);
  scheduledPlayTimeout = null;
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

function scheduleSynchronizedPlay(startAtMs, audioUrl) {
  // Evitar reprogramar si es el mismo startAt
  if (lastScheduledStartAt === startAtMs) return;
  lastScheduledStartAt = startAtMs;

  clearTimers();

  const audio = $("audio");
  audio.pause();
  audio.currentTime = 0;
  audio.src = audioUrl;
  audio.load();

  setStatus("Preparando audio...");

  // Countdown visible hacia startAt
  const tick = () => {
    const now = Date.now();
    const diff = startAtMs - now;
    const sec = Math.ceil(diff / 1000);

    if (diff <= 0) {
      $("countdownText").textContent = "¡YA!";
    } else {
      $("countdownText").textContent = String(sec);
    }
  };

  tick();
  countdownInterval = setInterval(tick, 200);

  // Programar play exacto
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

async function ensureRoundInitialized(room) {
  // Si no hay round o le falta startAt, lo inicializa SOLO el host.
  const isHost = room.hostId === playerId;
  if (!isHost) return;

  const round = room.round || {};
  if (round.startAt && round.movieIndex != null) return;

  const playlist = room.playlist || [];
  const idx = room.indiceActual ?? 0;
  const movieIndex = playlist[idx];

  // startAt 3 segundos en el futuro
  const startAt = Date.now() + 3000;

  await updateRoom(roomId, {
    round: {
      movieIndex,
      startAt
    }
  });
}

function renderRoom(room) {
  if (!room) {
    setError("La sala no existe o ha sido eliminada.");
    return;
  }

  if (room.estado !== "jugando") {
    // Si vuelve a lobby o finaliza, redirigimos al lobby
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

  // Inicializar la ronda si hace falta (solo host)
  ensureRoundInitialized(room).catch(err => {
    console.error("No se pudo inicializar ronda:", err);
  });

  // Si round existe, programamos audio sincronizado
  const round = room.round || {};
  if (round.startAt && round.movieIndex != null) {
    const url = getAudioUrlFromMovieIndex(round.movieIndex);
    scheduleSynchronizedPlay(round.startAt, url);
  } else {
    $("countdownText").textContent = "-";
    setStatus("Esperando sincronización...");
  }
}

if (roomId) {
  unsub = listenRoom(roomId, renderRoom);
}

window.addEventListener("beforeunload", () => {
  clearTimers();
  unsub?.();
});
