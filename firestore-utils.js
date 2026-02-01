// firestore-utils.js (MODULAR, limpio para qsdcmulti)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
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
  return onSnapshot(roomRef(roomId), (snap) => {
    if (!snap.exists()) return cb(null);
    cb({ id: snap.id, ...snap.data() });
  });
}

export async function startGame(roomId) {
  await updateDoc(roomRef(roomId), {
    estado: "jugando",
    indiceActual: 0
  });
}

export async function updateRoom(roomId, data) {
  await updateDoc(roomRef(roomId), data);
}

