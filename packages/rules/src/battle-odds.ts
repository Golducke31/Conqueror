/**
 * Probabilidad de conquista (`estimateBattleOdds`).
 *
 * Funcion PURA y determinista: no toca el estado, no usa azar y no depende del
 * render. Calcula la probabilidad EXACTA de que un atacante con `attackerArmies`
 * termine conquistando un territorio defendido por `defenderArmies`, resolviendo
 * la cadena de Markov de estados `(a, d)` donde cada ronda reparte las perdidas
 * segun los dados.
 *
 * Semantica (reglas clasicas del tablero):
 *   - En cada territorio con dueno quedan `minArmiesPerTerritory` ejercitos
 *     como minimo (clasico: 1). El atacante tira con el resto:
 *     `min(maxAttackerDice, a - minimo)` dados, y puede atacar solo si le sobra
 *     al menos un ejercito.
 *   - El defensor tira `min(maxDefenderDice, d)` dados.
 *   - Cada par de dados (de mayor a mayor) es una comparacion; el empate lo gana
 *     el defensor salvo que la configuracion diga lo contrario.
 *   - El atacante GANA cuando el defensor cae por debajo del minimo (clasico:
 *     llega a 0) y PIERDE cuando ya no puede seguir tirando.
 *
 * Es informacion publica (plan de combate, seccion 10): se muestra al apuntar un
 * destino enemigo desde un origen propio. No decide nada: el motor resuelve las
 * rondas de verdad y esto solo anticipa el resultado probable.
 *
 * Ver docs/adr/0003-motor-de-reglas-puro-y-determinista.md
 */

import type { RulesConfig } from '@conqueror/shared';

/** Resultado de la estimacion. */
export interface BattleOdds {
  /**
   * Probabilidad de conquista, entre 0 y 1.
   * 0 = el atacante no puede atacar (no le sobran ejercitos).
   * 1 = el defensor ya esta por debajo del minimo (territorio tomado).
   */
  readonly winProbability: number;
}

/** Perdidas de UNA ronda, con su probabilidad. */
interface RoundOutcome {
  readonly attackerLosses: number;
  readonly defenderLosses: number;
  readonly probability: number;
}

/** Configuracion de combate que necesita el calculo. */
type CombatConfig = RulesConfig['combat'];

/**
 * Distribucion de perdidas de una ronda con `attackerDiceCount` dados de
 * atacante y `defenderDiceCount` de defensor.
 *
 * Enumeracion exhaustiva: con los topes clasicos (3 y 2) son como maximo
 * 6^5 = 7776 combinaciones, y cada dado es uniforme. El empate lo define la
 * configuracion.
 */
function roundOutcomes(
  attackerDiceCount: number,
  defenderDiceCount: number,
  combat: CombatConfig,
): RoundOutcome[] {
  const totals = new Map<number, number>();
  const record = (attackerLosses: number, defenderLosses: number): void => {
    const key = attackerLosses * 10 + defenderLosses;
    totals.set(key, (totals.get(key) ?? 0) + 1);
  };

  const attackerDice: number[] = [];
  const defenderDice: number[] = [];
  const rollAll = (index: number): void => {
    if (index < attackerDiceCount) {
      for (let face = 1; face <= 6; face += 1) {
        attackerDice[index] = face;
        rollAll(index + 1);
      }
      return;
    }
    if (index < attackerDiceCount + defenderDiceCount) {
      for (let face = 1; face <= 6; face += 1) {
        defenderDice[index - attackerDiceCount] = face;
        rollAll(index + 1);
      }
      return;
    }
    // Ronda resuelta: dados de mayor a menor y comparacion por pares.
    const sortedAttacker = [...attackerDice].sort((x, y) => y - x);
    const sortedDefender = [...defenderDice].sort((x, y) => y - x);
    const pairs = Math.min(sortedAttacker.length, sortedDefender.length);
    let attackerLosses = 0;
    let defenderLosses = 0;
    for (let pair = 0; pair < pairs; pair += 1) {
      const attackerDie = sortedAttacker[pair] ?? 0;
      const defenderDie = sortedDefender[pair] ?? 0;
      const attackerWins = combat.tiesGoToDefender
        ? attackerDie > defenderDie
        : attackerDie >= defenderDie;
      if (attackerWins) defenderLosses += 1;
      else attackerLosses += 1;
    }
    record(attackerLosses, defenderLosses);
  };
  rollAll(0);

  const totalCombinations = 6 ** (attackerDiceCount + defenderDiceCount);
  const outcomes: RoundOutcome[] = [];
  for (const [key, count] of totals) {
    outcomes.push({
      attackerLosses: Math.floor(key / 10),
      defenderLosses: key % 10,
      probability: count / totalCombinations,
    });
  }
  return outcomes;
}

/**
 * Cache de distribuciones: la cadena de Markov pregunta una y otra vez por la
 * misma combinacion de dados (solo hay 6 posibles con los topes clasicos).
 */
const outcomeCache = new Map<string, RoundOutcome[]>();

function cachedRoundOutcomes(
  attackerDiceCount: number,
  defenderDiceCount: number,
  combat: CombatConfig,
): RoundOutcome[] {
  const key = `${attackerDiceCount}:${defenderDiceCount}:${combat.tiesGoToDefender ? 'd' : 'a'}`;
  const cached = outcomeCache.get(key);
  if (cached !== undefined) return cached;
  const outcomes = roundOutcomes(attackerDiceCount, defenderDiceCount, combat);
  outcomeCache.set(key, outcomes);
  return outcomes;
}

/** Minimo de ejercitos que deben quedar en un territorio con dueno. */
function floorArmies(combat: CombatConfig): number {
  return Math.max(0, combat.minArmiesPerTerritory);
}

/**
 * Probabilidad de que el atacante conquiste el territorio.
 *
 * Los estados se resuelven en orden ascendente de `(a, d)`: cada ronda reduce
 * `a + d` en al menos 1 (siempre hay por lo menos una comparacion), asi que las
 * dependencias de un estado ya estan calculadas cuando se llega a el.
 */
export function estimateBattleOdds(
  attackerArmies: number,
  defenderArmies: number,
  config: RulesConfig,
): BattleOdds {
  if (!Number.isFinite(attackerArmies) || !Number.isFinite(defenderArmies)) {
    throw new Error('estimateBattleOdds: los ejercitos tienen que ser numeros finitos');
  }
  const combat = config.combat;
  const floor = floorArmies(combat);
  const attacker = Math.max(0, Math.floor(attackerArmies));
  const defender = Math.max(0, Math.floor(defenderArmies));

  // Casos absorbentes.
  if (attacker <= floor) return { winProbability: 0 };
  if (defender < floor) return { winProbability: 1 };

  // Tabla de probabilidades, indexada por atacante * ancho + defensor.
  const width = defender + 1;
  const table = new Float64Array((attacker + 1) * width);

  for (let a = floor + 1; a <= attacker; a += 1) {
    const attackerDice = Math.max(1, Math.min(combat.maxAttackerDice, a - floor));
    for (let d = floor; d <= defender; d += 1) {
      const defenderDice = Math.max(1, Math.min(combat.maxDefenderDice, d));
      const outcomes = cachedRoundOutcomes(attackerDice, defenderDice, combat);

      let probability = 0;
      for (const outcome of outcomes) {
        const nextA = a - outcome.attackerLosses;
        const nextD = d - outcome.defenderLosses;
        if (nextD < floor) {
          // El defensor no puede sostener el territorio: conquistado.
          probability += outcome.probability;
          continue;
        }
        if (nextA <= floor) continue; // El atacante ya no puede tirar.
        probability += outcome.probability * (table[nextA * width + nextD] ?? 0);
      }
      table[a * width + d] = probability;
    }
  }

  return { winProbability: table[attacker * width + defender] ?? 0 };
}
