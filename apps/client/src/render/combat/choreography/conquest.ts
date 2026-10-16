/**
 * Coreografia de la conquista.
 *
 * Funcion PURA: convierte los tiempos del perfil de espectaculo en un plan de
 * timeline —cuando avanza la escuadra, cuando se planta el estandarte, cuando
 * barre la onda de cambio de dueno, cuanto se sostiene el momento y cuando se
 * funden las escuadras—. No toca Three.js ni el DOM, asi que se testea sin
 * WebGL.
 *
 * La marcha posterior a la conquista (`playMarch` en la escena) NO entra aca:
 * la dispara la aplicacion cuando el jugador elige cuantos ejercitos mover, no
 * la cola de eventos del director.
 */

import type { ConquestTiming } from '../spectacle.js';

export interface PhasePlan {
  readonly start: number;
  readonly duration: number;
}

export interface ConquestPlan {
  /** Duracion total de la secuencia, en segundos de timeline. */
  readonly duration: number;
  /** Avance de la escuadra atacante hacia el territorio conquistado. */
  readonly advance: PhasePlan;
  /** Plantado del estandarte. */
  readonly plant: PhasePlan;
  /** Onda de cambio de dueno. */
  readonly wave: PhasePlan;
  /** Sostener el momento: estandarte plantado, brasas disipandose. */
  readonly hold: PhasePlan;
  /** Fundido de las escuadras del campo. */
  readonly close: PhasePlan;
}

export interface PlanConquestInput {
  readonly timing: ConquestTiming;
}

/**
 * Arma el plan de la conquista.
 *
 * Las fases van en serie y sin solaparse: primero la escuadra avanza, recien
 * entonces se planta el estandarte y arranca la onda (la onda sale del frente,
 * que es de donde viene la escuadra). El nudo del momento es
 * `plant -> wave -> hold`: el estandarte queda fijo mientras el color barre el
 * territorio.
 *
 * Con los tiempos por defecto: Rapido suma 0.9 s (su `conquestSeconds`),
 * Tactico 1.9 s y Cinematico 1.26 s de timeline, que con `timeScale` 0.42 dan
 * los 3 s reales de su `conquestSeconds`.
 */
export function planConquest(input: PlanConquestInput): ConquestPlan {
  const { timing } = input;

  const advance: PhasePlan = { start: 0, duration: timing.advance };
  const plant: PhasePlan = {
    start: advance.start + advance.duration,
    duration: timing.plant,
  };
  const wave: PhasePlan = { start: plant.start + plant.duration, duration: timing.wave };
  const hold: PhasePlan = { start: wave.start + wave.duration, duration: timing.hold };
  const close: PhasePlan = { start: hold.start + hold.duration, duration: timing.close };

  return {
    duration: close.start + close.duration,
    advance,
    plant,
    wave,
    hold,
    close,
  };
}
