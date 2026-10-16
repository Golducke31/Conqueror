/**
 * Datos de prueba.
 *
 * El Hito 2 del plan maestro pide "fichas instanciadas con datos de prueba": el
 * motor de reglas recien llega en el Hito 3. Este modulo genera una partida
 * creible y DETERMINISTA (semilla fija) para poder mirar el tablero con duenos y
 * ejércitos reales.
 *
 * Los territorios se reparten por crecimiento desde una semilla, no al azar
 * suelto: asi los dominios quedan en manchas contiguas y el mapa se parece a una
 * partida de verdad.
 */

import type { PlayerColorId, TerritoryId } from '@conqueror/shared';
import { PLAYER_COLOR_ORDER } from '@conqueror/shared';

/** Generador determinista (mulberry32). */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MockPlayer {
  readonly id: string;
  readonly name: string;
  readonly color: PlayerColorId;
}

export interface MockTerritoryState {
  readonly owner: string | null;
  readonly armies: number;
}

export interface MockGameState {
  readonly seed: number;
  readonly players: readonly MockPlayer[];
  readonly activePlayer: string;
  readonly territories: Readonly<Record<TerritoryId, MockTerritoryState>>;
}

export interface CreateMockStateOptions {
  readonly territoryIds: readonly TerritoryId[];
  readonly neighbors: Readonly<Record<TerritoryId, readonly TerritoryId[]>>;
  readonly playerCount: number;
  readonly seed: number;
}

const NOMBRES = ['Rojo', 'Azul', 'Amarillo', 'Verde', 'Negro', 'Magenta'];

/** Reparte los territorios por crecimiento desde una semilla por jugador. */
function distribute(
  territoryIds: readonly TerritoryId[],
  neighbors: Readonly<Record<TerritoryId, readonly TerritoryId[]>>,
  playerCount: number,
  random: () => number,
): Map<TerritoryId, string> {
  const owners = new Map<TerritoryId, string>();
  const players = Array.from({ length: playerCount }, (_, index) => `p${index + 1}`);
  const available = [...territoryIds];

  // Semillas: bien separadas entre si, tomadas al azar.
  for (const player of players) {
    const candidates = available.filter((id) => !owners.has(id));
    if (candidates.length === 0) break;
    const choice = candidates[Math.floor(random() * candidates.length)];
    if (choice === undefined) break;
    owners.set(choice, player);
  }

  let unowned = territoryIds.filter((id) => !owners.has(id));
  let guard = 0;

  while (unowned.length > 0 && guard < 10_000) {
    guard += 1;
    let progressed = false;

    for (const player of players) {
      const frontier = unowned.filter((id) =>
        (neighbors[id] ?? []).some((neighbor) => owners.get(neighbor) === player),
      );

      if (frontier.length === 0) continue;
      const choice = frontier[Math.floor(random() * frontier.length)];
      if (choice === undefined) continue;
      owners.set(choice, player);
      progressed = true;
    }

    unowned = territoryIds.filter((id) => !owners.has(id));

    // Si nadie pudo crecer (territorios aislados), se reparten al azar.
    if (!progressed) {
      for (const id of unowned) {
        const player = players[Math.floor(random() * players.length)] ?? 'p1';
        owners.set(id, player);
      }
      unowned = [];
    }
  }

  return owners;
}

/** Arma una partida de prueba determinista. */
export function createMockGameState(options: CreateMockStateOptions): MockGameState {
  const random = createSeededRandom(options.seed);
  const playerCount = Math.max(2, Math.min(6, options.playerCount));

  const players: MockPlayer[] = Array.from({ length: playerCount }, (_, index) => ({
    id: `p${index + 1}`,
    name: NOMBRES[index] ?? `Jugador ${index + 1}`,
    color: PLAYER_COLOR_ORDER[index] ?? 'rojo',
  }));

  const owners = distribute(options.territoryIds, options.neighbors, playerCount, random);

  const territories: Record<TerritoryId, MockTerritoryState> = {};
  for (const id of options.territoryIds) {
    const owner = owners.get(id) ?? null;
    territories[id] = {
      owner,
      armies: owner === null ? 0 : 1 + Math.floor(random() * 12),
    };
  }

  // Un par de territorios con guarnicion grande, para ver los tres niveles de
  // unidad (artilleria, caballeria, infanteria) en el mapa.
  const richest = [...options.territoryIds].slice(0, 3);
  richest.forEach((id, index) => {
    const state = territories[id];
    if (state === undefined) return;
    territories[id] = { ...state, armies: [23, 10, 7][index] ?? state.armies };
  });

  return {
    seed: options.seed,
    players,
    activePlayer: players[0]?.id ?? 'p1',
    territories,
  };
}
