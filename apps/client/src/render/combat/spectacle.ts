/**
 * Niveles de espectaculo.
 *
 * El jugador elige cuanto quiere ver; el ajuste es persistente. Los ataques de
 * otros jugadores y de los bots se reproducen un nivel mas rapido por defecto, y
 * `prefers-reduced-motion` fuerza "Rapido" y apaga el sacudon de camara.
 */

export type SpectacleLevel = 'fast' | 'tactical' | 'cinematic';

/**
 * Tiempos de una ronda. Se declaran por separado y no como un total, porque la
 * coreografia necesita saber cuando cae cada golpe para escalonar los duelos.
 *
 * Verificacion del criterio del plan ("una ronda Tactico dura <= 2.5 s"):
 * el tablero clasico usa 2 dados de defensor, asi que el caso normal son 2
 * pares: lead + 1 escalon + duelo + reacomodo = 0.6 + 0.3 + 0.5 + 0.3 = 1.7 s.
 * El peor caso de 3 pares da 2.0 s. Los dos entran en el tope.
 */
export interface RoundTiming {
  /** Caida de los dados y rodado. */
  readonly diceRoll: number;
  /** Asentado de los dados. */
  readonly diceLand: number;
  /** Separacion entre el inicio de un duelo y el siguiente. */
  readonly duelStagger: number;
  /** Duracion de cada duelo. */
  readonly duel: number;
  /** Reacomodo de las escuadras al cerrar la ronda. */
  readonly regroup: number;
}

/** Tiempos de la secuencia de conquista (terrestre o maritima). */
export interface ConquestTiming {
  /** Avance de la escuadra atacante hacia el territorio conquistado. */
  readonly advance: number;
  /** Plantado del estandarte. */
  readonly plant: number;
  /** Onda de cambio de dueno barriendo el territorio. */
  readonly wave: number;
  /** Espera con el estandarte plantado y el campo despejandose. */
  readonly hold: number;
  /** Fundido de las escuadras del campo de batalla. */
  readonly close: number;
}

/** Tiempos del cruce maritimo, antes de la primera ronda. */
export interface SeaTiming {
  /** Navegacion de la costa atacante a la costa defensora. */
  readonly sail: number;
  /** Andanada visual contra la costa (sin bajas: las decide el motor). */
  readonly broadside: number;
  /** Desembarco de las tropas en la playa. */
  readonly landing: number;
}

export interface SpectacleProfile {
  /** Encuadre de camara al frente de batalla. */
  readonly cameraMove: boolean;
  /** Despliegue de las escuadras desde sus territorios. */
  readonly deploy: boolean;
  /** Duracion objetivo de una ronda, en segundos. */
  readonly roundSeconds: number;
  /** Duracion objetivo de una conquista, en segundos. */
  readonly conquestSeconds: number;
  /** Escala de tiempo durante la conquista (cinematico usa camara lenta). */
  readonly conquestTimeScale: number;
  /** Duracion objetivo de la marcha posterior a la conquista. */
  readonly marchSeconds: number;
  /** Multiplicador de particulas. */
  readonly particleScale: number;
  /** Sacudon de camara por baja. */
  readonly cameraShake: boolean;
  /** Post-proceso (bloom, vineta). Solo cinematico y en equipos capaces. */
  readonly postProcessing: boolean;
  /** Inclinacion de camara al encuadrar, en grados respecto del cenit. */
  readonly cameraPolarDeg: number;
  /** Distancia de camara al frente. */
  readonly cameraDistance: number;
  /** Tiempos de la ronda. */
  readonly timing: RoundTiming;
  /** Tiempos de la conquista. */
  readonly conquest: ConquestTiming;
  /** Tiempos del cruce maritimo. */
  readonly sea: SeaTiming;
}

export const SPECTACLE_PROFILES: Readonly<Record<SpectacleLevel, SpectacleProfile>> = {
  fast: {
    cameraMove: false,
    deploy: false,
    roundSeconds: 0.7,
    conquestSeconds: 0.9,
    conquestTimeScale: 1,
    marchSeconds: 0.6,
    particleScale: 0.35,
    cameraShake: false,
    postProcessing: false,
    cameraPolarDeg: 52,
    cameraDistance: 300,
    timing: { diceRoll: 0.2, diceLand: 0.05, duelStagger: 0.08, duel: 0.15, regroup: 0.1 },
    // La conquista Rapido entra en el tope de conquestSeconds (0.9).
    conquest: { advance: 0.15, plant: 0.1, wave: 0.35, hold: 0.1, close: 0.2 },
    // En Rapido la navegacion y la andanada se omiten (plan, seccion 9).
    sea: { sail: 0, broadside: 0, landing: 0.12 },
  },
  tactical: {
    cameraMove: true,
    deploy: true,
    roundSeconds: 2.4,
    conquestSeconds: 1.9,
    conquestTimeScale: 1,
    marchSeconds: 1.5,
    particleScale: 1,
    cameraShake: true,
    postProcessing: false,
    cameraPolarDeg: 50,
    cameraDistance: 300,
    timing: { diceRoll: 0.45, diceLand: 0.15, duelStagger: 0.3, duel: 0.5, regroup: 0.3 },
    conquest: { advance: 0.4, plant: 0.25, wave: 0.65, hold: 0.25, close: 0.35 },
    sea: { sail: 1, broadside: 0.55, landing: 0.5 },
  },
  cinematic: {
    cameraMove: true,
    deploy: true,
    roundSeconds: 3.4,
    conquestSeconds: 3,
    conquestTimeScale: 0.42,
    marchSeconds: 2.4,
    particleScale: 1.9,
    cameraShake: true,
    postProcessing: true,
    cameraPolarDeg: 63,
    cameraDistance: 150,
    timing: { diceRoll: 0.6, diceLand: 0.25, duelStagger: 0.45, duel: 0.8, regroup: 0.5 },
    // Con timeScale 0.42 la duracion real queda en conquestSeconds (3 s).
    conquest: { advance: 0.28, plant: 0.18, wave: 0.42, hold: 0.16, close: 0.22 },
    sea: { sail: 1.6, broadside: 0.8, landing: 0.7 },
  },
};

/** Nivel efectivo: "Rapido" gana si el usuario pidio menos movimiento. */
export function resolveSpectacle(
  requested: SpectacleLevel,
  reducedMotion: boolean,
): SpectacleLevel {
  if (reducedMotion) return 'fast';
  return requested;
}

/** Un nivel mas rapido, para ataques de otros jugadores o de bots. */
export function stepDown(level: SpectacleLevel): SpectacleLevel {
  if (level === 'cinematic') return 'tactical';
  if (level === 'tactical') return 'fast';
  return 'fast';
}
