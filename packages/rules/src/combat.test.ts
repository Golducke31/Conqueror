import { describe, expect, it } from 'vitest';

import { maxAttackerDice, maxDefenderDice, resolveRound, rollDice } from './combat.js';
import { createRng } from './rng.js';
import { configWith } from './test-helpers.js';
import type { Rng } from './types.js';

/** RNG de guion fijo: devuelve los valores dados, en orden. */
function secuencia(valores: readonly number[]): Rng {
  let cursor = 0;
  return {
    rollDie(): number {
      const valor = valores[cursor % valores.length] as number;
      cursor += 1;
      return valor;
    },
    int(min: number, max: number): number {
      const valor = valores[cursor % valores.length] as number;
      cursor += 1;
      return Math.max(min, Math.min(max, valor));
    },
    snapshot(): number {
      return cursor;
    },
  };
}

const config = configWith();

describe('combate', () => {
  describe('tope de dados', () => {
    it('el atacante tira hasta 3 y siempre deja 1 ejercito atras', () => {
      expect(maxAttackerDice(1, config)).toBe(0);
      expect(maxAttackerDice(2, config)).toBe(1);
      expect(maxAttackerDice(3, config)).toBe(2);
      expect(maxAttackerDice(4, config)).toBe(3);
      expect(maxAttackerDice(10, config)).toBe(3);
    });

    it('el defensor tira hasta 2, sin dejar nada atras', () => {
      expect(maxDefenderDice(0, config)).toBe(0);
      expect(maxDefenderDice(1, config)).toBe(1);
      expect(maxDefenderDice(2, config)).toBe(2);
      expect(maxDefenderDice(9, config)).toBe(2);
    });

    it('respeta la config: mas dados por bando', () => {
      const generosa = configWith({
        combat: { ...config.combat, maxAttackerDice: 5, maxDefenderDice: 4 },
      });
      expect(maxAttackerDice(9, generosa)).toBe(5);
      expect(maxDefenderDice(9, generosa)).toBe(4);
    });
  });

  describe('tirada', () => {
    it('devuelve los dados de mayor a menor', () => {
      expect(rollDice(3, secuencia([2, 6, 4]))).toEqual([6, 4, 2]);
    });

    it('sin dados devuelve una lista vacia', () => {
      expect(rollDice(0, secuencia([1]))).toEqual([]);
    });
  });

  describe('resolucion de la ronda', () => {
    it('compara de a pares y gana el dado mas alto (golden)', () => {
      // Atacante 5 ejercitos tira 3 dados: 6, 3, 5 → ordenados 6, 5, 3.
      // Defensor 3 ejercitos tira 2: 2, 1 → ordenados 2, 1.
      const ronda = resolveRound({
        from: 'brasil',
        to: 'peru',
        attackerArmies: 5,
        defenderArmies: 3,
        dice: 3,
        config,
        rng: secuencia([6, 3, 5, 2, 1]),
      });

      expect(ronda.type).toBe('BATTLE_ROUND_RESOLVED');
      expect(ronda.attackerDice).toEqual([6, 5, 3]);
      expect(ronda.defenderDice).toEqual([2, 1]);
      expect(ronda.comparisons).toEqual([
        { attackerDie: 6, defenderDie: 2, winner: 'attacker' },
        { attackerDie: 5, defenderDie: 1, winner: 'attacker' },
      ]);
      expect(ronda.attackerLosses).toBe(0);
      expect(ronda.defenderLosses).toBe(2);
      expect(ronda.attackerArmiesAfter).toBe(5);
      expect(ronda.defenderArmiesAfter).toBe(1);
    });

    it('el empate lo gana el defensor (golden)', () => {
      // 4 vs 4: atacante tira 3 (3, 3, 1) y defensor 2 (3, 1).
      const ronda = resolveRound({
        from: 'brasil',
        to: 'peru',
        attackerArmies: 4,
        defenderArmies: 4,
        dice: 3,
        config,
        rng: secuencia([3, 3, 1, 3, 1]),
      });

      expect(ronda.comparisons).toEqual([
        { attackerDie: 3, defenderDie: 3, winner: 'defender' },
        { attackerDie: 3, defenderDie: 1, winner: 'attacker' },
      ]);
      expect(ronda.attackerLosses).toBe(1);
      expect(ronda.defenderLosses).toBe(1);
    });

    it('el empate puede favorecer al atacante si la config lo pide', () => {
      const sinVentaja = configWith({
        combat: { ...config.combat, tiesGoToDefender: false },
      });
      const ronda = resolveRound({
        from: 'brasil',
        to: 'peru',
        attackerArmies: 4,
        defenderArmies: 4,
        dice: 3,
        config: sinVentaja,
        rng: secuencia([3, 3, 1, 3, 1]),
      });

      expect(ronda.comparisons[0]?.winner).toBe('attacker');
    });

    it('no se comparan mas pares que dados tenga el bando corto', () => {
      const ronda = resolveRound({
        from: 'brasil',
        to: 'peru',
        attackerArmies: 8,
        defenderArmies: 1,
        dice: 3,
        config,
        rng: secuencia([4, 5, 6, 2]),
      });

      expect(ronda.attackerDice).toHaveLength(3);
      expect(ronda.defenderDice).toHaveLength(1);
      expect(ronda.comparisons).toHaveLength(1);
      // 6 contra 2: gana el atacante, el defensor queda en 0 (conquista).
      expect(ronda.defenderArmiesAfter).toBe(0);
    });

    it('nunca deja ejercitos negativos', () => {
      // El atacante tira primero: 1 contra 6 → pierde el atacante.
      const pierdeAtacante = resolveRound({
        from: 'brasil',
        to: 'peru',
        attackerArmies: 2,
        defenderArmies: 1,
        dice: 1,
        config,
        rng: secuencia([1, 6]),
      });
      expect(pierdeAtacante.attackerArmiesAfter).toBe(1);
      expect(pierdeAtacante.defenderArmiesAfter).toBe(1);

      // 6 contra 1 → gana el atacante y el defensor queda en 0.
      const conquista = resolveRound({
        from: 'brasil',
        to: 'peru',
        attackerArmies: 2,
        defenderArmies: 1,
        dice: 1,
        config,
        rng: secuencia([6, 1]),
      });
      expect(conquista.attackerArmiesAfter).toBe(2);
      expect(conquista.defenderArmiesAfter).toBe(0);
    });

    it('la misma semilla da la misma ronda', () => {
      const correr = () =>
        resolveRound({
          from: 'brasil',
          to: 'peru',
          attackerArmies: 6,
          defenderArmies: 4,
          dice: 3,
          config,
          rng: createRng(4321),
        });

      expect(correr()).toEqual(correr());
      expect(correr().attackerDice).toHaveLength(3);
      expect(correr().defenderDice).toHaveLength(2);
    });
  });
});
