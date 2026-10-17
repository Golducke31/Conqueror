import { describe, expect, it } from 'vitest';

import { createRng, resumeRng, shuffle } from './rng.js';

describe('rng', () => {
  it('la misma semilla da la misma secuencia', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    const serieA = Array.from({ length: 40 }, () => a.rollDie(6));
    const serieB = Array.from({ length: 40 }, () => b.rollDie(6));
    expect(serieA).toEqual(serieB);
  });

  it('semillas distintas dan secuencias distintas', () => {
    const serieDe = (semilla: number): number[] => {
      const rng = createRng(semilla);
      return Array.from({ length: 20 }, () => rng.rollDie(6));
    };
    expect(serieDe(7)).not.toEqual(serieDe(8));
    expect(serieDe(0)).not.toEqual(serieDe(1));

    // Con 40 semillas seguidas, las primeras tiradas no son todas iguales.
    const primeras = Array.from({ length: 40 }, (_, semilla) => createRng(semilla).rollDie(6));
    expect(new Set(primeras).size).toBeGreaterThan(1);
  });

  it('la semilla 0 no degenera', () => {
    const rng = createRng(0);
    const serie = Array.from({ length: 20 }, () => rng.rollDie(6));
    expect(new Set(serie).size).toBeGreaterThan(1);
  });

  it('el dado queda siempre en rango y toca las seis caras', () => {
    const rng = createRng(99);
    const caras = new Set<number>();
    for (let index = 0; index < 6000; index += 1) {
      const valor = rng.rollDie(6);
      expect(valor).toBeGreaterThanOrEqual(1);
      expect(valor).toBeLessThanOrEqual(6);
      caras.add(valor);
    }
    expect([...caras].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('el dado no esta sesgado (tolerancia amplia sobre 6000 tiradas)', () => {
    const rng = createRng(2026);
    const conteo = new Map<number, number>();
    for (let index = 0; index < 6000; index += 1) {
      const valor = rng.rollDie(6);
      conteo.set(valor, (conteo.get(valor) ?? 0) + 1);
    }
    for (const cara of [1, 2, 3, 4, 5, 6]) {
      const veces = conteo.get(cara) ?? 0;
      // Esperado 1000 por cara: se acepta ±25 %.
      expect(veces, `cara ${cara}: ${veces}`).toBeGreaterThan(750);
      expect(veces, `cara ${cara}: ${veces}`).toBeLessThan(1250);
    }
  });

  it('int respeta el rango cerrado', () => {
    const rng = createRng(5);
    const vistos = new Set<number>();
    for (let index = 0; index < 500; index += 1) {
      const valor = rng.int(3, 7);
      expect(valor).toBeGreaterThanOrEqual(3);
      expect(valor).toBeLessThanOrEqual(7);
      vistos.add(valor);
    }
    expect([...vistos].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it('un rango de un solo valor siempre devuelve ese valor', () => {
    const rng = createRng(11);
    for (let index = 0; index < 10; index += 1) expect(rng.int(4, 4)).toBe(4);
  });

  it('reanuda exactamente donde quedo', () => {
    const rng = createRng(4242);
    for (let index = 0; index < 7; index += 1) rng.rollDie(6);

    const estado = rng.snapshot();
    const esperado = Array.from({ length: 10 }, () => rng.rollDie(6));

    const reanudado = resumeRng(estado);
    const obtenido = Array.from({ length: 10 }, () => reanudado.rollDie(6));
    expect(obtenido).toEqual(esperado);
  });

  it('rechaza dados y rangos invalidos', () => {
    const rng = createRng(1);
    expect(() => rng.rollDie(0)).toThrow();
    expect(() => rng.rollDie(1.5)).toThrow();
    expect(() => rng.int(5, 2)).toThrow();
  });

  describe('shuffle', () => {
    it('devuelve una permutacion y no toca la entrada', () => {
      const original = Object.freeze(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
      const copia = [...original];
      const mezclado = shuffle(original, createRng(3));
      expect(original).toEqual(copia);
      expect([...mezclado].sort()).toEqual([...original].sort());
    });

    it('es determinista con la misma semilla', () => {
      const items = Array.from({ length: 20 }, (_, index) => index);
      expect(shuffle(items, createRng(77))).toEqual(shuffle(items, createRng(77)));
    });

    it('cambia el orden de una lista larga', () => {
      const items = Array.from({ length: 50 }, (_, index) => index);
      expect(shuffle(items, createRng(9))).not.toEqual(items);
    });
  });
});
