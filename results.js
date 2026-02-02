import { listenRoom } from "./firestore-utils.js";

function $(id) { return document.getElementById(id); }

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function setError(msg) {
  const el = $("resultsError");
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
$("roomIdText").textContent = roomId;

$("btnHome").addEventListener("click", () => {
  window.location.href = "index.html";
});

$("btnLobby").addEventListener("click", () => {
  window.location.href = `lobby.html?room=${encodeURIComponent(roomId)}`;
});

let unsub = null;

function render(room) {
  if (!room) {
    setError("La sala no existe o ha sido eliminada.");
    return;
  }

  setError("");

  const playersObj = room.players || {};
  const arr = Object.entries(playersObj).map(([id, p]) => ({
    id,
    nick: p.nick || "?",
    puntos: p.puntos ?? 0,
    mejorRacha: p.mejorRacha ?? 0
  }));

  arr.sort((a, b) => (b.puntos - a.puntos) || a.nick.localeCompare(b.nick));

  const list = $("resultsList");
  list.innerHTML = "";

  for (const p of arr) {
    const li = document.createElement("li");
    li.textContent = `${p.nick} — ${p.puntos} pts (mejor racha: ${p.mejorRacha})`;
    list.appendChild(li);
  }

  if (arr.length > 0) {
    const top = arr[0];
    // Si hay empate, lo indicamos
    const tied = arr.filter(x => x.puntos === top.puntos);
    if (tied.length > 1) {
      $("winnerText").textContent = `Empate a ${top.puntos} pts: ${tied.map(t => t.nick).join(", ")}`;
    } else {
      $("winnerText").textContent = `Ganador: ${top.nick} (${top.puntos} pts) 🏆`;
    }
  } else {
    $("winnerText").textContent = "Sin jugadores.";
  }
}

if (!roomId) {
  setError("Falta el parámetro de sala.");
} else {
  unsub = listenRoom(roomId, render);
}

window.addEventListener("beforeunload", () => {
  unsub?.();
});
