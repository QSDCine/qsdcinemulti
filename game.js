import { listenRoom, updateRoom } from "./firestore-utils.js";
import { movies } from "./movies.js";

/* ============================
   STATE LOCAL
============================ */
let hintsUsedThisRound = 0;
let revealedHintBtns = new Set();      // pistas “contadas” (penalización)
let openedHintIdx = new Set();         // pistas abiertas (UI)
let pendingAnswerForStartAt = null;

let audioUnlocked = false;
let pendingPlay = null; // { startAtMs, audioUrl }

let countdownInterval = null;
let scheduledPlayTimeout = null;

let lastScheduledStartAt = null;
let lastRoundIndex = -1;
let lastHintsRenderedStartAt = null;

// Para evitar “freeze” por revealUntil: timer local del host
let hostAdvanceTimer = null;

/* ============================
   HELPERS
============================ */
function $(id) { return document.getElementById(id); }

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
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
  const el = $("statusText");
  if (el) el.textContent = txt;
}

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
  return movies?.[movieIndex] || null;
}

function getAudioUrlFromMovieIndex(movieIndex) {
  const m = getMovie(movieIndex);
  return m?.audio || "";
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

/* ============================
   PLAYER ID (device + tab)
============================ */
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
  const deviceId = getOrCreateDeviceId();
  const tabId = getOrCreateTabId();
  return `${deviceId}:${tabId}`;
}

/* ============================
   ROOM INIT
============================ */
const roomId = (getParam("room") || "").toUpperCase().trim();
const tabId = getOrCreateTabId();
const playerId = getOrCreatePlayerId();

if (!roomId) setError("Falta el parámetro de sala. Vuelve al lobby.");
if ($("roomIdText")) $("roomIdText").textContent = roomId;

const btnBack = $("btnBack");
if (btnBack) {
  btnBack.addEventListener("click", () => {
    window.location.href = `lobby.html?room=${encodeURIComponent(roomId)}&tab=${encodeURIComponent(tabId)}`;
  });
}

/* ============================
   AUDIO UNLOCK (overlay)
   - Importante: desbloqueamos con el MISMO <audio id="audio">
============================ */
function showAudioOverlay(show) {
  const overlay = $("audioUnlockOverlay");
  if (!overlay) return;
  overlay.style.display = show ? "flex" : "none";
}

async function unlockAudioWithUserGesture() {
  if (audioUnlocked) return true;

  const audio = $("audio");
  if (!audio) return false;

  try {
    // Si hay un play pendiente, ponemos esa src antes del play/pause
    if (pendingPlay && pendingPlay.audioUrl) {
      if (audio.src !== pendingPlay.audioUrl) {
        audio.src = pendingPlay.audioUrl;
        audio.load();
      }
    }

    // El truco “play/pause” DENTRO del click del usuario
    const prevMuted = audio.muted;
    audio.muted = true;

    await audio.play();
    audio.pause();
    audio.currentTime = 0;

    audio.muted = prevMuted;

    audioUnlocked = true;
    showAudioOverlay(false);

    // Si teníamos reproducción pendiente, re-programamos
    if (pendingPlay) {
      const { startAtMs, audioUrl } = pendingPlay;
      pendingPlay = null;
      scheduleSynchronizedPlay(startAtMs, audioUrl);
    }

    return true;
  } catch (e) {
    console.warn("No se pudo desbloquear audio:", e);
    return false;
  }
}

function attachUnlockHandlers() {
  const btn = $("btnUnlockAudio");
  if (btn) {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await unlockAudioWithUserGesture();
    });
  }

  // El overlay no debe quedarse pegado “para siempre”
  // Si el usuario pulsa play manual del control del audio, esto también cuenta:
  const audio = $("audio");
  if (audio) {
    audio.addEventListener("play", () => {
      if (!audioUnlocked) {
        audioUnlocked = true;
        showAudioOverlay(false);
        // Si había algo pendiente, intentamos reprogramar
        if (pendingPlay) {
          const { startAtMs, audioUrl } = pendingPlay;
          pendingPlay = null;
          scheduleSynchronizedPlay(startAtMs, audioUrl);
        }
      }
    });
  }
}

/* ============================
   TIMERS / SYNC PLAY
============================ */
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

  // Preparar audio
  audio.pause();
  audio.currentTime = 0;
  audio.src = audioUrl;
  audio.load();

  // Cuenta atrás siempre visible
  const tick = () => {
    const now = Date.now();
    const diff = startAtMs - now;
    const sec = Math.max(0, Math.floor((diff + 999) / 1000));
    const cd = $("countdownText");
    if (cd) cd.textContent = diff <= 0 ? "¡YA!" : String(sec);
  };
  tick();
  countdownInterval = setInterval(tick, 200);

  const delay = Math.max(0, startAtMs - Date.now());

  // Si no está desbloqueado, guardamos y mostramos overlay, pero NO bloqueamos el juego
  if (!audioUnlocked) {
    pendingPlay = { startAtMs, audioUrl };
    setStatus("Audio pendiente (móvil puede bloquear autoplay).");
    showAudioOverlay(true);
    return;
  }

  setStatus("Preparando audio...");

  scheduledPlayTimeout = setTimeout(async () => {
    try {
      setStatus("Reproduciendo...");
      await audio.play();
    } catch (e) {
      // Si aún bloquea, overlay pero el juego sigue
      setStatus("Pulsa play o “Activar audio” si el navegador lo bloquea.");
      showAudioOverlay(true);
      console.warn("Autoplay bloqueado:", e);
    }
  }, delay);
}

/* ============================
   RENDER PLAYERS / SCORES
============================ */
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

/* ============================
   ROUND INIT (HOST)
============================ */
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

/* ============================
   MODE UI (description + surrender)
============================ */
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

/* ============================
   HINTS (render ONCE per round.startAt)
============================ */
async function updateHintsUsedFirestore(roundStartAt) {
  try {
    await updateRoom(roomId, {
      [`round.hintsUsed.${playerId}`]: hintsUsedThisRound,
      [`round.hintsUsedStartAt.${playerId}`]: roundStartAt
    });
  } catch (e) {
    console.warn("No se pudo guardar hintsUsed:", e);
  }
}

function renderHintsForRound(room) {
  const hc = $("hintsContainer");
  if (!hc) return;

  const mode = room.config?.modoJuego || "normal";
  if (mode !== "normal" && mode !== "contrarreloj") {
    hc.innerHTML = "";
    lastHintsRenderedStartAt = room.round?.startAt ?? null;
    return;
  }

  const round = room.round || {};
  const startAt = round.startAt ?? null;

  // ✅ Render solo si cambia la ronda
  if (startAt && lastHintsRenderedStartAt === startAt) {
    // re-aplicar visible según estado local abierto/cerrado (sin recrear)
    const divs = hc.querySelectorAll("[data-hint-div='1']");
    divs.forEach(div => {
      const idx = Number(div.getAttribute("data-hint-idx"));
      div.style.display = openedHintIdx.has(idx) ? "block" : "none";
    });
    return;
  }

  lastHintsRenderedStartAt = startAt;

  hc.innerHTML = "";
  openedHintIdx = new Set();
  revealedHintBtns = new Set();
  hintsUsedThisRound = 0;

  const m = getMovie(round.movieIndex);
  const hints = m?.hints || [];
  if (!hints.length) return;

  hints.forEach((hint, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `Mostrar pista ${i + 1}`;

    const div = document.createElement("div");
    div.className = "spoiler";
    div.textContent = hint;
    div.style.display = "none";
    div.setAttribute("data-hint-div", "1");
    div.setAttribute("data-hint-idx", String(i));

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Toggle
      const willOpen = div.style.display === "none";
      div.style.display = willOpen ? "block" : "none";

      if (willOpen) openedHintIdx.add(i);
      else openedHintIdx.delete(i);

      // Penalizar SOLO la primera vez que se abre esa pista en ESTA ronda
      if (willOpen && !revealedHintBtns.has(i)) {
        revealedHintBtns.add(i);
        hintsUsedThisRound += 1;
        await updateHintsUsedFirestore(round.startAt);
      }
    });

    hc.appendChild(btn);
    hc.appendChild(div);
  });
}

/* ============================
   SUBMIT ANSWER / SURRENDER / PASS
============================ */
async function submitAnswer(room, opts = {}) {
  const surrendered = !!opts.surrendered;

  const round = room.round || {};
  if (!round.startAt || round.movieIndex == null) return;

  const myAns = round.answers?.[playerId];
  if (myAns && myAns.roundStartAt === round.startAt) return;

  const input = $("answerInput");
  const raw = input ? String(input.value || "").trim() : "";

  // ✅ Enter con input vacío: permitido (será incorrecto)
  const correct = surrendered ? false : isCorrectAnswer(raw, round.movieIndex);

  pendingAnswerForStartAt = round.startAt;

  if (input) input.disabled = true;

  const btnAnswer = $("btnAnswer");
  if (btnAnswer) btnAnswer.disabled = true;

  const btnSurrender = $("btnSurrender");
  if (btnSurrender) btnSurrender.disabled = true;

  const title = getPrimaryTitle(round.movieIndex);
  const status = $("answerStatus");
  if (status) {
    if (surrendered) status.textContent = `Te has rendido 🏳️ Era: ${title} (esperando al resto)`;
    else if (correct) status.textContent = "¡Correcto! ✅ (esperando al resto)";
    else status.textContent = `Incorrecto ❌ Era: ${title} (esperando al resto)`;
  }

  await updateRoom(roomId, {
    [`round.answers.${playerId}`]: {
      raw,
      correct,
      surrendered,
      ts: Date.now(),
      roundStartAt: round.startAt
    }
  });
}

/* ============================
   HOST SCORING + ADVANCE (con revealUntil)
   - FIX “freeze”: programamos un timer local tras fijar revealUntil
============================ */
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

function clearHostAdvanceTimer() {
  if (hostAdvanceTimer) {
    clearTimeout(hostAdvanceTimer);
    hostAdvanceTimer = null;
  }
}

function scheduleHostAdvanceCheck(whenMs) {
  clearHostAdvanceTimer();
  const delay = Math.max(0, whenMs - Date.now()) + 50; // colchón
  hostAdvanceTimer = setTimeout(() => {
    if (window.__currentRoom) {
      hostScoreAndAdvance(window.__currentRoom).catch(() => {});
    }
  }, delay);
}

async function hostScoreAndAdvance(room) {
  const isHost = room.hostId === playerId;
  if (!isHost) return;

  const round = room.round || {};
  if (!round.answers) return;
  if (!allPlayersAnswered(room)) return;

  const now = Date.now();

  // 1) Fijar revealUntil una vez
  if (!round.revealUntil) {
    const until = now + 1500;
    await updateRoom(roomId, { "round.revealUntil": until });
    // ✅ clave: aunque no haya “otro snapshot”, nos auto-disparamos luego
    scheduleHostAdvanceCheck(until);
    return;
  }

  // 2) Esperar a que pase
  if (now < round.revealUntil) {
    scheduleHostAdvanceCheck(round.revealUntil);
    return;
  }

  // Evitar doble scoring
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
      // incorrecto = -3, rendirse = -5
      if (surrendered) delta = -5;
      else delta = correct ? 7 : -3;
    } else {
      // normal / contrarreloj:
      // rendirse = -3
      // correcto = 5 - pistas (mín 0)
      // incorrecto = 0
      if (surrendered) {
        delta = -3;
      } else if (correct) {
        const hintsUsed = round.hintsUsed?.[pid] ?? 0;
        const okStart = round.hintsUsedStartAt?.[pid] === round.startAt;
        const used = okStart ? hintsUsed : 0;
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

/* ============================
   UI RESET / SYNC
============================ */
function resetAnswerUIForNewRound() {
  pendingAnswerForStartAt = null;

  const input = $("answerInput");
  if (input) {
    input.value = "";
    input.disabled = false;
    setTimeout(() => input.focus(), 0);
  }

  const btnAnswer = $("btnAnswer");
  if (btnAnswer) btnAnswer.disabled = false;

  const btnSurrender = $("btnSurrender");
  if (btnSurrender) btnSurrender.disabled = false;

  const status = $("answerStatus");
  if (status) status.textContent = "Nueva ronda: escribe tu respuesta 👇";

  hintsUsedThisRound = 0;
  revealedHintBtns = new Set();
  openedHintIdx = new Set();

  clearHostAdvanceTimer();
}

function syncAnswerUI(room) {
  const round = room.round || {};
  const hasRound = !!round.startAt && round.movieIndex != null;

  const input = $("answerInput");
  const btnAnswer = $("btnAnswer");
  const btnSurrender = $("btnSurrender");
  const status = $("answerStatus");

  if (!hasRound) {
    if (input) input.disabled = true;
    if (btnAnswer) btnAnswer.disabled = true;
    if (btnSurrender) btnSurrender.disabled = true;
    if (status) status.textContent = "Esperando a que empiece la ronda...";
    return;
  }

  const myAns = round.answers?.[playerId];
  const already = !!myAns && myAns.roundStartAt === round.startAt;

  // pending local send
  if (!already && pendingAnswerForStartAt != null && pendingAnswerForStartAt === round.startAt) {
    if (input) input.disabled = true;
    if (btnAnswer) btnAnswer.disabled = true;
    if (btnSurrender) btnSurrender.disabled = true;
    return;
  }

  if (already && pendingAnswerForStartAt === round.startAt) {
    pendingAnswerForStartAt = null;
  }

  if (input) input.disabled = already;
  if (btnAnswer) btnAnswer.disabled = already;
  if (btnSurrender) btnSurrender.disabled = already;

  if (already && status) {
    const title = getPrimaryTitle(round.movieIndex);
    if (myAns.surrendered) status.textContent = `Te rendiste 🏳️ Era: ${title} (esperando al resto)`;
    else if (myAns.correct) status.textContent = "¡Correcto! ✅ (esperando al resto)";
    else status.textContent = `Incorrecto ❌ Era: ${title} (esperando al resto)`;
    return;
  }

  if (!already && status) {
    status.textContent = "Aún no has respondido.";
  }
}

/* ============================
   RENDER ROOM
============================ */
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
    const cd = $("countdownText");
    if (cd) cd.textContent = "-";
    setStatus("Esperando a que el host inicie la partida...");

    const input = $("answerInput");
    const btnAnswer = $("btnAnswer");
    const btnSurrender = $("btnSurrender");
    const status = $("answerStatus");

    if (input) input.disabled = true;
    if (btnAnswer) btnAnswer.disabled = true;
    if (btnSurrender) btnSurrender.disabled = true;
    if (status) status.textContent = "Esperando a que empiece la ronda...";
    setError("");
    return;
  }

  if (room.estado !== "jugando") {
    window.location.href = `lobby.html?room=${encodeURIComponent(roomId)}&tab=${encodeURIComponent(tabId)}`;
    return;
  }

  setError("");

  const cfg = room.config || {};
  if ($("modoText")) $("modoText").textContent = cfg.modoJuego || "-";
  if ($("modoRondaText")) $("modoRondaText").textContent = cfg.modoRonda || "-";

  const idx = room.indiceActual ?? 0;
  const total = cfg.numPeliculas ?? (room.playlist?.length ?? "?");
  if ($("roundText")) $("roundText").textContent = `${idx + 1} / ${total}`;

  renderPlayers(room.players);
  renderScores(room.players);

  ensureRoundInitialized(room).catch(err => console.error("init round:", err));

  // Detectar nueva ronda por índice
  if (idx !== lastRoundIndex) {
    lastRoundIndex = idx;
    lastScheduledStartAt = null;
    lastHintsRenderedStartAt = null;
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
    const cd = $("countdownText");
    if (cd) cd.textContent = "-";
    setStatus("Esperando sincronización...");
  }

  syncAnswerUI(room);

  // Host scoring + avance (con fix de freeze)
  hostScoreAndAdvance(room).catch(err => console.error("score:", err));
}

/* ============================
   EVENTS
============================ */
function bindEvents() {
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

  const input = $("answerInput");
  if (input) {
    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      if (!window.__currentRoom) return;
      try {
        await submitAnswer(window.__currentRoom);
      } catch (err) {
        setError(err?.message || "No se pudo enviar la respuesta.");
      }
    });
  }
}

/* ============================
   START
============================ */
attachUnlockHandlers();
bindEvents();

let unsub = null;
if (roomId) {
  unsub = listenRoom(roomId, (room) => {
    window.__currentRoom = room;
    renderRoom(room);
  });
}

window.addEventListener("beforeunload", () => {
  clearTimers();
  clearHostAdvanceTimer();
  if (unsub) unsub();
});
