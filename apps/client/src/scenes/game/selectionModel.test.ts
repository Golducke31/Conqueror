import { describe, expect, it } from 'vitest';

import { DEFAULT_RULES_CONFIG } from '@conqueror/shared';
import type { TerritoryId } from '@conqueror/shared';

import {
  dadosMaximos,
  propiosAlcanzables,
  resolverClic,
  type PickContext,
  type TerritoryView,
} from './selectionModel.js';

/**
 * Tablero de prueba:
 *
 *   a - b - c      a, b, c propios de p1
 *       |   |
 *       d   e      d neutral, e de p2
 *       |
 *       f          f de p2, solo alcanzable desde d
 */
function contexto(overrides: Partial<PickContext> = {}): PickContext {
  const territorios: Record<TerritoryId, TerritoryView> = {
    a: { owner: 'p1', armies: 5 },
    b: { owner: 'p1', armies: 3 },
    c: { owner: 'p1', armies: 1 },
    d: { owner: null, armies: 2 },
    e: { owner: 'p2', armies: 4 },
    f: { owner: 'p2', armies: 1 },
    g: { owner: 'p1', armies: 2 },
  };
  return {
    phase: 'attack',
    activePlayer: 'p1',
    territories: territorios,
    adjacency: {
      a: ['b'],
      b: ['a', 'c', 'd', 'e'],
      c: ['b', 'e'],
      d: ['b', 'f'],
      e: ['b', 'c'],
      f: ['d', 'g'],
      g: ['f'],
    },
    rules: DEFAULT_RULES_CONFIG,
    selection: { origin: null, target: null },
    ...overrides,
  };
}

describe('resolverClic en ataque', () => {
  it('sin seleccion, un territorio propio con ejercitos pasa a origen', () => {
    expect(resolverClic(contexto(), 'a')).toEqual({ kind: 'select-origin', territory: 'a' });
  });

  it('sin seleccion, un territorio ajeno solo se inspecciona', () => {
    expect(resolverClic(contexto(), 'e')).toEqual({ kind: 'inspect', territory: 'e' });
  });

  it('un territorio propio sin ejercitos para atacar no es origen', () => {
    // c tiene 1 ejercito y el minimo es 1: no puede tirar ningun dado.
    expect(resolverClic(contexto(), 'c')).toEqual({ kind: 'inspect', territory: 'c' });
  });

  it('el clic sobre el origen ya elegido quita la seleccion', () => {
    const ctx = contexto({ selection: { origin: 'a', target: null } });
    expect(resolverClic(ctx, 'a')).toEqual({ kind: 'clear' });
  });

  it('cambiar de origen es un solo clic', () => {
    const ctx = contexto({ selection: { origin: 'a', target: null } });
    expect(resolverClic(ctx, 'b')).toEqual({ kind: 'select-origin', territory: 'b' });
  });

  it('con origen elegido, un vecino enemigo se ataca', () => {
    const ctx = contexto({ selection: { origin: 'b', target: null } });
    expect(resolverClic(ctx, 'e')).toMatchObject({ kind: 'attack', from: 'b', to: 'e' });
  });

  it('con origen elegido, un vecino neutral tambien se ataca', () => {
    // El motor permite atacar neutrales: excluirlos dejaba la flecha sin
    // dibujar en objetivos perfectamente legales.
    const ctx = contexto({ selection: { origin: 'b', target: null } });
    expect(resolverClic(ctx, 'd')).toMatchObject({ kind: 'attack', from: 'b', to: 'd' });
  });

  it('un enemigo no adyacente se rechaza con motivo', () => {
    const ctx = contexto({ selection: { origin: 'a', target: null } });
    expect(resolverClic(ctx, 'e')).toEqual({ kind: 'invalid', reason: 'not-adjacent' });
  });

  it('sin tablero bajo el puntero se limpia la seleccion', () => {
    expect(resolverClic(contexto(), null)).toEqual({ kind: 'clear' });
  });
});

describe('resolverClic en refuerzo y despliegue', () => {
  for (const phase of ['reinforce', 'setup-placement'] as const) {
    it(`en ${phase} el clic elige donde colocar`, () => {
      const ctx = contexto({ phase });
      expect(resolverClic(ctx, 'a')).toEqual({ kind: 'select-origin', territory: 'a' });
      expect(resolverClic(ctx, 'e')).toEqual({ kind: 'inspect', territory: 'e' });
    });
  }
});

describe('resolverClic en reagrupe', () => {
  it('el primer clic propio es el origen y el segundo el destino', () => {
    const ctx = contexto({ phase: 'regroup' });
    expect(resolverClic(ctx, 'a')).toEqual({ kind: 'select-origin', territory: 'a' });
    const conOrigen = contexto({ phase: 'regroup', selection: { origin: 'a', target: null } });
    expect(resolverClic(conOrigen, 'c')).toEqual({ kind: 'select-target', territory: 'c' });
  });

  it('un destino no alcanzable por territorios propios se rechaza', () => {
    // g es propio pero solo se llega por f, que es de p2: no hay camino.
    const ctx = contexto({ phase: 'regroup', selection: { origin: 'b', target: null } });
    expect(resolverClic(ctx, 'g')).toEqual({ kind: 'invalid', reason: 'not-reachable' });
  });

  it('los alcanzables respetan la conectividad por territorios propios', () => {
    expect([...propiosAlcanzables(contexto({ phase: 'regroup' }), 'a')].sort()).toEqual(['b', 'c']);
  });
});

describe('dadosMaximos', () => {
  it('usa el maximo permitido por la config', () => {
    expect(dadosMaximos(10, DEFAULT_RULES_CONFIG)).toBe(
      DEFAULT_RULES_CONFIG.combat.maxAttackerDice,
    );
  });

  it('nunca pide mas dados de los que los ejercitos permiten', () => {
    expect(dadosMaximos(2, DEFAULT_RULES_CONFIG)).toBe(1);
    expect(dadosMaximos(3, DEFAULT_RULES_CONFIG)).toBe(2);
  });
});
