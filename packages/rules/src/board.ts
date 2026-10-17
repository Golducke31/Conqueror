/**
 * Tablero de reglas.
 *
 * El motor no hardcodea el mundo: recibe un `Board`. Este modulo arma el
 * tablero clasico de 50 territorios a partir de la matriz de `@conqueror/map-data`,
 * que es la autoridad de la adyacencia (el mapa renderizado y el grafo de reglas
 * no pueden divergir: `validate-map` falla el build si divergen).
 *
 * La adyacencia se simetriza y se ordena aca, para que el motor no tenga que
 * confiar en como este declarada la matriz.
 */

import {
  CLASSIC_BOARD_CONTINENTS,
  CLASSIC_BOARD_NEIGHBORS,
  CLASSIC_BOARD_TERRITORIES_BY_CONTINENT,
  CONTINENT_ORDER,
  classicBoardEdges,
  edgesToNeighbors,
} from '@conqueror/map-data';
import type { ContinentId, TerritoryId } from '@conqueror/shared';

import type { Board } from './types.js';

/** Identificador del tablero clasico, para rehidratar al serializar. */
export const CLASSIC_BOARD_ID = 'classic-50';

let cacheClasico: Board | null = null;

/** Arma el tablero clasico de 50 territorios y 6 continentes. */
export function buildClassicBoard(): Board {
  if (cacheClasico !== null) return cacheClasico;

  const neighbors = edgesToNeighbors(classicBoardEdges());
  const continentOf: Record<TerritoryId, ContinentId> = {};
  for (const [territory, continent] of Object.entries(CLASSIC_BOARD_CONTINENTS)) {
    continentOf[territory] = continent;
  }

  const territoriesByContinent: Record<ContinentId, readonly TerritoryId[]> = {};
  for (const continent of CONTINENT_ORDER) {
    territoriesByContinent[continent] = [
      ...(CLASSIC_BOARD_TERRITORIES_BY_CONTINENT[continent] ?? []),
    ];
  }

  cacheClasico = {
    id: CLASSIC_BOARD_ID,
    territories: Object.keys(CLASSIC_BOARD_NEIGHBORS),
    neighbors,
    continentOf,
    continents: [...CONTINENT_ORDER],
    territoriesByContinent,
  };
  return cacheClasico;
}

/** Vecinos de un territorio. Vacio si el territorio no existe. */
export function neighborsOf(board: Board, territory: TerritoryId): readonly TerritoryId[] {
  return board.neighbors[territory] ?? [];
}

/** Si dos territorios son adyacentes (en cualquier sentido). */
export function isAdjacent(board: Board, from: TerritoryId, to: TerritoryId): boolean {
  return neighborsOf(board, from).includes(to);
}

/** Territorios de un continente. */
export function territoriesOf(board: Board, continent: ContinentId): readonly TerritoryId[] {
  return board.territoriesByContinent[continent] ?? [];
}
