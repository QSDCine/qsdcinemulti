let unsub = null;

function enterLobby(roomId) {
  showScreen("lobby");
  document.querySelector("#roomIdLabel").textContent = roomId;

  unsub?.();
  unsub = listenRoom(roomId, (room) => {
    if (!room) {
      alert("Sala cerrada o inexistente");
      return showScreen("home");
    }

    // lista jugadores
    const list = document.querySelector("#playersList");
    list.innerHTML = "";
    const playersArr = Object.entries(room.players || {})
      .map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => (a.nick || "").localeCompare(b.nick || ""));

    playersArr.forEach(p => {
      const li = document.createElement("li");
      li.textContent = `${p.nick} (${p.puntos ?? 0})`;
      list.appendChild(li);
    });

    // habilitar empezar solo al host y cuando esté llena
    const isHost = room.hostId === playerId;
    const isFull = playersArr.length === room.config.maxPlayers;

    const btnStart = document.querySelector("#btnStart");
    btnStart.style.display = isHost ? "inline-block" : "none";
    btnStart.disabled = !isFull;

    // si ya está jugando, saltar a juego
    if (room.estado === "jugando") {
      unsub?.();
      // aquí llamarás a tu función startGameUI(room)
      console.log("Ir a juego con config", room.config);
    }
  });
}

document.querySelector("#btnStart").addEventListener("click", async () => {
  const roomId = document.querySelector("#roomIdLabel").textContent;
  await startGame(roomId);
});
