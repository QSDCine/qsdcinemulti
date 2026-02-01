import { createRoom, joinRoom, listenRoom, startGame } from "./firestore-utils.js";
import { REGLAS } from "./reglas.js"; // ya lo tienes

const playerId = getOrCreatePlayerId();

async function onCreate() {
  const nick = document.querySelector("#nickCreate").value.trim();
  const modoJuego = document.querySelector("#modoJuego").value; // normal/...
  const modoRonda = document.querySelector("#modoRonda").value; // todos/buzzer
  const numPeliculas = Number(document.querySelector("#numPeliculas").value);
  const maxPlayers = Number(document.querySelector("#maxPlayers").value);

  if (!nick) return alert("Pon un nick");
  if (numPeliculas < 10 || numPeliculas > 300) return alert("Películas: 10 a 300");

  const roomId = makeRoomId();

  // playlist: aquí usas TU array real de películas del juego original
  // Ejemplo: si tienes peliculas[] con 300 entradas:
  const indices = [...Array(300).keys()];
  shuffle(indices);
  const playlist = indices.slice(0, numPeliculas);

  await createRoom(roomId, {
    estado: "esperando",
    createdAt: firebaseServerTimestampPlaceholder(), // ver nota abajo
    config: { modoJuego, modoRonda, numPeliculas, maxPlayers },
    playlist,
    indiceActual: 0,
    players: {},
    hostId: playerId
  });

  await joinRoom(roomId, playerId, { nick, puntos: 0 });

  enterLobby(roomId, playerId);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
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

function makeRoomId() {
  // corto y fácil de dictar: 6-8 chars
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function show(id) {
  const ids = ["screen-home", "screen-create", "screen-join"];
  for (const s of ids) {
    document.getElementById(s).style.display = (s === id) ? "block" : "none";
  }
}

function setError(elId, msg) {
  const p = document.getElementById(elId);
  if (!msg) {
    p.style.display = "none";
    p.textContent = "";
    return;
  }
  p.textContent = msg;
  p.style.display = "block";
}

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
  // Reutilizamos tu flujo offline como "instalador"
  window.location.href = "offline.html";
});

// Por ahora, dejamos los botones de crear/unirse sin lógica.
// En el siguiente paso los conectamos con Firestore.
document.getElementById("btn-create-room").addEventListener("click", () => {
  setError("create-error", "Aún no está conectado a Firestore (siguiente paso).");
});

document.getElementById("btn-join-room").addEventListener("click", () => {
  setError("join-error", "Aún no está conectado a Firestore (siguiente paso).");
});

