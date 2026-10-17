/**
 * Consultas puras sobre el estado.
 *
 * Son las preguntas que se hacen el motor, los objetivos y la UI ("¿cuantos
 * territorios tiene?", "¿domina este continente?", "¿cuantos refuerzos le
 * tocan?"). Ninguna muta nada: reciben el estado y devuelven un valor.
 */

import type { ContinentId, PlayerId, RulesConfig, TerritoryId } from '@conqueror/shared';

import { neighborsOf } from './board.js';
import type { GameState, PlayerState, TerritoryState } from './types.js';

/** Jugador por id, o `undefined` si no esta en la partida. */
export function playerOf(state: GameState, playerId: PlayerId): PlayerState | undefined {
  return state.players.find((player) => player.id === playerId);
}

/** Estado de un territorio, o `undefined` si el id no existe. */
export function territoryOf(state: GameState, territory: TerritoryId): TerritoryState | undefined {
  return state.territories[territory];
}

/** Dueno de un territorio (`null` si no tiene). */
export function ownerOf(state: GameState, territory: TerritoryId): PlayerId | null {
  return state.territories[territory]?.owner ?? null;
}

/** Ejercitos de un territorio. */
export function armiesOf(state: GameState, territory: TerritoryId): number {
  return state.territories[territory]?.armies ?? 0;
}

/** Territorios de un jugador, en el orden del tablero. */
export function territoriesOfPlayer(state: GameState, playerId: PlayerId): readonly TerritoryId[] {
  return state.board.territories.filter((territory) => ownerOf(state, territory) === playerId);
}

/** Cuantos territorios tiene un jugador. */
export function territoryCount(state: GameState, playerId: PlayerId): number {
  return territoriesOfPlayer(state, playerId).length;
}

/** Cuantos ejercitos tiene un jugador en total. */
export function armyCount(state: GameState, playerId: PlayerId): number {
  let total = 0;
  for (const territory of state.board.territories) {
    if (ownerOf(state, territory) === playerId) total += armiesOf(state, territory);
  }
  return total;
}

/** Ejercitos totales en el tablero (para los tests de conservacion). */
export function totalArmies(state: GameState): number {
  let total = 0;
  for (const territory of state.board.territories) total += armiesOf(state, territory);
  return total;
}

/** Jugadores que siguen en juego, en orden de turno. */
export function alivePlayers(state: GameState): readonly PlayerState[] {
  return state.players.filter((player) => player.alive);
}

/** Continentes que domina un jugador (todos sus territorios son suyos). */
export function ownedContinents(state: GameState, playerId: PlayerId): readonly ContinentId[] {
  return state.board.continents.filter((continent) => {
    const territorios = state.board.territoriesByContinent[continent] ?? [];
    return (
      territorios.length > 0 &&
      territorios.every((territory) => ownerOf(state, territory) === playerId)
    );
  });
}

/** Bonus por continentes dominados. */
export function continentBonus(state: GameState, playerId: PlayerId, config: RulesConfig): number {
  return ownedContinents(state, playerId).reduce(
    (total, continent) => total + (config.continentBonuses[continent] ?? 0),
    0,
  );
}

/**
 * Refuerzos del turno: `max(minimo, floor(territorios / divisor))` mas los bonos
 * por continente completo. Todo sale de `RulesConfig`.
 */
export function reinforcementsFor(
  state: GameState,
  playerId: PlayerId,
  config: RulesConfig,
): number {
  const territorios = territoryCount(state, playerId);
  const base = Math.max(
    config.reinforcement.minimum,
    Math.floor(territorios / config.reinforcement.divisor),
  );
  return base + continentBonus(state, playerId, config);
}

/**
 * Vecinos de un territorio que pertenecen a otro jugador (o a nadie): los
 * candidatos a ataque.
 */
export function enemyNeighbors(
  state: GameState,
  playerId: PlayerId,
  territory: TerritoryId,
): readonly TerritoryId[] {
  return neighborsOf(state.board, territory).filter(
    (vecino) => ownerOf(state, vecino) !== playerId,
  );
}

/** Vecinos de un territorio que son del mismo jugador. */
export function ownNeighbors(
  state: GameState,
  playerId: PlayerId,
  territory: TerritoryId,
): readonly TerritoryId[] {
  return neighborsOf(state.board, territory).filter(
    (vecino) => ownerOf(state, vecino) === playerId,
  );
}

/**
 * Si `to` es alcanzable desde `from` moviendose solo por territorios propios.
 * Lo usa el reagrupe (`config.regroup.requireOwnPath`).
 */
export function hasOwnPath(
  state: GameState,
  playerId: PlayerId,
  from: TerritoryId,
  to: TerritoryId,
): boolean {
  if (from === to) return true;
  if (ownerOf(state, from) !== playerId || ownerOf(state, to) !== playerId) return false;

  const vistos = new Set<TerritoryId>([from]);
  const cola: TerritoryId[] = [from];
  while (cola.length > 0) {
    const actual = cola.shift() as TerritoryId;
    for (const vecino of neighborsOf(state.board, actual)) {
      if (vistos.has(vecino) || ownerOf(state, vecino) !== playerId) continue;
      if (vecino === to) return true;
      vistos.add(vecino);
      cola.push(vecino);
    }
  }
  return false;
}

/** El siguiente jugador vivo despues de `playerId`, en orden de turno. */
export function nextAlivePlayer(state: GameState, playerId: PlayerId): PlayerId {
  const orden = state.players;
  const indice = orden.findIndex((player) => player.id === playerId);
  if (indice < 0) return state.players[0]?.id ?? playerId;

  for (let paso = 1; paso <= orden.length; paso += 1) {
    const candidato = orden[(indice + paso) % orden.length];
    if (candidato !== undefined && candidato.alive) return candidato.id;
  }
  return playerId;
}

/** Clave estable para contar movimientos de reagrupe por par origen-destino. */
export function regroupKey(from: TerritoryId, to: TerritoryId): string {
  return `${from}>${to}`;
}

/** Cuantos territorios del tablero siguen sin dueno. */
export function unownedCount(state: GameState): number {
  return state.board.territories.filter((territory) => ownerOf(state, territory) === null).length;
}
