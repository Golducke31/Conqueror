/**
 * Combate: resolucion de UNA ronda.
 *
 * El atacante tira hasta `min(maxAttackerDice, ejercitos - 1)` dados y el
 * defensor hasta `min(maxDefenderDice, ejercitos)`. Los dados se ordenan de
 * mayor a menor y se comparan de a pares: en cada par el dado mas alto gana, y
 * **el empate lo gana el defensor** (configurable).
 *
 * La ronda devuelve un `BattleRoundResolved` con todo lo que paso. Ese es el
 * unico insumo del combate visual: la presentacion no decide nada (ADR 0006).
 */

import type { RulesConfig, TerritoryId } from '@conqueror/shared';

import type { BattleRoundResolved, DiceComparison, Rng } from './types.js';

export interface ResolveRoundOptions {
  readonly from: TerritoryId;
  readonly to: TerritoryId;
  /** Ejercitos del atacante en el territorio de origen (incluye los que se quedan). */
  readonly attackerArmies: number;
  /** Ejercitos del defensor en el territorio atacado. */
  readonly defenderArmies: number;
  /** Dados que el atacante decide tirar. */
  readonly dice: number;
  readonly config: RulesConfig;
  readonly rng: Rng;
}

/** Cuantos dados puede tirar el atacante con esa cantidad de ejercitos. */
export function maxAttackerDice(armies: number, config: RulesConfig): number {
  // Siempre tiene que quedar al menos un ejercito en el territorio de origen.
  return Math.max(0, Math.min(config.combat.maxAttackerDice, armies - 1));
}

/** Cuantos dados puede tirar el defensor con esa cantidad de ejercitos. */
export function maxDefenderDice(armies: number, config: RulesConfig): number {
  return Math.max(0, Math.min(config.combat.maxDefenderDice, armies));
}

/** Tira `count` dados y los devuelve de mayor a menor. */
export function rollDice(count: number, rng: Rng): number[] {
  const dados: number[] = [];
  for (let index = 0; index < count; index += 1) dados.push(rng.rollDie(6));
  return dados.sort((a, b) => b - a);
}

/**
 * Resuelve una ronda de combate. No valida el comando: eso es trabajo de
 * `apply`. Aca se asume que la tirada es legal.
 */
export function resolveRound(options: ResolveRoundOptions): BattleRoundResolved {
  const { from, to, attackerArmies, defenderArmies, config, rng } = options;

  const dadosAtacante = rollDice(
    Math.min(options.dice, maxAttackerDice(attackerArmies, config)),
    rng,
  );
  const dadosDefensor = rollDice(maxDefenderDice(defenderArmies, config), rng);

  const pares = Math.min(dadosAtacante.length, dadosDefensor.length);
  const comparisons: DiceComparison[] = [];
  let attackerLosses = 0;
  let defenderLosses = 0;

  for (let index = 0; index < pares; index += 1) {
    const atacante = dadosAtacante[index] as number;
    const defensor = dadosDefensor[index] as number;
    const ganaAtacante = config.combat.tiesGoToDefender
      ? atacante > defensor
      : atacante >= defensor;
    comparisons.push({
      attackerDie: atacante,
      defenderDie: defensor,
      winner: ganaAtacante ? 'attacker' : 'defender',
    });
    if (ganaAtacante) defenderLosses += 1;
    else attackerLosses += 1;
  }

  return {
    type: 'BATTLE_ROUND_RESOLVED',
    from,
    to,
    attackerDice: dadosAtacante,
    defenderDice: dadosDefensor,
    comparisons,
    attackerLosses,
    defenderLosses,
    attackerArmiesAfter: Math.max(0, attackerArmies - attackerLosses),
    defenderArmiesAfter: Math.max(0, defenderArmies - defenderLosses),
  };
}
