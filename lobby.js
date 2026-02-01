import { listenRoom, startGame } from "./firestore-utils.js";

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
  const el = $("lobbyError");
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
  setError("Falta el parámetro de sala. Vuelve al inicio e inténtalo de nuevo.");
}

// Pintar ID sala
$("roomIdText").textContent = roomId;

// Copiar ID
$("btnCopyRoom").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(roomId);
  } catch {
    prompt("Copia el ID:", roomId);
  }
});

// Salir
$("btnLeave").addEventListener("click", () => {
  window.location.href = "index.html";
});

let unsub = null;

function renderRoom(room) {
  if (!room) {
    setError("La sala no existe o ha sido eliminada.");
    return;
  }

  setError("");

  const cfg = room.config || {};
  $("modoText").textContent = cfg.modoJuego || "-";
  $("modoRondaText").textContent = cfg.modoRonda || "-";
  $("numPelisText").textContent = cfg.numPeliculas ?? "-";

  const playersObj = room.players || {};
  const playersArr = Object.entries(playersObj).map(([id, p]) => ({ id, ...p }));

  $("playersCountText").textContent = `${playersArr.length}/${cfg.maxPlayers ?? "?"}`;

  // Lista jugadores
  const ul = $("playersList");
  ul.innerHTML = "";
  playersArr
    .sort((a, b) => (a.nick || "").localeCompare(b.nick || ""))
    .forEach(p => {
      const li = document.createElement("li");
      li.textContent = `${p.nick ?? "?"}`;
      ul.appendChild(li);
    });

  // Botón start solo host y cuando sala llena
  const isHost = room.hostId === playerId;
  const isFull = (cfg.maxPlayers != null) && (playersArr.length === cfg.maxPlayers);

  const btnStart = $("btnStart");
  btnStart.style.display = isHost ? "inline-block" : "none";
  btnStart.disabled = !isFull;

  // Si el juego ya empezó, redirigimos (lo haremos luego a game.html)
  if (room.estado === "jugando") {
    // Por ahora, solo para confirmar que se detecta.
    console.log("[Lobby] La partida ha empezado.");
    // Luego será:
    // window.location.href = `game.html?room=${encodeURIComponent(roomId)}`;
  }
}

$("btnStart").addEventListener("click", async () => {
  try {
    await startGame(roomId);
  } catch (e) {
    setError(e?.message || "No se pudo iniciar la partida.");
  }
});

// Arrancar listener
if (roomId) {
  unsub = listenRoom(roomId, renderRoom);
}

window.addEventListener("beforeunload", () => {
  unsub?.();
});
