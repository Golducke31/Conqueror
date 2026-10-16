/**
 * Frente caliente (`battleHeat`).
 *
 * Modelo PURO y determinista: deriva del log de eventos cuanto "calor" de
 * combate tiene cada territorio, entre 0 y 1. NO vive en el estado de reglas:
 * es solo visual, y por eso se puede recalcular desde cero aplicando el
 * registro completo de la partida — un cliente que reconecta a mitad de una
 * batalla reproduce exactamente el mismo calor (plan de combate, seccion 10).
 *
 * Reglas de derivacion:
 *   - Cada ronda (BATTLE_ROUND_RESOLVED) calienta los dos territorios del
 *     frente; el territorio atacado se calienta mas, porque es donde se pelea.
 *   - Una conquista (TERRITORY_CONQUERED) es un pico: ahi cambio el dueno.
 *   - Cada TURN_CHANGED enfria todos los territorios (decaimiento por turno).
 *   - El calor nunca baja de 0 ni pasa de 1.
 *
 * El consumo es del shader del tablero (mapMaterials): el modelo solo produce
 * numeros, no sabe nada del render.
 */

import type { GameEvent, TerritoryId } from '@conqueror/rules';

/** Parametros del calor. Configurables: nada hardcodeado en el motor visual. */
export interface HeatParams {
  /** Calor que suma cada ronda en el territorio de origen del ataque. */
  readonly risePerRound: number;
  /** Extra de calor para el territorio atacado (el campo de batalla). */
  readonly risePerRoundTarget: number;
  /** Pico de calor de una conquista (cambio de dueno). */
  readonly risePerConquest: number;
  /** Factor por el que se multiplica todo el calor en cada cambio de turno. */
  readonly decayPerTurn: number;
}

export const DEFAULT_HEAT_PARAMS: HeatParams = {
  risePerRound: 0.08,
  risePerRoundTarget: 0.05,
  risePerConquest: 0.35,
  decayPerTurn: 0.5,
};

export interface HeatModel {
  /**
   * Aplica eventos del log EN ORDEN. Devuelve `true` si algun territorio cambio,
   * para que quien consume sepa si tiene que refrescar el shader.
   */
  apply(events: readonly GameEvent[]): boolean;
  /** Calor de un territorio, entre 0 y 1. */
  get(territory: TerritoryId): number;
  /** Territorios con calor > 0, para depuracion y refresco del shader. */
  entries(): readonly (readonly [TerritoryId, number])[];
  /** Vuelve todo a cero (por ejemplo, al reiniciar la partida). */
  reset(): void;
}

/** Crea el modelo. Arranca en cero. */
export function createHeatModel(params: Partial<HeatParams> = {}): HeatModel {
  const settings: HeatParams = { ...DEFAULT_HEAT_PARAMS, ...params };
  const heat = new Map<TerritoryId, number>();

  const bump = (territory: TerritoryId, amount: number): void => {
    if (amount <= 0) return;
    const next = Math.min(1, (heat.get(territory) ?? 0) + amount);
    heat.set(territory, next);
  };

  const decayAll = (): void => {
    for (const [territory, value] of heat) {
      const next = value * settings.decayPerTurn;
      if (next < 0.001) heat.delete(territory);
      else heat.set(territory, next);
    }
  };

  return {
    apply(events): boolean {
      let changed = false;
      for (const event of events) {
        if (event.type === 'BATTLE_ROUND_RESOLVED') {
          bump(event.from, settings.risePerRound);
          bump(event.to, settings.risePerRound + settings.risePerRoundTarget);
          changed = true;
        } else if (event.type === 'TERRITORY_CONQUERED') {
          bump(event.territory, settings.risePerConquest);
          changed = true;
        } else if (event.type === 'TURN_CHANGED') {
          decayAll();
          changed = true;
        }
      }
      return changed;
    },

    get(territory): number {
      return heat.get(territory) ?? 0;
    },

    entries(): readonly (readonly [TerritoryId, number])[] {
      return [...heat.entries()];
    },

    reset(): void {
      heat.clear();
    },
  };
}
