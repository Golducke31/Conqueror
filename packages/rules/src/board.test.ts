import { describe, expect, it } from 'vitest';

import {
  buildClassicBoard,
  isAdjacent,
  neighborsOf,
  territoriesOf,
  CLASSIC_BOARD_ID,
} from './board.js';

const board = buildClassicBoard();

describe('tablero clasico', () => {
  it('tiene los 50 territorios del tablero', () => {
    expect(board.territories).toHaveLength(50);
    expect(board.id).toBe(CLASSIC_BOARD_ID);
  });

  it('tiene los seis continentes con sus territorios', () => {
    expect(board.continents).toHaveLength(6);
    const total = board.continents.reduce(
      (sum, continent) => sum + territoriesOf(board, continent).length,
      0,
    );
    expect(total).toBe(50);
  });

  it('la adyacencia es simetrica', () => {
    for (const territory of board.territories) {
      for (const neighbor of neighborsOf(board, territory)) {
        expect(
          isAdjacent(board, neighbor, territory),
          `${territory} → ${neighbor} sin vuelta`,
        ).toBe(true);
      }
    }
  });

  it('no hay territorios aislados ni vecinos de si mismos', () => {
    for (const territory of board.territories) {
      const vecinos = neighborsOf(board, territory);
      expect(vecinos.length, `${territory} sin vecinos`).toBeGreaterThan(0);
      expect(vecinos).not.toContain(territory);
    }
  });

  it('todos los vecinos son territorios del tablero', () => {
    const conocidos = new Set(board.territories);
    for (const territory of board.territories) {
      for (const neighbor of neighborsOf(board, territory)) {
        expect(conocidos.has(neighbor), `${neighbor} no es un territorio`).toBe(true);
      }
    }
  });

  it('el grafo es conexo', () => {
    const vistos = new Set<string>([board.territories[0] as string]);
    const cola = [board.territories[0] as string];
    while (cola.length > 0) {
      const actual = cola.shift() as string;
      for (const vecino of neighborsOf(board, actual)) {
        if (vistos.has(vecino)) continue;
        vistos.add(vecino);
        cola.push(vecino);
      }
    }
    expect(vistos.size).toBe(50);
  });

  it('cada territorio tiene un continente declarado', () => {
    for (const territory of board.territories) {
      expect(board.continents).toContain(board.continentOf[territory]);
    }
  });

  it('devuelve siempre la misma instancia (tablero inmutable)', () => {
    expect(buildClassicBoard()).toBe(board);
  });

  it('un territorio desconocido no tiene vecinos', () => {
    expect(neighborsOf(board, 'atlantida')).toEqual([]);
    expect(isAdjacent(board, 'atlantida', 'brasil')).toBe(false);
  });
});
