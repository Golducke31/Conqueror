import { describe, expect, it } from 'vitest';
import { composeSquad, expandSquad, type BattleRoundResolved } from '@conqueror/rules';
import { actionFor, normalizeComparisons, planRound, type PlanRoundInput } from './round.js';
import { SPECTACLE_PROFILES, type SpectacleLevel } from '../spectacle.js';

/** Arma un evento coherente a partir de dos tiradas. */
function makeEvent(
  attackerDice: readonly number[],
  defenderDice: readonly number[],
  from = 'brasil',
  to = 'argentina',
): BattleRoundResolved {
  const attacker = [...attackerDice].sort((a, b) => b - a);
  const defender = [...defenderDice].sort((a, b) => b - a);
  const pairs = Math.min(attacker.length, defender.length);
  const comparisons = [];
  let attackerLosses = 0;
  let defenderLosses = 0;
  for (let index = 0; index < pairs; index += 1) {
    const attackerDie = attacker[index] ?? 0;
    const defenderDie = defender[index] ?? 0;
    const winner = attackerDie > defenderDie ? ('attacker' as const) : ('defender' as const);
    comparisons.push({ attackerDie, defenderDie, winner });
    if (winner === 'attacker') defenderLosses += 1;
    else attackerLosses += 1;
  }
  return {
    type: 'BATTLE_ROUND_RESOLVED',
    from,
    to,
    attackerDice: attacker,
    defenderDice: defender,
    comparisons,
    attackerLosses,
    defenderLosses,
    attackerArmiesAfter: 0,
    defenderArmiesAfter: 0,
  };
}

function plan(
  attackerDice: readonly number[],
  defenderDice: readonly number[],
  attackerArmies = 12,
  defenderArmies = 8,
  level: SpectacleLevel = 'tactical',
) {
  const input: PlanRoundInput = {
    event: makeEvent(attackerDice, defenderDice),
    attackerAlive: expandSquad(composeSquad(attackerArmies, { maxUnits: 16 })),
    defenderAlive: expandSquad(composeSquad(defenderArmies, { maxUnits: 16 })),
    timing: SPECTACLE_PROFILES[level].timing,
  };
  return planRound(input);
}

describe('planRound — correspondencia con el evento', () => {
  it('cada comparacion produce exactamente un duelo', () => {
    const resultado = plan([6, 5, 2], [5, 2]);
    expect(resultado.duels).toHaveLength(2);
  });

  it('las bajas visibles coinciden con las perdidas del evento', () => {
    for (const [attacker, defender] of [
      [
        [6, 5, 2],
        [5, 2],
      ],
      [
        [3, 2, 1],
        [6, 5],
      ],
      [[4], [4]],
      [
        [6, 6, 6],
        [1, 1],
      ],
    ] as const) {
      const resultado = plan(attacker, defender);
      const event = makeEvent(attacker, defender);
      expect(resultado.attackerCasualties).toHaveLength(event.attackerLosses);
      expect(resultado.defenderCasualties).toHaveLength(event.defenderLosses);
    }
  });

  it('las unidades vivas son las de antes menos las bajas', () => {
    const resultado = plan([6, 5, 2], [5, 2], 12, 8);
    const attackerBefore = expandSquad(composeSquad(12, { maxUnits: 16 }));
    const defenderBefore = expandSquad(composeSquad(8, { maxUnits: 16 }));

    expect(resultado.attackerAliveAfter.length).toBe(
      attackerBefore.length - resultado.attackerCasualties.length,
    );
    expect(resultado.defenderAliveAfter.length).toBe(
      defenderBefore.length - resultado.defenderCasualties.length,
    );
  });

  it('las bajas caen en la primera fila de su bando', () => {
    const resultado = plan([6, 5, 2], [5, 2], 12, 8);
    const defenderBefore = expandSquad(composeSquad(8, { maxUnits: 16 }));
    // Las bajas del defensor son sus primeras unidades, de frente hacia atras.
    expect(resultado.defenderCasualties).toEqual(
      defenderBefore.slice(0, resultado.defenderCasualties.length),
    );
    // Y cada duelo marca una baja en un indice distinto de su bando.
    const indices = resultado.duels
      .filter((duel) => duel.casualtySide === 'defender')
      .map((duel) => duel.casualtyIndex)
      .sort((a, b) => a - b);
    expect(indices).toEqual(indices.filter((value, index, list) => list.indexOf(value) === index));
    expect(indices).toEqual(indices.map((_, index) => index));
  });

  it('sin comparaciones no hay duelos ni bajas', () => {
    const resultado = plan([], []);
    expect(resultado.duels).toEqual([]);
    expect(resultado.attackerCasualties).toEqual([]);
    expect(resultado.defenderCasualties).toEqual([]);
  });
});

describe('planRound — tiempos', () => {
  const casos = [
    [[6], [5]],
    [
      [6, 5],
      [5, 2],
    ],
    [
      [6, 5, 2],
      [5, 2],
    ],
  ] as const;

  for (const level of ['fast', 'tactical', 'cinematic'] as const) {
    it(`una ronda "${level}" entra en su presupuesto`, () => {
      for (const [attacker, defender] of casos) {
        const resultado = plan(attacker, defender, 12, 8, level);
        expect(resultado.duration).toBeLessThanOrEqual(SPECTACLE_PROFILES[level].roundSeconds);
      }
    });
  }

  it('una ronda Tactico tipica de 2 pares dura 1.7 s', () => {
    // El tablero clasico usa 2 dados de defensor, asi que 2 pares es el caso
    // normal (3 solo si la config subiera los dados del defensor).
    const resultado = plan([6, 5, 2], [5, 2], 12, 8, 'tactical');
    expect(resultado.duels).toHaveLength(2);
    expect(resultado.duration).toBeCloseTo(1.7, 5);
    expect(resultado.duration).toBeLessThanOrEqual(2.5);
  });

  it('el peor caso de 3 pares tambien entra en el tope de 2.5 s', () => {
    const resultado = plan([6, 5, 2], [5, 2, 1], 12, 8, 'tactical');
    expect(resultado.duels).toHaveLength(3);
    expect(resultado.duration).toBeCloseTo(2.0, 5);
    expect(resultado.duration).toBeLessThanOrEqual(2.5);
  });

  it('los duelos arrancan escalonados y no se solapan del todo', () => {
    const resultado = plan([6, 5, 2], [5, 2]);
    const [first, second] = resultado.duels;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;
    expect(second.start).toBeGreaterThan(first.start);
    expect(second.start - first.start).toBeCloseTo(
      SPECTACLE_PROFILES.tactical.timing.duelStagger,
      5,
    );
  });

  it('los dados caen antes que el primer duelo', () => {
    const resultado = plan([6, 5], [5, 2]);
    const first = resultado.duels[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(resultado.diceRoll.start).toBe(0);
    expect(resultado.diceLand.start).toBe(resultado.diceRoll.duration);
    expect(first.start).toBeGreaterThanOrEqual(
      resultado.diceLand.start + resultado.diceLand.duration,
    );
  });

  it('el reacomodo arranca cuando termina el ultimo duelo', () => {
    const resultado = plan([6, 5, 2], [5, 2]);
    const last = resultado.duels[resultado.duels.length - 1];
    expect(last).toBeDefined();
    if (last === undefined) return;
    expect(resultado.regroup.start).toBeCloseTo(last.start + last.duration, 5);
  });
});

describe('planRound — acciones y determinismo', () => {
  it('la accion depende del tipo de unidad que gana el duelo', () => {
    expect(actionFor('infantry')).toBe('volley');
    expect(actionFor('cavalry')).toBe('charge');
    expect(actionFor('artillery')).toBe('cannon');
  });

  it('el duelista que actua pertenece al bando ganador', () => {
    const resultado = plan([6, 5, 2], [5, 2]);
    for (const duel of resultado.duels) {
      expect(duel.actingSide).toBe(duel.winner);
      expect(duel.actingUnit).toBeDefined();
    }
  });

  it('es determinista', () => {
    const a = plan([6, 5, 2], [5, 2]);
    const b = plan([6, 5, 2], [5, 2]);
    expect(a).toEqual(b);
  });

  it('reconstruye las comparaciones si el evento no las trae', () => {
    const event: BattleRoundResolved = {
      type: 'BATTLE_ROUND_RESOLVED',
      from: 'a',
      to: 'b',
      attackerDice: [6, 5, 2],
      defenderDice: [5, 2],
      comparisons: [],
      attackerLosses: 0,
      defenderLosses: 0,
      attackerArmiesAfter: 0,
      defenderArmiesAfter: 0,
    };
    const comparisons = normalizeComparisons(event);
    expect(comparisons).toHaveLength(2);
    expect(comparisons[0]).toEqual({ attackerDie: 6, defenderDie: 5, winner: 'attacker' });
    expect(comparisons[1]).toEqual({ attackerDie: 5, defenderDie: 2, winner: 'attacker' });
  });

  it('el empate lo gana el defensor al reconstruir', () => {
    const event: BattleRoundResolved = {
      type: 'BATTLE_ROUND_RESOLVED',
      from: 'a',
      to: 'b',
      attackerDice: [4, 4],
      defenderDice: [4, 4],
      comparisons: [],
      attackerLosses: 0,
      defenderLosses: 0,
      attackerArmiesAfter: 0,
      defenderArmiesAfter: 0,
    };
    for (const comparison of normalizeComparisons(event)) {
      expect(comparison.winner).toBe('defender');
    }
  });
});
