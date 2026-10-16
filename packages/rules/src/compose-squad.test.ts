import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SQUAD_TIERS,
  composeSquad,
  squadUnitCount,
  type SquadComposition,
} from './compose-squad.js';

/** Escritorio y movil, los dos topes del plan. */
const DESKTOP = 16;
const MOBILE = 8;

/** "10A+1C" -> legible en la tabla de tests. */
function describeComposition(composition: SquadComposition): string {
  const letra: Record<string, string> = { artillery: 'A', cavalry: 'C', infantry: 'I' };
  const partes = composition.units.map((unit) => `${unit.count}${letra[unit.type] ?? '?'}`);
  const cuerpo = partes.length > 0 ? partes.join('+') : '-';
  return composition.k === 1 ? cuerpo : `${cuerpo} x${composition.k}`;
}

describe('composeSquad — tabla', () => {
  const casos: readonly (readonly [number, string, number])[] = [
    // ejércitos, composición esperada en escritorio (maxUnits 16), unidades
    [0, '-', 0],
    [1, '1I', 1],
    [2, '2I', 2],
    [4, '4I', 4],
    [5, '1C', 1],
    [6, '1C+1I', 2],
    [7, '1C+2I', 3],
    [9, '1C+4I', 5],
    [10, '1A', 1],
    [14, '1A+4I', 5],
    [16, '1A+1C+1I', 3],
    [23, '2A+3I', 5],
    [64, '6A+4I', 10],
  ];

  for (const [armies, esperado, unidades] of casos) {
    it(`${armies} ejercitos -> ${esperado}`, () => {
      const composition = composeSquad(armies, { maxUnits: DESKTOP });
      expect(describeComposition(composition)).toBe(esperado);
      expect(squadUnitCount(composition)).toBe(unidades);
      expect(composition.k).toBe(1);
    });
  }

  it('respeta el tope de unidades y sube k cuando hace falta', () => {
    const composition = composeSquad(400, { maxUnits: DESKTOP });
    expect(squadUnitCount(composition)).toBeLessThanOrEqual(DESKTOP);
    expect(composition.k).toBeGreaterThan(1);
  });

  it('en movil el tope es mas chico y k mas grande', () => {
    const desktop = composeSquad(400, { maxUnits: DESKTOP });
    const mobile = composeSquad(400, { maxUnits: MOBILE });
    expect(squadUnitCount(mobile)).toBeLessThanOrEqual(MOBILE);
    expect(mobile.k).toBeGreaterThanOrEqual(desktop.k);
  });

  it('los casos 7, 23 y 64 que pide el plan', () => {
    for (const armies of [7, 23, 64]) {
      for (const maxUnits of [DESKTOP, MOBILE]) {
        const composition = composeSquad(armies, { maxUnits });
        expect(squadUnitCount(composition)).toBeLessThanOrEqual(maxUnits);
        expect(composition.representedArmies).toBe(armies);
      }
    }
    // Con 16 unidades de tope, los tres entran con k = 1.
    expect(composeSquad(7, { maxUnits: DESKTOP }).k).toBe(1);
    expect(composeSquad(23, { maxUnits: DESKTOP }).k).toBe(1);
    expect(composeSquad(64, { maxUnits: DESKTOP }).k).toBe(1);
    // En movil, 64 ejércitos no entran: cada unidad pasa a valer 2.
    expect(composeSquad(64, { maxUnits: MOBILE }).k).toBe(2);
  });

  it('rechaza un tope invalido', () => {
    expect(() => composeSquad(10, { maxUnits: 0 })).toThrow();
  });

  it('rechaza niveles sin unidad de valor 1', () => {
    expect(() =>
      composeSquad(10, { maxUnits: DESKTOP, tiers: [{ type: 'artillery', armies: 10 }] }),
    ).toThrow();
  });

  it('acepta niveles alternativos', () => {
    const composition = composeSquad(12, {
      maxUnits: DESKTOP,
      tiers: [
        { type: 'artillery', armies: 6 },
        { type: 'infantry', armies: 1 },
      ],
    });
    expect(describeComposition(composition)).toBe('2A');
  });
});

describe('composeSquad — propiedades', () => {
  const armiesArb = fc.integer({ min: 0, max: 5000 });
  const maxUnitsArb = fc.integer({ min: 1, max: 24 });

  it('nunca supera maxUnits', () => {
    fc.assert(
      fc.property(armiesArb, maxUnitsArb, (armies, maxUnits) => {
        expect(squadUnitCount(composeSquad(armies, { maxUnits }))).toBeLessThanOrEqual(maxUnits);
      }),
      { numRuns: 300 },
    );
  });

  it('k siempre es al menos 1', () => {
    fc.assert(
      fc.property(armiesArb, maxUnitsArb, (armies, maxUnits) => {
        expect(composeSquad(armies, { maxUnits }).k).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 300 },
    );
  });

  it('representa al menos los ejercitos pedidos, con excedente menor que k', () => {
    fc.assert(
      fc.property(armiesArb, maxUnitsArb, (armies, maxUnits) => {
        const composition = composeSquad(armies, { maxUnits });
        expect(composition.representedArmies).toBeGreaterThanOrEqual(armies);
        expect(composition.representedArmies - armies).toBeLessThan(composition.k);
      }),
      { numRuns: 300 },
    );
  });

  it('con 0 ejercitos no hay unidades', () => {
    fc.assert(
      fc.property(maxUnitsArb, (maxUnits) => {
        const composition = composeSquad(0, { maxUnits });
        expect(composition.units).toEqual([]);
        expect(composition.k).toBe(1);
        expect(composition.representedArmies).toBe(0);
      }),
      { numRuns: 50 },
    );
  });

  it('agregar un ejercito nunca reduce lo representado', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2000 }), maxUnitsArb, (armies, maxUnits) => {
        const menor = composeSquad(armies, { maxUnits });
        const mayor = composeSquad(armies + 1, { maxUnits });
        expect(mayor.representedArmies).toBeGreaterThanOrEqual(menor.representedArmies);
      }),
      { numRuns: 300 },
    );
  });

  it('es determinista', () => {
    fc.assert(
      fc.property(armiesArb, maxUnitsArb, (armies, maxUnits) => {
        expect(composeSquad(armies, { maxUnits })).toEqual(composeSquad(armies, { maxUnits }));
      }),
      { numRuns: 100 },
    );
  });

  it('los niveles por defecto son los del plan', () => {
    expect(DEFAULT_SQUAD_TIERS).toEqual([
      { type: 'artillery', armies: 10 },
      { type: 'cavalry', armies: 5 },
      { type: 'infantry', armies: 1 },
    ]);
  });
});
