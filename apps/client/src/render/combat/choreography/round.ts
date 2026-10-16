/**
 * Coreografia de una ronda de combate.
 *
 * Funcion PURA: convierte un `BATTLE_ROUND_RESOLVED` ya resuelto por el motor en
 * un plan de timeline —cuando caen los dados, cuando golpea cada duelo, quien
 * actua, quien cae y cuando se reacomodan las escuadras—. No toca Three.js, ni
 * el DOM, ni el azar. Por eso se puede testear sin WebGL, que es justo lo que
 * pide el plan de combate (seccion 16).
 *
 * Decisiones de coreografia:
 *   - Las bajas caen SIEMPRE en la primera fila de su bando (plan, seccion 6.4).
 *   - El duelista que actua se elige rotando por la escuadra, asi que su tipo
 *     queda ponderado por la composicion: una escuadra de infanteria pelea con
 *     infanteria.
 *   - Cada comparacion de dados es exactamente un duelo y exactamente una baja.
 */

import type { BattleRoundResolved, DiceComparison, UnitType } from '@conqueror/rules';
import type { RoundTiming } from '../spectacle.js';

/** Que hace la unidad ganadora al ganar el duelo. */
export type DuelAction = 'volley' | 'charge' | 'cannon';

export type Side = 'attacker' | 'defender';

/** Un duelo: una comparacion de dados convertida en un enfrentamiento visible. */
export interface DuelPlan {
  readonly pairIndex: number;
  /** Instante en el que arranca el duelo, en segundos desde el inicio de la ronda. */
  readonly start: number;
  readonly duration: number;
  readonly attackerDie: number;
  readonly defenderDie: number;
  readonly winner: Side;
  /** Unidad que ejecuta la accion. */
  readonly actingUnit: UnitType;
  readonly actingSide: Side;
  /** Posicion del duelista dentro de su formacion. */
  readonly actingIndex: number;
  readonly action: DuelAction;
  /** Unidad que cae. */
  readonly casualtyUnit: UnitType;
  readonly casualtySide: Side;
  /** Posicion de la baja dentro de su formacion (primera fila). */
  readonly casualtyIndex: number;
}

export interface PhasePlan {
  readonly start: number;
  readonly duration: number;
}

export interface RoundPlan {
  readonly from: string;
  readonly to: string;
  /** Duracion total de la ronda. */
  readonly duration: number;
  readonly diceRoll: PhasePlan;
  readonly diceLand: PhasePlan;
  /** Dados del atacante, de mayor a menor, tal como vinieron del motor. */
  readonly attackerDice: readonly number[];
  readonly defenderDice: readonly number[];
  readonly duels: readonly DuelPlan[];
  readonly regroup: PhasePlan;
  readonly attackerCasualties: readonly UnitType[];
  readonly defenderCasualties: readonly UnitType[];
  /** Unidades que quedan vivas en cada bando al cerrar la ronda. */
  readonly attackerAliveAfter: readonly UnitType[];
  readonly defenderAliveAfter: readonly UnitType[];
}

export interface PlanRoundInput {
  readonly event: BattleRoundResolved;
  /** Unidades vivas de cada bando, en orden de formacion (primera fila primero). */
  readonly attackerAlive: readonly UnitType[];
  readonly defenderAlive: readonly UnitType[];
  readonly timing: RoundTiming;
}

/** Accion que corresponde a cada tipo de unidad. */
export function actionFor(unit: UnitType): DuelAction {
  if (unit === 'artillery') return 'cannon';
  if (unit === 'cavalry') return 'charge';
  return 'volley';
}

/**
 * Comparaciones del evento. Si el motor no las trajo (por ejemplo, un evento
 * armado a mano), se reconstruyen emparejando los dados ya ordenados de mayor a
 * menor; el empate lo gana el defensor.
 */
export function normalizeComparisons(event: BattleRoundResolved): DiceComparison[] {
  if (event.comparisons.length > 0) return [...event.comparisons];

  const attacker = [...event.attackerDice].sort((a, b) => b - a);
  const defender = [...event.defenderDice].sort((a, b) => b - a);
  const pairs = Math.min(attacker.length, defender.length);
  const out: DiceComparison[] = [];
  for (let index = 0; index < pairs; index += 1) {
    const attackerDie = attacker[index] ?? 0;
    const defenderDie = defender[index] ?? 0;
    out.push({
      attackerDie,
      defenderDie,
      winner: attackerDie > defenderDie ? 'attacker' : 'defender',
    });
  }
  return out;
}

/**
 * Arma el plan de la ronda.
 *
 * Los tiempos salen de `timing`, que depende del nivel de espectaculo: con el
 * perfil Tactico, el peor caso (3 pares) da 2.0 s, por debajo del tope de 2.5 s.
 */
/** Indice del `ordinal`-esimo elemento de [0,total) que NO esta en `killed`. */
function survivorIndex(total: number, killed: ReadonlySet<number>, ordinal: number): number {
  let seen = 0;
  for (let index = 0; index < total; index += 1) {
    if (killed.has(index)) continue;
    if (seen === ordinal) return index;
    seen += 1;
  }
  return -1;
}

/** Primer indice de [0,total) que no esta en `killed` (la fila de frontera). */
function firstFreeIndex(total: number, killed: ReadonlySet<number>): number {
  for (let index = 0; index < total; index += 1) {
    if (!killed.has(index)) return index;
  }
  return -1;
}

export function planRound(input: PlanRoundInput): RoundPlan {
  const comparisons = normalizeComparisons(input.event);
  const { timing } = input;

  const attackerAlive: readonly UnitType[] = input.attackerAlive;
  const defenderAlive: readonly UnitType[] = input.defenderAlive;

  const attackerCasualties: UnitType[] = [];
  const defenderCasualties: UnitType[] = [];
  const duels: DuelPlan[] = [];

  const lead = timing.diceRoll + timing.diceLand;
  let attackerCursor = 0;
  let defenderCursor = 0;
  const attackerKilled = new Set<number>();
  const defenderKilled = new Set<number>();

  comparisons.forEach((comparison, pairIndex) => {
    const actingSide: Side = comparison.winner;
    const casualtySide: Side = actingSide === 'attacker' ? 'defender' : 'attacker';

    const actingTotal = actingSide === 'attacker' ? attackerAlive.length : defenderAlive.length;
    const actingKilled = actingSide === 'attacker' ? attackerKilled : defenderKilled;
    const actingCursor = actingSide === 'attacker' ? attackerCursor : defenderCursor;
    const actingIndex = survivorIndex(actingTotal, actingKilled, actingCursor);
    const actingUnit =
      actingSide === 'attacker' ? attackerAlive[actingIndex] : defenderAlive[actingIndex];
    // Sin unidades no hay duelo posible: el motor no deberia mandar esto.
    if (actingUnit === undefined) return;

    // La baja cae en la primera fila libre de su bando (de frente hacia atras).
    // Varios duelos en una ronda reparten indices distintos para no matar dos
    // veces a la misma unidad.
    const casualtyKilled = casualtySide === 'attacker' ? attackerKilled : defenderKilled;
    const casualtyTotal = casualtySide === 'attacker' ? attackerAlive.length : defenderAlive.length;
    const casualtyIndex = firstFreeIndex(casualtyTotal, casualtyKilled);
    const casualtyUnit =
      casualtySide === 'attacker' ? attackerAlive[casualtyIndex] : defenderAlive[casualtyIndex];
    if (casualtyUnit === undefined) return;

    casualtyKilled.add(casualtyIndex);
    if (casualtySide === 'attacker') attackerCasualties.push(casualtyUnit);
    else defenderCasualties.push(casualtyUnit);

    duels.push({
      pairIndex,
      start: lead + pairIndex * timing.duelStagger,
      duration: timing.duel,
      attackerDie: comparison.attackerDie,
      defenderDie: comparison.defenderDie,
      winner: actingSide,
      actingUnit,
      actingSide,
      actingIndex,
      action: actionFor(actingUnit),
      casualtyUnit,
      casualtySide,
      casualtyIndex,
    });

    if (actingSide === 'attacker') attackerCursor += 1;
    else defenderCursor += 1;
  });

  const lastDuel = duels[duels.length - 1];
  const duelsEnd = lastDuel === undefined ? lead : lastDuel.start + lastDuel.duration;

  return {
    from: input.event.from,
    to: input.event.to,
    duration: duelsEnd + timing.regroup,
    diceRoll: { start: 0, duration: timing.diceRoll },
    diceLand: { start: timing.diceRoll, duration: timing.diceLand },
    attackerDice: [...input.event.attackerDice],
    defenderDice: [...input.event.defenderDice],
    duels,
    regroup: { start: duelsEnd, duration: timing.regroup },
    attackerCasualties,
    defenderCasualties,
    attackerAliveAfter: attackerAlive.filter((_, index) => !attackerKilled.has(index)),
    defenderAliveAfter: defenderAlive.filter((_, index) => !defenderKilled.has(index)),
  };
}
