import { listenRoom, updateRoom } from "./firestore-utils.js";
import { movies } from "./movies.js";

// ============================
// Helpers DOM
// ============================
function $(id) { return document.getElementById(id); }

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// ============================
// Player identity (must be stable via ?tab=)
// ============================
function getOrCreateDeviceId() {
  const key = "qsdcmulti_deviceId";
  let v = localStorage.getItem(key);
  if (!v) {
    v = crypto.randomUUID();
    localStorage.setItem(key, v);
  }
  return v;
}

function getOrCreateTabId() {
  const key = "qsdcmulti_tabId";

  const urlTab = getParam("tab");
  if (urlTab) {
    sessionStorage.setItem(key, urlTab);
    return urlTab;
  }

  let v = sessionStorage.getItem(key);
  if (!v) {
    v = crypto.randomUUID();
    sessionStorage.setItem(key, v);
  }
  return v;
}

function getPlayerId() {
  return `${getOrCreateDeviceId()}:${getOrCreateTabId()}`;
}

// ============================
// UI helpers
// ============================
function setError(msg) {
  const el = $("gameError");
  if (!el) return;
  if (!msg) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  el.style.display = "block";
  el.textContent = msg;
}

function setStatus(txt) {
  const el = $("statusText");
  if (el) el.textContent = txt || "";
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

function getMovie(idx) {
  return movies && movies[idx] ? movies[idx] : null;
}

function getPrimaryTitle(idx) {
  const m = getMovie(idx);
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

function getAudioUrl(movieIndex) {
  const m = getMovie(movieIndex);
  return m?.audio || "";
}

// ============================
// Render lists
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
// Local round state (client)
// ============================
let pendingAnswerForStartAt = null;
let lastRoundIndex = -1;
let lastScheduledStartAt = null;

let hintsUsedThisRound = 0;
let revealedHintBtns = new Set();

// ============================
// Timers / audio sync
// ============================
let countdownInterval = null;
let scheduledPlayTimeout = null;

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

  // Cargamos el audio SIEMPRE. Si el autoplay falla, el usuario puede darle play.
  audio.pause();
  audio.currentTime = 0;
  audio.src = audioUrl;
  audio.load();

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
  scheduledPlayTimeout = setTimeout(async () => {
    try {
      setStatus("Reproduciendo...");
      await audio.play();
      setStatus("");
    } catch (e) {
      // Importante: NO bloqueamos nada, solo avisamos.
      setStatus("Pulsa ▶️ si el navegador bloquea el autoplay (solo la primera vez).");
    }
  }, delay);
}

// ============================
// Hints + description + surrender UI per mode
// ============================
function applyModeUI(room) {
  const mode = room.config?.modoJuego || "normal";
  const round = room.round || {};
  const m = getMovie(round.movieIndex);

  const desc = $("descriptionText");
  const surrenderBtn = $("btnSurrender");

  // Descripción: en todos menos locura
  if (desc) {
    if (mode === "locura") desc.textContent = "";
    else desc.textContent = m?.description || "";
  }

  // Rendirse: en todos menos locura
  if (surrenderBtn) {
    surrenderBtn.style.display = (mode === "locura") ? "none" : "inline-block";
  }
}

// Render pistas SOLO una vez por ronda (para que no parpadeen con snapshots)
function buildHintsForRound(room) {
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
    div.className = "spoiler";
    div.style.display = "none";
    div.textContent = hint;

    btn.addEventListener("click", async () => {
      const wasHidden = (div.style.display === "none");
      div.style.display = wasHidden ? "block" : "none";

      // Penaliza solo la 1ª vez que se revela esa pista
      if (wasHidden && !revealedHintBtns.has(i)) {
        revealedHintBtns.add(i);
        hintsUsedThisRound++;

        // Guardamos hintsUsed para que el host puntúe bien (5 - pistas)
        try {
          await updateRoom(roomId, {
            [`round.hintsUsed.${playerId}`]: hintsUsedThisRound,
            [`round.hintsUsedStartAt.${playerId}`]: round.startAt
          });
        } catch {
          // silencioso: no rompemos UX
        }
      }
    });

    hc.appendChild(btn);
    hc.appendChild(div);
  });
}

// ============================
// Round init (host only)
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

  const now = Date.now();

  await updateRoom(roomId, {
    round: {
      movieIndex,
      startAt: now + 3000,
      answers: {},
      hintsUsed: {},
      hintsUsedStartAt: {},
      revealUntil: null
    }
  });
}

// ============================
// Submit answer (allow empty enter) + surrender
// ============================
async function submitAnswer(room, opts = {}) {
  const surrendered = !!opts.surrendered;

  const round = room.round || {};
  if (!round.startAt || round.movieIndex == null) return;

  const myAns = round.answers?.[playerId];
  if (myAns && myAns.roundStartAt === round.startAt) return;

  const input = $("answerInput");
  const raw = input ? String(input.value || "") : "";
  const trimmed = raw.trim(); // puede ser ""

  const correct = surrendered ? false : isCorrectAnswer(trimmed, round.movieIndex);

  // bloqueo local inmediato
  pendingAnswerForStartAt = round.startAt;

  if (input) input.disabled = true;
  const btnAnswer = $("btnAnswer");
  if (btnAnswer) btnAnswer.disabled = true;

  const btnSurrender = $("btnSurrender");
  if (btnSurrender) btnSurrender.disabled = true;

  // feedback local
  const title = getPrimaryTitle(round.movieIndex);
  const st = $("answerStatus");
  if (st) {
    if (surrendered) st.textContent = `Te has rendido 🏳️ Era: ${title} (esperando al resto)`;
    else if (correct) st.textContent = "¡Correcto! ✅ (esperando al resto)";
    else st.textContent = `Incorrecto ❌ Era: ${title} (esperando al resto)`;
  }

  await updateRoom(roomId, {
    [`round.answers.${playerId}`]: {
      raw: trimmed,               // puede ser ""
      correct,
      surrendered,
      ts: Date.now(),
      roundStartAt: round.startAt
    }
  });
}

// ============================
// Answer UI sync
// ============================
function syncAnswerUI(room) {
  const round = room.round || {};
  const hasRound = !!round.startAt && round.movieIndex != null;

  const input = $("answerInput");
  const btnAnswer = $("btnAnswer");
  const btnSurrender = $("btnSurrender");
  const st = $("answerStatus");

  if (!hasRound) {
    if (input) input.disabled = true;
    if (btnAnswer) btnAnswer.disabled = true;
    if (btnSurrender) btnSurrender.disabled = true;
    if (st) st.textContent = "Esperando a que empiece la ronda...";
    return;
  }

  const myAns = round.answers?.[playerId];
  const already = !!myAns && myAns.roundStartAt === round.startAt;

  // pendiente local
  if (!already && pendingAnswerForStartAt === round.startAt) {
    if (input) input.disabled = true;
    if (btnAnswer) btnAnswer.disabled = true;
    if (btnSurrender) btnSurrender.disabled = true;
    return;
  }

  // confirmado
  if (already && pendingAnswerForStartAt === round.startAt) {
    pendingAnswerForStartAt = null;
  }

  if (input) input.disabled = already;
  if (btnAnswer) btnAnswer.disabled = already;
  if (btnSurrender) btnSurrender.disabled = already;

  if (!st) return;

  if (already) {
    const title = getPrimaryTitle(round.movieIndex);
    if (myAns.surrendered) st.textContent = `Te rendiste 🏳️ Era: ${title} (esperando al resto)`;
    else if (myAns.correct) st.textContent = "¡Correcto! ✅ (esperando al resto)";
    else st.textContent = `Incorrecto ❌ Era: ${title} (esperando al resto)`;
  } else {
    st.textContent = "Aún no has respondido.";
  }
}

// ============================
// Scoring (host only) + reveal delay
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

  // reveal delay para que se lea "Era: ..."
  const now = Date.now();
  if (!round.revealUntil) {
    await updateRoom(roomId, { "round.revealUntil": now + 1200 });
    return;
  }
  if (now < round.revealUntil) return;

  // evitar doble scoring
  const currentIndex = room.indiceActual ?? 0;
  if (room.lastScoredIndex === currentIndex) return;

  const mode = room.config?.modoJuego || "normal";
  const playersObj = room.players || {};
  const answers = round.answers || {};
  const updates = {};

  // Bonus contrarreloj: el más rápido correcto +3, segundo correcto +1
  let speedBonus = {};
  if (mode === "contrarreloj") {
    const corrects = Object.entries(answers)
      .filter(([, a]) => a && a.correct)
      .sort((a, b) => (a[1].ts ?? 0) - (b[1].ts ?? 0))
      .map(([pid]) => pid);

    if (corrects[0]) speedBonus[corrects[0]] = 3;
    if (corrects[1]) speedBonus[corrects[1]] = 1;
  }

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
    } else if (mode === "contrarreloj") {
      // base como normal + speed bonus
      if (surrendered) delta = -3;
      else if (correct) {
        const hintsUsed = round.hintsUsed?.[pid] ?? 0;
        const okStart = round.hintsUsedStartAt?.[pid] === round.startAt;
        const used = okStart ? hintsUsed : 0;
        delta = Math.max(0, 5 - used);
      } else {
        delta = 0;
      }
      delta += (speedBonus[pid] || 0);
    } else {
      // normal
      if (surrendered) delta = -3;
      else if (correct) {
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

    const newRacha = correct ? (prevRacha + 1) : 0;
    const best = Math.max(prevBest, newRacha);

    let streakBonus = 0;
    if (correct && newRacha > 0 && newRacha % 10 === 0) streakBonus = newRacha;

    updates[`players.${pid}.puntos`] = prevPts + delta + streakBonus;
    updates[`players.${pid}.racha`] = newRacha;
    updates[`players.${pid}.mejorRacha`] = best;
  }

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
// Round UI reset
// ============================
function resetUIForNewRound(room) {
  pendingAnswerForStartAt = null;

  const input = $("answerInput");
  if (input) input.value = "";

  hintsUsedThisRound = 0;
  revealedHintBtns = new Set();

  const hc = $("hintsContainer");
  if (hc) hc.innerHTML = "";

  const st = $("answerStatus");
  if (st) st.textContent = "Nueva ronda: escribe tu respuesta 👇";

  // Rebuild hints once per round (no parpadeo)
  buildHintsForRound(room);

  // focus
  setTimeout(() => { if (input) input.focus(); }, 0);
}

// ============================
// Main render
// ============================
const roomId = (getParam("room") || "").toUpperCase().trim();
const tabId = getOrCreateTabId();
const playerId = getPlayerId();

if (!roomId) setError("Falta el parámetro de sala. Vuelve al lobby.");

const roomEl = $("roomIdText");
if (roomEl) roomEl.textContent = roomId;

const btnBack = $("btnBack");
if (btnBack) {
  btnBack.addEventListener("click", () => {
    window.location.href = `lobby.html?room=${encodeURIComponent(roomId)}&tab=${encodeURIComponent(tabId)}`;
  });
}

function renderRoom(room) {
  if (!room) {
    setError("La sala no existe o ha sido eliminada.");
    return;
  }

  // Finalizada => results
  if (room.estado === "finalizada") {
    window.location.href = `results.html?room=${encodeURIComponent(roomId)}&tab=${encodeURIComponent(tabId)}`;
    return;
  }

  // Esperando
  if (room.estado === "esperando") {
    const cd = $("countdownText");
    if (cd) cd.textContent = "-";
    setStatus("Esperando a que el host inicie la partida...");
    setError("");
    return;
  }

  // Si por algo no estamos jugando, vuelve al lobby (manteniendo tab)
  if (room.estado !== "jugando") {
    window.location.href = `lobby.html?room=${encodeURIComponent(roomId)}&tab=${encodeURIComponent(tabId)}`;
    return;
  }

  setError("");

  const cfg = room.config || {};
  const modoText = $("modoText");
  const modoRondaText = $("modoRondaText");
  if (modoText) modoText.textContent = cfg.modoJuego || "-";
  if (modoRondaText) modoRondaText.textContent = cfg.modoRonda || "-";

  const idx = room.indiceActual ?? 0;
  const total = cfg.numPeliculas ?? (room.playlist?.length ?? "?");
  const rt = $("roundText");
  if (rt) rt.textContent = `${idx + 1} / ${total}`;

  renderPlayers(room.players);
  renderScores(room.players);

  // Host asegura ronda
  //ensureRoundInitialized(room).catch(() => {});

  // Nueva ronda por índice
  if (idx !== lastRoundIndex) {
    lastRoundIndex = idx;
    lastScheduledStartAt = null;
    clearTimers();
    resetUIForNewRound(room);
  }

  const round = room.round || {};
  const hasRound = !!round.startAt && round.movieIndex != null;

  if (hasRound) {
    applyModeUI(room);

    const url = getAudioUrl(round.movieIndex);
    scheduleSynchronizedPlay(round.startAt, url);
  } else {
    const cd = $("countdownText");
    if (cd) cd.textContent = "-";
    setStatus("Esperando sincronización...");
  }

syncAnswerUI(room);

hostScoreAndAdvance(room).catch((e) => {
  // IMPORTANTÍSIMO: si falla el avance, queremos verlo
  if (room.hostId === playerId) {
    console.error("[QSDC-MULTI] hostScoreAndAdvance failed:", e);
    setError("HOST: No se pudo avanzar la ronda. Mira consola / reglas Firestore.");
  }
});

}

// ============================
// Events
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
    if (e.key !== "Enter") return;
    if (!window.__currentRoom) return;
    try {
      // ✅ permite enviar vacío (sirve para “pasar rápido” en locura)
      await submitAnswer(window.__currentRoom);
    } catch (err) {
      setError(err?.message || "No se pudo enviar la respuesta.");
    }
  });
}

// ============================
// Listen
// ============================
let unsub = null;
let hostWatchdog = null;

function startHostWatchdog() {
  if (hostWatchdog) return;

  hostWatchdog = setInterval(async () => {
    const room = window.__currentRoom;
    if (!room) return;
    if (room.estado !== "jugando") return;
    if (room.hostId !== playerId) return;

    // Si todos han contestado y ya pasó el reveal delay,
    // intentamos avanzar (idempotente por lastScoredIndex)
    const round = room.round || {};
    if (!round.startAt || round.movieIndex == null) return;

    const now = Date.now();
    const revealUntil = round.revealUntil || 0;

    // allPlayersAnswered está declarada más arriba en tu archivo
    if (allPlayersAnswered(room) && now > revealUntil + 100) {
      try {
        await hostScoreAndAdvance(room);
      } catch (e) {
        console.error("[QSDC-MULTI] watchdog advance failed:", e);
        setError("HOST: fallo al avanzar ronda (watchdog). Mira consola.");
      }
    }
  }, 800);
}

if (roomId) {
 unsub = listenRoom(roomId, (room) => {
  window.__currentRoom = room;
  renderRoom(room);

  // Si soy host, arranco watchdog para empujar avances
  if (room && room.hostId === playerId) {
    startHostWatchdog();
  }
});
}

window.addEventListener("beforeunload", () => {
  clearTimers();
  if (hostWatchdog) clearInterval(hostWatchdog);
  hostWatchdog = null;
  if (unsub) unsub();
});

