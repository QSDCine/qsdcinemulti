// buzzer.js
import { runTransaction, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db, roomRef, updateRoom } from "./firestore-utils.js";

// 10s por defecto
const BUZZ_WINDOW_MS = 10000;

let __buzzerIntervalStarted = false;

export function buzzerStartLocalTicker({
  roomId,
  getRoom,
  playerId,
  nowMs,
  getPrimaryTitle
}) {
  if (__buzzerIntervalStarted) return;
  __buzzerIntervalStarted = true;

  setInterval(async () => {
    const room = getRoom();
    if (!room) return;

    const round = room.round || {};
    const bz = round.buzzer || {};
    if (bz.state !== "locked") return;

    // Si yo soy el bloqueado, actualizo la cuenta atrás y libero si expira
    if (bz.lockedBy !== playerId) return;

    const leftMs = (bz.expiresAt ?? 0) - nowMs();
    const left = Math.max(0, Math.ceil(leftMs / 1000));

    const txt = document.getElementById("buzzerText");
    if (txt) txt.textContent = `¡Tu turno! ⏱️ ${left}s`;

    if (leftMs <= 0) {
      const st = document.getElementById("answerStatus");
      const title = getPrimaryTitle(round.movieIndex);
      if (st) st.textContent = `Tiempo agotado ⏱️ Era: ${title}`;

      // liberamos buzzer y cortamos racha
try {
  const mode = room?.config?.modoJuego || "normal";
  const used = round.attemptsUsed?.[playerId] ?? 0;

  // penalización por timeout según modo
  let delta = 0;
  if (mode === "extremo") delta = -3;
  else if (mode === "locura") delta = -20;

  const prevPts = room.players?.[playerId]?.puntos ?? 0;

  const patch = {
    [`players.${playerId}.racha`]: 0,
    ...(delta ? { [`players.${playerId}.puntos`]: prevPts + delta } : {}),
    "round.buzzer.state": "open",
    "round.buzzer.lockedBy": null,
    "round.buzzer.lockedAt": null,
    "round.buzzer.expiresAt": null
  };

  // consumir intento en extremo/locura
  if (mode === "extremo" || mode === "locura") {
    patch[`round.attemptsUsed.${playerId}`] = used + 1;
  }

  await updateRoom(roomId, patch);
} catch {}
    }
  }, 250);
}



export function isBuzzer(room) {
  return (room?.config?.modoRonda || "todos") === "buzzer";
}

export function ensureBuzzerRoundShape(roomId, room, playerId, nowMs) {
  // Host-only idealmente, pero si no es host no hace nada porque solo parchea si falta.
  const round = room.round || {};
  if (!round.startAt || round.movieIndex == null) return;

  const bz = round.buzzer || null;
  const ok = bz && bz.roundStartAt === round.startAt;

  if (ok) return;

  // Parchea estructura buzzer en la ronda actual
  return updateRoom(roomId, {
    "round.buzzer": {
      roundStartAt: round.startAt,
      state: "open",          // open | locked | resolved
      lockedBy: null,
      lockedAt: null,
      expiresAt: null
    }
  });
}

export function buzzerSyncUI(room, playerId, nowMs, getPrimaryTitle) {
  const round = room.round || {};
  const bz = round.buzzer || {};
  const state = bz.state || "open";

  const row = document.getElementById("buzzerRow");
  const btnBuzz = document.getElementById("btnBuzz");
  const txt = document.getElementById("buzzerText");

  if (!row || !btnBuzz || !txt) return;

  // mostrar UI buzzer solo en modo buzzer
  row.style.display = "flex";

  const iAmLocked = state === "locked" && bz.lockedBy === playerId;
  const someoneLocked = state === "locked" && bz.lockedBy && bz.lockedBy !== playerId;

if (state === "resolved") {
  btnBuzz.disabled = true;

  const title = getPrimaryTitle(round.movieIndex);
  const st = document.getElementById("answerStatus");

  if (bz.lockedBy === playerId) {
    txt.textContent = "¡Correcto! ✅";
    if (st) st.textContent = `¡Correcto! ✅ Era: ${title}`;
  } else {
    txt.textContent = "Ronda resuelta ✅";
    if (st) st.textContent = `Era: ${title}`;
  }

  return;
}

  if (iAmLocked) {
    btnBuzz.disabled = true;
    const left = Math.max(0, Math.ceil((bz.expiresAt - nowMs()) / 1000));
    txt.textContent = `¡Tu turno! ⏱️ ${left}s`;
    return;
  }

  if (someoneLocked) {
    btnBuzz.disabled = true;
    txt.textContent = "Otro jugador está respondiendo…";
    return;
  }

  // open (aquí ya toca controlar intentos en extremo/locura)
const mode = room?.config?.modoJuego || "normal";
const used = round.attemptsUsed?.[playerId] ?? 0;
const max = (mode === "locura") ? 1 : (mode === "extremo") ? 3 : Infinity;

if (used >= max) {
  btnBuzz.disabled = true;
  txt.textContent = "Sin intentos disponibles.";
} else {
  btnBuzz.disabled = false;
  txt.textContent = "Pulsa BUZZ para responder";
}

}

export async function buzzerTryBuzz(roomId, room, playerId, nowMs, getMaxAttemptsForMode) {
  const ref = roomRef(roomId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Sala no existe");

    const r = snap.data();
    const round = r.round || {};
    if (!round.startAt || round.movieIndex == null) throw new Error("Ronda no lista");

    const bz = round.buzzer || {};
    if (bz.roundStartAt !== round.startAt) throw new Error("Buzzer no inicializado");

    // solo buzz cuando está abierto
    if (bz.state !== "open") return;

    // no antes del startAt real (evita “prebuzz”)
    if (nowMs() < round.startAt) return;

    // límites de intentos por jugador en extremo/locura
    const mode = r.config?.modoJuego || "normal";
    const max = getMaxAttemptsForMode(mode);
    if (max !== Infinity) {
      const used = round.attemptsUsed?.[playerId] ?? 0;
      if (used >= max) return; // sin intentos
    }

   const now = nowMs();

// ✅ Guardar el PRIMER buzz de la ronda (solo una vez por ronda)
const firstStartAt = round.buzzerFirstStartAt;
const shouldSetFirst = firstStartAt !== round.startAt;

const firstPatch = shouldSetFirst ? {
  "round.buzzerFirstStartAt": round.startAt,
  "round.buzzerFirstBy": playerId,
  "round.buzzerFirstAt": now
} : {};

tx.update(ref, {
  ...firstPatch,
  "round.buzzer": {
    roundStartAt: round.startAt,
    state: "locked",
    lockedBy: playerId,
    lockedAt: now,
    expiresAt: now + BUZZ_WINDOW_MS
  }
});

  });
}

export async function buzzerReleaseIfExpired(roomId, room, playerId, nowMs) {
  const round = room.round || {};
  const bz = round.buzzer || {};
  if (bz.state !== "locked") return;
  if (!bz.expiresAt) return;
  if (nowMs() <= bz.expiresAt) return;

  // El que expiró pierde racha (según tu regla) y se reabre
  const failedPid = bz.lockedBy;
  if (!failedPid) return;

  await updateRoom(roomId, {
    [`players.${failedPid}.racha`]: 0,
    "round.buzzer.state": "open",
    "round.buzzer.lockedBy": null,
    "round.buzzer.lockedAt": null,
    "round.buzzer.expiresAt": null
  });
}

export function buzzerApplyInputLock(room, playerId) {
  // Solo el que tiene el lock puede escribir y responder
  const round = room.round || {};
  const bz = round.buzzer || {};
  const lockedBy = bz.lockedBy;

  const input = document.getElementById("answerInput");
  const btnAnswer = document.getElementById("btnAnswer");
  const btnSurrender = document.getElementById("btnSurrender");

  const state = bz.state || "open";
  const iAmLocked = state === "locked" && lockedBy === playerId;

  if (input) input.disabled = !iAmLocked;
  if (btnAnswer) btnAnswer.disabled = !iAmLocked;
  if (btnSurrender) btnSurrender.disabled = !iAmLocked;
}

export async function buzzerSubmitAnswer({
  roomId,
  room,
  playerId,
  nowMs,
  isCorrectAnswer,
  getPrimaryTitle,
  getMode,
  getMaxAttemptsForMode,
  hintsUsedThisRound
}, opts = {}) {
  const surrendered = !!opts.surrendered;

  const round = room.round || {};
  const bz = round.buzzer || {};
  if (bz.state !== "locked" || bz.lockedBy !== playerId) return;

  // si expiró, no permitimos (se reabre en sync)
  if (bz.expiresAt && nowMs() > bz.expiresAt) return;

  const input = document.getElementById("answerInput");
  const raw = input ? String(input.value || "").trim() : "";
  const correct = surrendered ? false : isCorrectAnswer(raw, round.movieIndex);

  // consume intentos en extremo/locura cuando falla
  const mode = getMode(room);
  const max = getMaxAttemptsForMode(mode);
  const used = round.attemptsUsed?.[playerId] ?? 0;

  const updates = {};

  if (correct) {
    // ✅ Resuelto: rellenamos answers para TODOS (noAnswer para el resto)
    const all = Object.keys(room.players || {});
    const answers = {};

    for (const pid of all) {
      if (pid === playerId) {
        answers[pid] = {
          raw,
          correct: true,
          surrendered: false,
          ts: nowMs(),
          roundStartAt: round.startAt
        };
      } else {
        answers[pid] = {
          raw: "",
          correct: false,
          surrendered: false,
          noAnswer: true,
          ts: nowMs(),
          roundStartAt: round.startAt
        };
      }
    }

    updates["round.answers"] = answers;
    updates["round.revealUntil"] = nowMs() + 1200;

    // cerramos buzzer
    updates["round.buzzer.state"] = "resolved";
    updates["round.buzzer.lockedBy"] = playerId;

    await updateRoom(roomId, updates);
    return;
  }

  // ❌ Fallo o rendición:
  // corta racha SIEMPRE al que buzzó (tu regla)
  updates[`players.${playerId}.racha`] = 0;
// Penalización de puntos en buzzer (solo aquí, porque la ronda NO termina al fallar)
const prevPts = room.players?.[playerId]?.puntos ?? 0;
let delta = 0;

if (mode === "extremo") {
  delta = surrendered ? -5 : -3;
} else if (mode === "locura") {
  delta = -20;
} else {
  // normal / contrarreloj
  if (surrendered) delta = -3;
  else delta = 0;
}

if (delta) updates[`players.${playerId}.puntos`] = prevPts + delta;

  // en extremo/locura consumimos intento
if (max !== Infinity) {
  updates[`round.attemptsUsed.${playerId}`] = used + 1;
}


  // mensaje UI local (no obligatorio, pero ayuda)
  const st = document.getElementById("answerStatus");
  if (st) {
    const title = getPrimaryTitle(round.movieIndex);
    if (surrendered) st.textContent = `Te rendiste 🏳️ Era: ${title}`;
    else st.textContent = `Incorrecto ❌ Era: ${title}`;
  }

  // reabrimos buzzer para que otros puedan buzzear
  updates["round.buzzer.state"] = "open";
  updates["round.buzzer.lockedBy"] = null;
  updates["round.buzzer.lockedAt"] = null;
  updates["round.buzzer.expiresAt"] = null;

  await updateRoom(roomId, updates);
}
