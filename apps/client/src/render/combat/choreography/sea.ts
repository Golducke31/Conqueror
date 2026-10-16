/**
 * Coreografia del cruce maritimo.
 *
 * Funcion PURA: arma el plan de la fase de apertura de una batalla por
 * `seaLink` —navegacion, andanada y desembarco— antes de que empiece la ronda
 * normal. No toca Three.js ni el DOM.
 *
 * Decision (plan de combate, seccion 9): la andanada es ESPECTACULO. Las bajas
 * las decide el motor en la ronda que viene; aca solo se ve el cañoneo contra
 * la costa. En el nivel Rapido la navegacion y la andanada se omiten.
 */

import type { SeaTiming } from '../spectacle.js';
import type { PhasePlan } from './conquest.js';

export interface SeaCrossingPlan {
  /** Duracion total de la secuencia, en segundos de timeline. */
  readonly duration: number;
  /** Navegacion de la costa atacante a la costa defensora. */
  readonly sail: PhasePlan;
  /** Andanada visual contra la primera fila defensora. */
  readonly broadside: PhasePlan;
  /** Desembarco: las tropas pasan de los navios a la formacion. */
  readonly landing: PhasePlan;
}

export interface PlanSeaCrossingInput {
  readonly timing: SeaTiming;
  /** Cantidad de navios (uno por unidad de artilleria, minimo uno). */
  readonly shipCount: number;
}

/**
 * Arma el plan del cruce.
 *
 * Las fases van en serie. La duracion no depende de la cantidad de navios:
 * navegan en formacion y llegan juntos. Si todos los tiempos son 0 (nivel
 * Rapido) el plan dura 0 y la escena coloca todo en su posicion final.
 */
export function planSeaCrossing(input: PlanSeaCrossingInput): SeaCrossingPlan {
  const { timing } = input;

  const sail: PhasePlan = { start: 0, duration: timing.sail };
  const broadside: PhasePlan = {
    start: sail.start + sail.duration,
    duration: timing.broadside,
  };
  const landing: PhasePlan = {
    start: broadside.start + broadside.duration,
    duration: timing.landing,
  };

  return {
    duration: landing.start + landing.duration,
    sail,
    broadside,
    landing,
  };
}
