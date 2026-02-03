import { listenRoom, updateRoom } from "./firestore-utils.js";

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
const tabId = getOrCreateTabId();
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
let currentRoom = null;

function renderRoom(room) {
currentRoom = room;
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

  // Si el juego ya empezó, redirigimos
if (room.estado === "jugando") {
  window.location.href = `game.html?room=${encodeURIComponent(roomId)}&tab=${encodeURIComponent(tabId)}`;
}


}

$("btnStart").addEventListener("click", async () => {
  try {
    if (!currentRoom) return setError("Espera a que cargue la sala…");

    const playlist = currentRoom.playlist || [];
    const firstMovieIndex = playlist[0];
    if (firstMovieIndex == null) return setError("La sala no tiene playlist.");

    const now = Date.now();

    // Evita doble click
    const btn = $("btnStart");
    btn.disabled = true;

    await updateRoom(roomId, {
      estado: "jugando",
      indiceActual: 0,
      lastScoredIndex: -1,
      lastScoredAt: now,
      round: {
        movieIndex: firstMovieIndex,
        startAt: now + 3000,
        answers: {}
      }
    });

    // ✅ REDIRECCIÓN DIRECTA DEL HOST
window.location.href = `game.html?room=${encodeURIComponent(roomId)}&tab=${encodeURIComponent(tabId)}`;


  } catch (e) {
    console.error(e);
    setError(e?.message || "No se pudo iniciar la partida.");
    $("btnStart").disabled = false;
  }
});



// Arrancar listener
if (roomId) {
  unsub = listenRoom(roomId, renderRoom);
}

window.addEventListener("beforeunload", () => {
  unsub?.();
});
