// firestore-utils.js (MODULAR, limpio para qsdcmulti)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  serverTimestamp,
  deleteDoc,
  runTransaction,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ✅ Config de qsdcmulti (único sitio donde vive)
const firebaseConfig = {
  apiKey: "AIzaSyBK9yVaaLXVWayywEUHY_XAZ9q5S7JRKf8",
  authDomain: "qsdcmulti.firebaseapp.com",
  projectId: "qsdcmulti",
  storageBucket: "qsdcmulti.firebasestorage.app",
  messagingSenderId: "316482043664",
  appId: "1:316482043664:web:e5da28723cf176b21eef95"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Helpers
export function roomRef(roomId) {
  return doc(db, "salas", roomId);
}

export async function createRoom(roomId, payload) {
  await setDoc(roomRef(roomId), {
    ...payload,
    createdAt: serverTimestamp(),
  });
}

export async function joinRoom(roomId, playerId, playerData) {
  const ref = roomRef(roomId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Sala no existe");

  const room = snap.data();
  const players = room.players || {};
  const maxPlayers = room.config?.maxPlayers ?? 2;

  if (!players[playerId] && Object.keys(players).length >= maxPlayers) {
    throw new Error("Sala llena");
  }

  await updateDoc(ref, {
    [`players.${playerId}`]: {
      ...playerData,
      joinedAt: serverTimestamp(),
      puntos: playerData.puntos ?? 0,
    }
  });
}

export function listenRoom(roomId, cb) {
  return onSnapshot(
    roomRef(roomId),
    { includeMetadataChanges: true },
    (snap) => {
      if (!snap.exists()) return cb(null);
      cb({
        id: snap.id,
        ...snap.data(),
        _pending: snap.metadata.hasPendingWrites,
      });
    }
  );
}



export async function startGame(roomId) {
  const ref = roomRef(roomId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Sala no existe");

  const room = snap.data();
  const playlist = room.playlist || [];
  const indiceActual = 0;

  const firstMovieIndex = playlist[indiceActual];
  if (firstMovieIndex == null) throw new Error("Playlist vacía");

  const now = Date.now();

  await updateDoc(ref, {
    estado: "jugando",
    indiceActual,
    lastScoredIndex: -1,
    lastScoredAt: now,

    // ✅ primera ronda lista desde el inicio
    round: {
      movieIndex: firstMovieIndex,
      startAt: now + 3000,
      answers: {}
    }
  });
}

export async function updateRoom(roomId, data) {
  await updateDoc(roomRef(roomId), data);
}

export async function updateRoomFields(roomId, fieldMap) {
  // alias por claridad, exactamente lo mismo que updateRoom
  await updateRoom(roomId, fieldMap);
}


  // “Ping” simple: escribimos un serverTimestamp y lo leemos.
  // Estimamos el tiempo del cliente en el instante del servidor como el punto medio (t0+t1)/2.
  //const ref = doc(db, "timesync", crypto.randomUUID());
 export async function getServerClockOffsetMs() {
  const deviceId = localStorage.getItem("qsdcmulti_deviceId") || "anon";
  const ref = doc(db, "timesync", deviceId);

  const t0 = Date.now();
  await setDoc(ref, { t: serverTimestamp() });

  // ✅ fuerza lectura del servidor (evita cache / timestamp sin resolver)
  const snap = await getDocFromServer(ref);

  const t1 = Date.now();
  const data = snap.data();
  const serverMs = data?.t?.toMillis?.();
  if (!serverMs) return 0;

  const clientMid = (t0 + t1) / 2;
  return serverMs - clientMid;
}

export async function deleteRoom(roomId) {
  await deleteDoc(roomRef(roomId));
}
