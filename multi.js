import { createRoom, joinRoom } from "./firestore-utils.js";
import { movies } from "./movies.js";

const totalDisponibles = movies.length;

function show(id) {
  const ids = ["screen-home", "screen-create", "screen-join"];
  for (const s of ids) {
    document.getElementById(s).style.display = (s === id) ? "block" : "none";
  }
}

function setError(elId, msg) {
  const p = document.getElementById(elId);
  if (!p) return;
  if (!msg) {
    p.style.display = "none";
    p.textContent = "";
    return;
  }
  p.textContent = msg;
  p.style.display = "block";
}

/**
 * ✅ Identidad consistente:
 * - deviceId: persistente por dispositivo (localStorage)
 * - tabId: por sesión/pestaña (sessionStorage)
 * - playerId: deviceId:tabId
 *
 * Importante: NO guardamos playerId como const global,
 * lo pedimos justo cuando creamos/unimos, para evitar IDs "stale".
 */
function getOrCreateIdentity() {
  const deviceKey = "qsdcmulti_deviceId";
  let deviceId = localStorage.getItem(deviceKey);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(deviceKey, deviceId);
  }

  const tabKey = "qsdcmulti_tabId";
  let tabId = sessionStorage.getItem(tabKey);
  if (!tabId) {
    tabId = crypto.randomUUID();
    sessionStorage.setItem(tabKey, tabId);
  }

  return { deviceId, tabId, playerId: `${deviceId}:${tabId}` };
}

function makeRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// Navegación UI
document.getElementById("btn-go-create").addEventListener("click", () => {
  setError("create-error", "");
  show("screen-create");
});

document.getElementById("btn-go-join").addEventListener("click", () => {
  setError("join-error", "");
  show("screen-join");
});

document.getElementById("btn-back-from-create").addEventListener("click", () => show("screen-home"));
document.getElementById("btn-back-from-join").addEventListener("click", () => show("screen-home"));

document.getElementById("btn-install").addEventListener("click", () => {
  window.location.href = "offline.html";
});

// Crear sala
document.getElementById("btn-create-room").addEventListener("click", async () => {
  try {
    setError("create-error", "");

    const nick = document.getElementById("create-nick").value.trim();
    const modoJuego = document.getElementById("create-modo-juego").value; // normal/contrarreloj/extremo/locura
    const modoRonda = document.getElementById("create-modo-ronda").value; // todos/buzzer
    const numPeliculas = Number(document.getElementById("create-num-pelis").value);
    const maxPlayers = Number(document.getElementById("create-max-players").value);

    if (!nick) return setError("create-error", "Pon un nick.");
    if (!Number.isFinite(numPeliculas) || numPeliculas < 10 || numPeliculas > totalDisponibles) {
      return setError("create-error", `Películas: mínimo 10, máximo ${totalDisponibles}.`);
    }
    if (!Number.isFinite(maxPlayers) || maxPlayers < 2 || maxPlayers > 10) {
      return setError("create-error", "Jugadores: mínimo 2, máximo 10.");
    }

    // ✅ Pedimos identidad JUSTO AQUÍ (nunca stale)
    const identity = getOrCreateIdentity();

    const roomId = makeRoomId();

    const indices = [...Array(totalDisponibles).keys()];
    shuffle(indices);
    const playlist = indices.slice(0, numPeliculas);

    await createRoom(roomId, {
      estado: "esperando",
      config: { modoJuego, modoRonda, numPeliculas, maxPlayers },
      playlist,
      indiceActual: 0,
      hostId: identity.playerId,
      players: {}
    });

    await joinRoom(roomId, identity.playerId, { nick, puntos: 0 });

    window.location.href = `lobby.html?room=${encodeURIComponent(roomId)}&tab=${encodeURIComponent(identity.tabId)}`;
  } catch (e) {
    setError("create-error", e?.message || "Error al crear la sala.");
  }
});

// Unirse a sala
document.getElementById("btn-join-room").addEventListener("click", async () => {
  try {
    setError("join-error", "");

    const nick = document.getElementById("join-nick").value.trim();
    const roomId = document.getElementById("join-room-id").value.trim().toUpperCase();

    if (!nick) return setError("join-error", "Pon un nick.");
    if (!roomId) return setError("join-error", "Pon un ID de sala.");

    // ✅ Identidad fresca y coherente
    const identity = getOrCreateIdentity();

    await joinRoom(roomId, identity.playerId, { nick, puntos: 0 });

    window.location.href = `lobby.html?room=${encodeURIComponent(roomId)}&tab=${encodeURIComponent(identity.tabId)}`;
  } catch (e) {
    setError("join-error", e?.message || "No se pudo unir a la sala.");
  }
});
