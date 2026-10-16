/**
 * Carga de los artefactos del tablero.
 *
 * Los archivos los genera `pnpm map:build` y se sirven como assets estaticos
 * desde `/map/`. Se cargan de forma diferida al entrar a la partida: no entran
 * al bundle inicial.
 */

import {
  ADJACENCY_FILE,
  FRONTS_FILE,
  TERRITORIES_INDEX_FILE,
  TERRITORIES_TOPOLOGY_FILE,
  pairKey,
} from '@conqueror/map-data';
import type {
  AdjacencyFile,
  FrontAnchor,
  FrontsFile,
  TerritoriesFile,
  TerritoryGeometry,
} from '@conqueror/map-data';

/** Ruta base de los artefactos. */
export const MAP_ASSET_BASE = '/map';

export interface LoadedMapData {
  /** Topologia con los 50 territorios. */
  readonly topology: unknown;
  /** Nombre del objeto dentro de la topologia. */
  readonly objectName: string;
  readonly territories: TerritoriesFile;
  readonly adjacency: AdjacencyFile;
  readonly fronts: FrontsFile;
  readonly byId: ReadonlyMap<string, TerritoryGeometry>;
  /** Ancla de frente por par normalizado `a|b`. */
  readonly frontByPair: ReadonlyMap<string, FrontAnchor>;
}

async function readJson<T>(base: string, file: string): Promise<T> {
  const response = await fetch(`${base}/${file}`);
  if (!response.ok) {
    throw new Error(`No se pudo cargar ${file}: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function loadMapData(base: string = MAP_ASSET_BASE): Promise<LoadedMapData> {
  const [topology, territories, adjacency, fronts] = await Promise.all([
    readJson<unknown>(base, TERRITORIES_TOPOLOGY_FILE),
    readJson<TerritoriesFile>(base, TERRITORIES_INDEX_FILE),
    readJson<AdjacencyFile>(base, ADJACENCY_FILE),
    readJson<FrontsFile>(base, FRONTS_FILE),
  ]);

  return {
    topology,
    objectName: 'territories',
    territories,
    adjacency,
    fronts,
    byId: new Map(territories.territories.map((territory) => [territory.id, territory])),
    frontByPair: new Map(fronts.fronts.map((front) => [pairKey(front.a, front.b), front])),
  };
}

/** Ancla de frente entre dos territorios, en cualquier orden. */
export function frontBetween(data: LoadedMapData, a: string, b: string): FrontAnchor | undefined {
  return data.frontByPair.get(pairKey(a, b));
}
