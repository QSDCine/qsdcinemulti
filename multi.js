import { createRoom, joinRoom } from "./firestore-utils.js";
const totalDisponibles = MOVIES.length;

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

function getOrCreatePlayerId() {
  // Persistente por dispositivo
  const deviceKey = "qsdcmulti_deviceId";
  let deviceId = localStorage.getItem(deviceKey);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(deviceKey, deviceId);
  }

  // Único por pestaña/sesión (no se comparte entre tabs)
  const tabKey = "qsdcmulti_tabId";
  let tabId = sessionStorage.getItem(tabKey);
  if (!tabId) {
    tabId = crypto.randomUUID();
    sessionStorage.setItem(tabKey, tabId);
  }

  // PlayerId final (único incluso en dos pestañas del mismo navegador)
  return `${deviceId}:${tabId}`;
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

const playerId = getOrCreatePlayerId();

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
    if (!Number.isFinite(numPeliculas) || numPeliculas < 10 || numPeliculas > 300) {
      return setError("create-error", "Películas: mínimo 10, máximo 300.");
    }
    if (!Number.isFinite(maxPlayers) || maxPlayers < 2 || maxPlayers > 10) {
      return setError("create-error", "Jugadores: mínimo 2, máximo 10.");
    }

    const roomId = makeRoomId();

    // Playlist provisional: IDs 0..299
    // (Luego lo conectamos con tu array real del script.js)
    const indices = [...Array(300).keys()];
    shuffle(indices);
    const playlist = indices.slice(0, numPeliculas);

    await createRoom(roomId, {
      estado: "esperando",
      config: { modoJuego, modoRonda, numPeliculas, maxPlayers },
      playlist,
      indiceActual: 0,
      hostId: playerId,
      players: {}
    });

    await joinRoom(roomId, playerId, { nick, puntos: 0 });

    window.location.href = `lobby.html?room=${encodeURIComponent(roomId)}`;
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

    await joinRoom(roomId, playerId, { nick, puntos: 0 });

    window.location.href = `lobby.html?room=${encodeURIComponent(roomId)}`;
  } catch (e) {
    setError("join-error", e?.message || "No se pudo unir a la sala.");
  }
});
