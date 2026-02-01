let db = null;

function initFirestore() {
  if (typeof firebase === "undefined") {
    console.warn("[Firestore] Firebase no está disponible. ¿Estás offline?");
    return;
  }

  try {
const firebaseConfig = {
  apiKey: "AIzaSyBK9yVaaLXVWayywEUHY_XAZ9q5S7JRKf8",
  authDomain: "qsdcmulti.firebaseapp.com",
  projectId: "qsdcmulti",
  storageBucket: "qsdcmulti.firebasestorage.app",
  messagingSenderId: "316482043664",
  appId: "1:316482043664:web:e5da28723cf176b21eef95"
};

    // Evita inicializar Firebase más de una vez
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
      console.log("[Firestore] Firebase inicializado.");
    } else {
      console.log("[Firestore] Firebase ya estaba inicializado.");
    }

    db = firebase.firestore();
    window.db = db;

  } catch (error) {
    console.error("[Firestore] No se pudo inicializar:", error);
  }
}

initFirestore();

async function guardarResultadoEnFirestore(nombre, puntuacion, modo, racha, tiempo = null) {
  try {
    if (!db) throw new Error("Firestore no está disponible.");

    const ref = db.collection("ranking");
    const docRef = await ref.add({
      nombre,
      puntuacion,
      modo,
      racha,
      tiempo,
      fecha: new Date()
    });

    console.log(`✅ Resultado guardado con ID: ${docRef.id}`);
  } catch (error) {
    console.error("❌ Error al guardar el resultado:", error);
  }
}

window.guardarResultadoEnFirestore = guardarResultadoEnFirestore;


