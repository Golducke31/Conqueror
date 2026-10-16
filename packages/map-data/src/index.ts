/**
 * @conqueror/map-data
 * Tipos del tablero, matriz clasica de adyacencia y constantes.
 *
 * Este paquete es PURO: no importa `three`, DOM, Colyseus ni `node:*`.
 * Los artefactos generados (`territories.json`, `adjacency.json`,
 * `territories.topojson.json`) los produce `scripts/build-map.ts` en
 * `generated/` y se sirven como assets estaticos.
 */

export * from './types.js';
export * from './classic-board.js';

/** Nombre del archivo TopoJSON servido al cliente. */
export const TERRITORIES_TOPOLOGY_FILE = 'territories.topojson.json';

/** Nombre del archivo con la geometria resumida. */
export const TERRITORIES_INDEX_FILE = 'territories.json';

/** Nombre del archivo con el grafo de adyacencia. */
export const ADJACENCY_FILE = 'adjacency.json';

/** Nombre del archivo con las anclas de frente. */
export const FRONTS_FILE = 'fronts.json';
