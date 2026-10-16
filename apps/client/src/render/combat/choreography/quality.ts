/**
 * Calidad adaptativa.
 *
 * Si el promedio de FPS durante una batalla cae por debajo de un umbral, se
 * reducen las partículas y la cantidad de unidades visibles (plan de combate,
 * seccion 11). El cambio es SOLO visual: no toca las reglas ni los eventos.
 *
 * El controlador es puro y determinista: se le pasa el delta de cada frame y
 * mantiene una ventana móvil. Para no oscilar alrededor del umbral hay
 * HISTÉRESIS: se degrada por debajo de `degradeBelowFps` y se recupera recién
 * por encima de `recoverAboveFps`, y ambos cambios necesitan `patience`
 * ventanas consecutivas en la misma condición.
 */

/** Umbrales y ventana del muestreo. */
export interface QualityParams {
  /** FPS promedio por debajo del cual se degrada la calidad. */
  readonly degradeBelowFps: number;
  /** FPS promedio por encima del cual se recupera (tiene que ser mayor que el de degradacion). */
  readonly recoverAboveFps: number;
  /** Muestras de la ventana móvil (a 60 fps, 45 muestras = 0.75 s). */
  readonly windowSamples: number;
  /** Ventanas consecutivas en la misma condicion antes de cambiar de estado. */
  readonly patience: number;
}

export const DEFAULT_QUALITY_PARAMS: QualityParams = {
  degradeBelowFps: 40,
  recoverAboveFps: 52,
  windowSamples: 45,
  patience: 2,
};

/** Valores base sobre los que se calcula la calidad. */
export interface QualityBase {
  /** Tope de unidades visibles por bando. */
  readonly unitCap: number;
  /** Escala de partículas (multiplicador del perfil de espectáculo). */
  readonly particleScale: number;
}

/** Estado efectivo de calidad. */
export interface QualitySnapshot {
  readonly degraded: boolean;
  readonly unitCap: number;
  readonly particleScale: number;
}

/** FPS promedio de una ventana de deltas (segundos). `null` si está vacía. */
export function averageFps(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  let total = 0;
  for (const delta of samples) total += delta;
  if (total <= 0) return null;
  return samples.length / total;
}

/**
 * Próximo estado a partir del FPS de la ventana y la paciencia ya acumulada.
 * `patience` cuenta cuántas ventanas seguidas vienen pidiendo el mismo cambio.
 */
export function nextQualityState(
  windowFps: number,
  degraded: boolean,
  params: QualityParams,
  patience: number,
): 'degrade' | 'recover' | 'keep' {
  if (!degraded && windowFps < params.degradeBelowFps) {
    return patience + 1 >= params.patience ? 'degrade' : 'keep';
  }
  if (degraded && windowFps > params.recoverAboveFps) {
    return patience + 1 >= params.patience ? 'recover' : 'keep';
  }
  return 'keep';
}

export interface QualityController {
  /** Registra un frame (delta en segundos). */
  recordFrame(deltaSeconds: number): void;
  /** Estado efectivo actual. */
  snapshot(): QualitySnapshot;
  /** Olvida las muestras (al abrir una batalla nueva). */
  reset(): void;
}

/** Valores cuando la calidad está degradada. */
function degradedSnapshot(base: QualityBase): QualitySnapshot {
  return {
    degraded: true,
    unitCap: Math.max(2, Math.floor(base.unitCap / 2)),
    particleScale: base.particleScale * 0.35,
  };
}

function fullSnapshot(base: QualityBase): QualitySnapshot {
  return { degraded: false, unitCap: base.unitCap, particleScale: base.particleScale };
}

/** Crea el controlador. Arranca en calidad plena. */
export function createQualityController(
  base: QualityBase,
  params: QualityParams = DEFAULT_QUALITY_PARAMS,
): QualityController {
  const samples: number[] = [];
  let degraded = false;
  let patience = 0;

  return {
    recordFrame(deltaSeconds: number): void {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
      samples.push(deltaSeconds);
      if (samples.length > params.windowSamples) samples.shift();
      if (samples.length < params.windowSamples) return;

      const fps = averageFps(samples);
      if (fps === null) return;

      const next = nextQualityState(fps, degraded, params, patience);
      if (next === 'degrade') {
        degraded = true;
        patience = 0;
      } else if (next === 'recover') {
        degraded = false;
        patience = 0;
      } else if (
        (!degraded && fps < params.degradeBelowFps) ||
        (degraded && fps > params.recoverAboveFps)
      ) {
        // Sigue pidiendo el mismo cambio: acumula paciencia.
        patience += 1;
      } else {
        // Dentro de la banda de histéresis: ni acumula ni reinicia.
        patience = 0;
      }
    },

    snapshot(): QualitySnapshot {
      return degraded ? degradedSnapshot(base) : fullSnapshot(base);
    },

    reset(): void {
      samples.length = 0;
      patience = 0;
    },
  };
}
