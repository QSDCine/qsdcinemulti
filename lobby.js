import { listenRoom, updateRoom } from "./firestore-utils.js";

function $(id) { return document.getElementById(id); }
function getParam(name) { return new URLSearchParams(window.location.search).get(name); }

function getOrCreatePlayerId() {
  const deviceKey = "qsdcmulti_deviceId";
  let deviceId = localStorage.getItem(deviceKey);
  if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem(deviceKey, deviceId); }

  const tabKey = "qsdcmulti_tabId";
  let tabId = sessionStorage.getItem(tabKey);
  if (!tabId) { tabId = crypto.randomUUID(); sessionStorage.setItem(tabKey, tabId); }

  return `${deviceId}:${tabId}`;
}

function setError(msg) {
  const el = $("lobbyError");
  if (!el) return;
  if (!msg) { el.style.display = "none"; el.textContent = ""; return; }
  el.textContent = msg;
  el.style.display = "block";
}

const roomId = (getParam("room") || "").toUpperCase().trim();
const playerId = getOrCreatePlayerId();
const MIN_PLAYERS_TO_START = 2;

if (!roomId) setError("Falta el parámetro de sala. Vuelve al inicio e inténtalo de nuevo.");

$("roomIdText").textContent = roomId;

$("btnCopyRoom").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(roomId); }
  catch { prompt("Copia el ID:", roomId); }
});

$("btnLeave").addEventListener("click", () => { window.location.href = "index.html"; });

let unsub = null;
let currentRoom = null;

function renderRoom(room) {
  currentRoom = room;

  if (!room) { setError("La sala no existe o ha sido eliminada."); return; }
  setError("");

  const cfg = room.config || {};
  $("modoText").textContent = cfg.modoJuego || "-";
  $("modoRondaText").textContent = cfg.modoRonda || "-";
  $("numPelisText").textContent = cfg.numPeliculas ?? "-";

  const playersObj = room.players || {};
  const playersArr = Object.entries(playersObj).map(([id, p]) => ({ id, ...p }));
  $("playersCountText").textContent = `${playersArr.length}/${cfg.maxPlayers ?? "?"}`;

  const ul = $("playersList");
  ul.innerHTML = "";
  playersArr.sort((a, b) => (a.nick || "").localeCompare(b.nick || "")).forEach(p => {
    const li = document.createElement("li");
    li.textContent = `${p.nick ?? "?"}`;
    ul.appendChild(li);
  });

  const isHost = room.hostId === playerId;

  // ✅ Antes: solo si sala llena. Ahora: mínimo 2 jugadores.
  const canStart = isHost && playersArr.length >= MIN_PLAYERS_TO_START;

  const btnStart = $("btnStart");
  btnStart.style.display = isHost ? "inline-block" : "none";
  btnStart.disabled = !canStart;

  // ✅ Si el juego ya empezó, todos al game (host y guests)
  if (room.estado === "jugando") {
    window.location.href = `game.html?room=${encodeURIComponent(roomId)}`;
  }
}

$("btnStart").addEventListener("click", async () => {
  try {
    if (!currentRoom) return setError("No hay datos de sala todavía, espera un segundo y prueba otra vez.");

    const playersCount = Object.keys(currentRoom.players || {}).length;
    if (playersCount < MIN_PLAYERS_TO_START) {
      return setError(`Necesitas al menos ${MIN_PLAYERS_TO_START} jugadores para empezar.`);
    }

    const playlist = currentRoom.playlist || [];
    const firstMovieIndex = playlist[0];
    if (firstMovieIndex == null) return setError("La sala no tiene playlist. Crea la sala de nuevo.");

    const now = Date.now();
    const btn = $("btnStart");
    btn.disabled = true;

    await updateRoom(roomId, {
      estado: "jugando",
      indiceActual: 0,
      lastScoredIndex: -1,
      lastScoredAt: now,
      round: { movieIndex: firstMovieIndex, startAt: now + 3000, answers: {} }
    });

    // ✅ NO redirigimos aquí: dejamos que renderRoom lo haga cuando llegue el snapshot.
    // Así evitas “host en game esperando” si el update falla por lo que sea.

  } catch (e) {
    console.error(e);
    setError(e?.message || "No se pudo iniciar la partida.");
    $("btnStart").disabled = false;
  }
});

if (roomId) unsub = listenRoom(roomId, renderRoom);
window.addEventListener("beforeunload", () => { unsub?.(); });
