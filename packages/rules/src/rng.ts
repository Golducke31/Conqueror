/**
 * Generador pseudoaleatorio inyectable.
 *
 * El motor NUNCA llama a `Math.random()`: el azar entra por aca, con semilla, y
 * se puede serializar. Eso es lo que permite reproducir una partida entera con
 * `(semilla, lista de comandos)` y hace que los tests de combate sean estables
 * (ADR 0003).
 *
 * Algoritmo: mulberry32. Tiene 32 bits de estado, pasa los tests de uniformidad
 * que necesitamos para dados y es trivial de portar y de serializar.
 */

import type { Rng } from './types.js';

/** Generador con estado interno. */
class SeededRng implements Rng {
  private state: number;

  constructor(state: number) {
    // El estado 0 degenera en mulberry32: se corre a un valor equivalente.
    this.state = state >>> 0 || 0x9e3779b9;
  }

  /** Siguiente float uniforme en `[0, 1)`. */
  private next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  rollDie(sides: number): number {
    if (!Number.isInteger(sides) || sides < 1) {
      throw new Error(`rollDie: lados invalidos (${sides})`);
    }
    return 1 + Math.floor(this.next() * sides);
  }

  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new Error(`int: rango invalido (${min}, ${max})`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  snapshot(): number {
    return this.state >>> 0;
  }
}

/** Crea un generador a partir de una semilla. */
export function createRng(seed: number): Rng {
  return new SeededRng(seed);
}

/** Reanuda un generador desde el estado que devolvio `snapshot()`. */
export function resumeRng(state: number): Rng {
  return new SeededRng(state);
}

/**
 * Copia mezclada de una lista (Fisher-Yates). No muta la entrada: el motor es
 * puro y el estado que recibe nunca se toca.
 */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const copia = [...items];
  for (let index = copia.length - 1; index > 0; index -= 1) {
    const otro = rng.int(0, index);
    const temporal = copia[index] as T;
    copia[index] = copia[otro] as T;
    copia[otro] = temporal;
  }
  return copia;
}
