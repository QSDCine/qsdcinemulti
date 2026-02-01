export const REGLAS = {
  normal: {
    descripcion: true,
    pistas: true,
    rendirse: true,
    intentosPorPelicula: Infinity,
    puntos: {
      aciertoBase: 5,
      aciertoMin: 0,
      aciertoRestaPorPista: true, // usa hintPenalty
      fallo: 0,
      rendirse: -3,
    },
    rachaBonusCada: 10,
  },

  contrarreloj: {
    descripcion: true,
    pistas: true,
    rendirse: true,
    intentosPorPelicula: Infinity,
    puntos: {
      aciertoBase: 5,
      aciertoMin: 0,
      aciertoRestaPorPista: true,
      fallo: 0,
      rendirse: -3,
    },
    rachaBonusCada: 10,
    bonusFinalPorMinutos: [
      { max: 60, bonus: 50 },
      { max: 120, bonus: 30 },
      { max: 180, bonus: 15 },
    ],
  },

  extremo: {
    descripcion: true,
    pistas: false,
    rendirse: true,
    intentosPorPelicula: 3,
    puntos: {
      aciertoFijo: 7,
      fallo: -3,
      rendirse: -5,
    },
    rachaBonusCada: 10,
  },

  locura: {
    descripcion: false,
    pistas: false,
    rendirse: false,
    intentosPorPelicula: 1,
    puntos: {
      aciertoFijo: 10,
      fallo: -20,
    },
    rachaBonusCada: 10,
  },
};
