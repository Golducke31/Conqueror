import { describe, expect, it } from 'vitest';

import type { RulesConfig } from '@conqueror/shared';
import { DEFAULT_RULES_CONFIG } from '@conqueror/shared';
import { estimateBattleOdds } from './battle-odds.js';

/** Config clasica, con overrides puntuales para los tests. */
function config(overrides: Partial<RulesConfig['combat']> = {}): RulesConfig {
  return { ...DEFAULT_RULES_CONFIG, combat: { ...DEFAULT_RULES_CONFIG.combat, ...overrides } };
}

/** Generador determinista (mulberry32), igual que el de los datos de prueba. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Simulacion Monte Carlo de una batalla completa, con la MISMA semantica de
 * dados que la cadena de Markov. Sirve para verificar el calculo exacto contra
 * un camino de codigo independiente.
 */
function simulateBattle(
  attackerArmies: number,
  defenderArmies: number,
  rules: RulesConfig,
  random: () => number,
): boolean {
  const combat = rules.combat;
  let a = attackerArmies;
  let d = defenderArmies;
  const floor = combat.minArmiesPerTerritory;
  const roll = (count: number): number[] =>
    Array.from({ length: count }, () => 1 + Math.floor(random() * 6)).sort((x, y) => y - x);

  while (a > floor && d >= floor) {
    const attackerDice = roll(Math.max(1, Math.min(combat.maxAttackerDice, a - floor)));
    const defenderDice = roll(Math.max(1, Math.min(combat.maxDefenderDice, d)));
    const pairs = Math.min(attackerDice.length, defenderDice.length);
    for (let pair = 0; pair < pairs; pair += 1) {
      const attackerWins = combat.tiesGoToDefender
        ? (attackerDice[pair] ?? 0) > (defenderDice[pair] ?? 0)
        : (attackerDice[pair] ?? 0) >= (defenderDice[pair] ?? 0);
      if (attackerWins) d -= 1;
      else a -= 1;
    }
  }
  return d < floor;
}

function monteCarlo(
  attackerArmies: number,
  defenderArmies: number,
  rules: RulesConfig,
  battles: number,
  seed: number,
): number {
  const random = mulberry32(seed);
  let wins = 0;
  for (let battle = 0; battle < battles; battle += 1) {
    if (simulateBattle(attackerArmies, defenderArmies, rules, random)) wins += 1;
  }
  return wins / battles;
}

describe('estimateBattleOdds — casos chicos conocidos', () => {
  it('1 dado vs 1 dado, empate para el defensor: 15/36', () => {
    const odds = estimateBattleOdds(2, 1, config());
    expect(odds.winProbability).toBeCloseTo(15 / 36, 10);
  });

  it('2 dados vs 1 (atacante usa el mayor): 1955/2592', () => {
    // Gana en el acto si el mayor supera al dado del defensor (125/216); si
    // pierde la comparacion queda en 2v1 y puede seguir tirando (91/216 x 15/36).
    const odds = estimateBattleOdds(3, 1, config());
    expect(odds.winProbability).toBeCloseTo(125 / 216 + (91 / 216) * (15 / 36), 10);
    expect(odds.winProbability).toBeCloseTo(1955 / 2592, 10);
  });

  it('1 dado vs 2 (compara solo contra el mayor del defensor): 825/7776', () => {
    // Si supera al mayor (55/216) el defensor queda en 1 y la batalla sigue en
    // el caso de 1 dado vs 1 (15/36); si no, el atacante ya no puede tirar.
    const odds = estimateBattleOdds(2, 2, config());
    expect(odds.winProbability).toBeCloseTo((55 / 216) * (15 / 36), 10);
    expect(odds.winProbability).toBeCloseTo(825 / 7776, 10);
  });

  it('con el empate a favor del atacante: 21/36', () => {
    const odds = estimateBattleOdds(2, 1, config({ tiesGoToDefender: false }));
    expect(odds.winProbability).toBeCloseTo(21 / 36, 10);
  });

  it('con un solo dado de atacante la batalla es una caminata aleatoria', () => {
    // Cada ronda: gana la comparacion con p = 15/36 (y conquista al instante,
    // porque el defensor tiene 1) o pierde con q = 21/36 (y se acerca al piso).
    // Con 9 ejercitos puede perder 8 veces antes de no poder tirar:
    // P(conquistar) = sum(q^k * p, k = 0..7) = 1 - q^8.
    const q = 21 / 36;
    const odds = estimateBattleOdds(9, 1, config({ maxAttackerDice: 1 }));
    expect(odds.winProbability).toBeCloseTo(1 - q ** 8, 10);
  });
});

describe('estimateBattleOdds — casos absorbentes', () => {
  it('con 1 ejercito no se puede atacar', () => {
    expect(estimateBattleOdds(1, 5, config()).winProbability).toBe(0);
    expect(estimateBattleOdds(0, 5, config()).winProbability).toBe(0);
  });

  it('contra 0 ejercitos el territorio ya esta tomado', () => {
    expect(estimateBattleOdds(5, 0, config()).winProbability).toBe(1);
    expect(estimateBattleOdds(2, 0, config()).winProbability).toBe(1);
  });

  it('respeta minArmiesPerTerritory: con 2 de minimo hay que atacar con 3', () => {
    const rules = config({ minArmiesPerTerritory: 2 });
    expect(estimateBattleOdds(2, 5, rules).winProbability).toBe(0);
    // Con 3 ejercitos tira 1 dado, pero el defensor con 2 tira 2: si supera al
    // mayor (55/216) el defensor cae a 1, por debajo del minimo: conquistado.
    expect(estimateBattleOdds(3, 2, rules).winProbability).toBeCloseTo(55 / 216, 10);
  });

  it('rechaza valores no finitos', () => {
    expect(() => estimateBattleOdds(Number.NaN, 3, config())).toThrow();
    expect(() => estimateBattleOdds(3, Number.POSITIVE_INFINITY, config())).toThrow();
  });
});

describe('estimateBattleOdds — Monte Carlo con semilla fija', () => {
  const casos: readonly (readonly [number, number])[] = [
    [3, 2],
    [5, 4],
    [8, 6],
    [10, 10],
    [20, 15],
    [2, 12],
  ];

  for (const [attacker, defender] of casos) {
    it(`${attacker}v${defender} coincide con la simulacion (tolerancia 0.02)`, () => {
      const exact = estimateBattleOdds(attacker, defender, config()).winProbability;
      const sampled = monteCarlo(attacker, defender, config(), 20_000, 12345);
      expect(Math.abs(exact - sampled)).toBeLessThan(0.02);
    });
  }

  it('tambien coincide con el empate a favor del atacante', () => {
    const rules = config({ tiesGoToDefender: false });
    for (const [attacker, defender] of casos) {
      const exact = estimateBattleOdds(attacker, defender, rules).winProbability;
      const sampled = monteCarlo(attacker, defender, rules, 20_000, 777);
      expect(Math.abs(exact - sampled)).toBeLessThan(0.02);
    }
  });
});

describe('estimateBattleOdds — invariantes', () => {
  it('mas ejercitos de atacante nunca bajan la probabilidad', () => {
    for (let defender = 1; defender <= 10; defender += 1) {
      let previous = 0;
      for (let attacker = 2; attacker <= 25; attacker += 1) {
        const current = estimateBattleOdds(attacker, defender, config()).winProbability;
        expect(current).toBeGreaterThanOrEqual(previous - 1e-12);
        previous = current;
      }
    }
  });

  it('mas ejercitos de defensor nunca suben la probabilidad', () => {
    for (let attacker = 2; attacker <= 10; attacker += 1) {
      let previous = 1;
      for (let defender = 1; defender <= 25; defender += 1) {
        const current = estimateBattleOdds(attacker, defender, config()).winProbability;
        expect(current).toBeLessThanOrEqual(previous + 1e-12);
        expect(current).toBeGreaterThanOrEqual(0);
        previous = current;
      }
    }
  });

  it('las probabilidades quedan siempre en [0, 1]', () => {
    for (let attacker = 2; attacker <= 20; attacker += 3) {
      for (let defender = 1; defender <= 20; defender += 3) {
        const value = estimateBattleOdds(attacker, defender, config()).winProbability;
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('el empate a favor del atacante nunca empeora sus chances', () => {
    for (const [attacker, defender] of [
      [3, 2],
      [5, 5],
      [12, 9],
    ] as const) {
      const tiesDefender = estimateBattleOdds(attacker, defender, config()).winProbability;
      const tiesAttacker = estimateBattleOdds(
        attacker,
        defender,
        config({ tiesGoToDefender: false }),
      ).winProbability;
      expect(tiesAttacker).toBeGreaterThanOrEqual(tiesDefender);
    }
  });
});

describe('estimateBattleOdds — contra un resolvedor independiente', () => {
  /**
   * Iteracion de la funcion de valor: parte de probabilidades cero y aplica
   * la ecuacion de Bellman un numero fijo de veces. Como cada ronda reduce
   * `a + d`, la iteracion converge de forma EXACTA y por un camino distinto al
   * de la tabla ascendente.
   */
  function iterate(
    attackerArmies: number,
    defenderArmies: number,
    rules: RulesConfig,
    rounds: number,
  ): number {
    const combat = rules.combat;
    const floor = combat.minArmiesPerTerritory;
    const width = defenderArmies + 1;
    let value = new Float64Array((attackerArmies + 1) * width);
    let next = new Float64Array((attackerArmies + 1) * width);

    for (let round = 0; round < rounds; round += 1) {
      for (let a = floor + 1; a <= attackerArmies; a += 1) {
        const attackerDice = Math.max(1, Math.min(combat.maxAttackerDice, a - floor));
        for (let d = floor; d <= defenderArmies; d += 1) {
          const defenderDice = Math.max(1, Math.min(combat.maxDefenderDice, d));
          const outcomes = new Map<string, number>();
          // Misma enumeracion exhaustiva, aca escrita con otro recorrido.
          const attacker: number[] = [];
          const defender: number[] = [];
          const enumerate = (index: number): void => {
            if (index < attackerDice) {
              for (let face = 1; face <= 6; face += 1) {
                attacker[index] = face;
                enumerate(index + 1);
              }
              return;
            }
            if (index < attackerDice + defenderDice) {
              for (let face = 1; face <= 6; face += 1) {
                defender[index - attackerDice] = face;
                enumerate(index + 1);
              }
              return;
            }
            const sortedAttacker = [...attacker].sort((x, y) => y - x);
            const sortedDefender = [...defender].sort((x, y) => y - x);
            const pairs = Math.min(sortedAttacker.length, sortedDefender.length);
            let attackerLosses = 0;
            let defenderLosses = 0;
            for (let pair = 0; pair < pairs; pair += 1) {
              const attackerWins = combat.tiesGoToDefender
                ? (sortedAttacker[pair] ?? 0) > (sortedDefender[pair] ?? 0)
                : (sortedAttacker[pair] ?? 0) >= (sortedDefender[pair] ?? 0);
              if (attackerWins) defenderLosses += 1;
              else attackerLosses += 1;
            }
            const key = `${attackerLosses}:${defenderLosses}`;
            outcomes.set(key, (outcomes.get(key) ?? 0) + 1);
          };
          enumerate(0);

          const total = 6 ** (attackerDice + defenderDice);
          let probability = 0;
          for (const [key, count] of outcomes) {
            const [attackerLosses, defenderLosses] = key.split(':').map(Number) as [number, number];
            const nextA = a - attackerLosses;
            const nextD = d - defenderLosses;
            if (nextD < floor) probability += count / total;
            else if (nextA > floor)
              probability += (count / total) * (value[nextA * width + nextD] ?? 0);
          }
          next[a * width + d] = probability;
        }
      }
      const swap = value;
      value = next;
      next = swap;
      next.fill(0);
    }
    return value[attackerArmies * width + defenderArmies] ?? 0;
  }

  const casos: readonly (readonly [number, number])[] = [
    [3, 2],
    [5, 4],
    [8, 6],
    [12, 10],
  ];

  for (const [attacker, defender] of casos) {
    it(`${attacker}v${defender} coincide con la iteracion de Bellman`, () => {
      const exact = estimateBattleOdds(attacker, defender, config()).winProbability;
      // Cada ronda baja a + d en al menos 1: con sobra de rondas converge.
      expect(iterate(attacker, defender, config(), attacker + defender + 2)).toBeCloseTo(exact, 10);
    }, 20_000); // necesita unos segundos. // La iteracion enumera a mano cada combinacion de dados: el caso grande
  }

  it('tambien coincide con minArmiesPerTerritory = 2', () => {
    const rules = config({ minArmiesPerTerritory: 2 });
    const exact = estimateBattleOdds(6, 4, rules).winProbability;
    expect(iterate(6, 4, rules, 10)).toBeCloseTo(exact, 10);
  });
});
