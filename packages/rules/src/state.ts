/**
 * Estado de partida y armado inicial.
 *
 * `createGameState` es la unica puerta de entrada: reparte los territorios,
 * asigna los objetivos y deja la partida en la fase de despliegue inicial.
 *
 * Reparto inicial (clasico): los territorios se reparten al azar entre los
 * jugadores, cada uno arranca con 1 ejercito, y despues cada jugador coloca su
 * total inicial en rondas: 5 en la primera y 3 en las siguientes
 * (`config.initialPlacement`), hasta agotarlo. Como el total es el mismo para
 * todos, todos terminan de colocar a la vez.
 */

import type { PlayerColorId, PlayerId, RulesConfig } from '@conqueror/shared';

import { buildClassicBoard } from './board.js';
import { buildShuffledDeck } from './cards.js';
import { createObjectiveProvider } from './objectives.js';
import { createRng, shuffle } from './rng.js';
import type {
  Board,
  GameState,
  PlayerState,
  PublicGameState,
  Rng,
  TerritoryState,
} from './types.js';

/** Datos de un jugador para arrancar la partida. */
export interface PlayerSetup {
  readonly id: PlayerId;
  readonly name: string;
  readonly color: PlayerColorId;
}

export interface CreateGameOptions {
  readonly players: readonly PlayerSetup[];
  readonly config: RulesConfig;
  /** Semilla: la partida entera se reproduce con ella. */
  readonly seed: number;
  /** Tablero. Por defecto, el clasico de 50 territorios. */
  readonly board?: Board;
  /** RNG inyectable (tests). Por defecto, uno sembrado con `seed`. */
  readonly rng?: Rng;
}

/** Ejercitos con los que arranca cada territorio recien repartido. */
export const INITIAL_ARMIES_PER_TERRITORY = 1;

/** Cupo de ejercitos que se pueden colocar en una ronda del despliegue. */
export function placementAllowanceForRound(round: number, config: RulesConfig): number {
  return round <= 1 ? config.initialPlacement.firstRound : config.initialPlacement.laterRounds;
}

/** Ejercitos iniciales totales que le tocan a cada jugador. */
export function initialArmiesForPlayerCount(count: number, config: RulesConfig): number {
  return config.initialPlacement.totalByPlayerCount[count] ?? 0;
}

/**
 * Arma una partida nueva.
 *
 * Lanza si la cantidad de jugadores no entra en la config, si hay ids o colores
 * repetidos, o si el tablero no tiene territorios: son errores de armado, no
 * comandos ilegales, y conviene que exploten temprano.
 */
export function createGameState(options: CreateGameOptions): GameState {
  const { players, config, seed } = options;
  const board = options.board ?? buildClassicBoard();

  if (board.territories.length === 0) {
    throw new Error('createGameState: el tablero no tiene territorios');
  }
  if (players.length < config.players.min || players.length > config.players.max) {
    throw new Error(
      `createGameState: se esperan entre ${config.players.min} y ${config.players.max} jugadores (llegaron ${players.length})`,
    );
  }
  if (new Set(players.map((player) => player.id)).size !== players.length) {
    throw new Error('createGameState: hay ids de jugador repetidos');
  }
  if (new Set(players.map((player) => player.color)).size !== players.length) {
    throw new Error('createGameState: hay colores de jugador repetidos');
  }

  const rng = options.rng ?? createRng(seed);

  // --- Reparto de territorios ------------------------------------------------
  const territorios: Record<string, TerritoryState> = {};
  const bolsa = shuffle(board.territories, rng);
  bolsa.forEach((territory, indice) => {
    const dueno = players[indice % players.length] as PlayerSetup;
    territorios[territory] = { owner: dueno.id, armies: INITIAL_ARMIES_PER_TERRITORY };
  });

  const base: GameState = {
    board,
    config,
    seed,
    rngState: rng.snapshot(),
    players: players.map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      cards: [],
      mission: null,
      alive: true,
    })),
    territories: territorios,
    currentPlayer: (players[0] as PlayerSetup).id,
    phase: 'setup-placement',
    turn: 1,
    deck: buildShuffledDeck(board, config, rng),
    discard: [],
    trades: 0,
    armiesToPlace: initialArmiesForPlayerCount(players.length, config),
    placementRound: 1,
    placementRoundAllowance: placementAllowanceForRound(1, config),
    pendingConquest: null,
    regroupMoves: {},
    conqueredThisTurn: false,
    winner: null,
    conqueredTerritories: [],
  };

  // --- Objetivos -------------------------------------------------------------
  const provider = createObjectiveProvider(config.victory.strategy);
  const misiones = provider.assign(base, config, rng);
  const playersConMision: readonly PlayerState[] = base.players.map((player) => ({
    ...player,
    mission: misiones[player.id] ?? null,
  }));

  return { ...base, players: playersConMision, rngState: rng.snapshot() };
}

/**
 * Vista publica del estado: sin tarjetas ni misiones ajenas (ADR 0003). El
 * servidor manda esto y las tarjetas y la mision propia por mensaje privado.
 */
export function publicState(state: GameState, viewerId: PlayerId): PublicGameState {
  const players = state.players.map((player) => {
    let territorios = 0;
    let ejercitos = 0;
    for (const territory of state.board.territories) {
      const estado = state.territories[territory];
      if (estado === undefined || estado.owner !== player.id) continue;
      territorios += 1;
      ejercitos += estado.armies;
    }
    return {
      id: player.id,
      name: player.name,
      color: player.color,
      territories: territorios,
      armies: ejercitos,
      cardCount: player.cards.length,
      eliminated: !player.alive,
    };
  });

  const territorios: Record<string, { owner: string | null; armies: number }> = {};
  for (const territory of state.board.territories) {
    const estado = state.territories[territory];
    territorios[territory] = { owner: estado?.owner ?? null, armies: estado?.armies ?? 0 };
  }

  const propio = state.players.find((player) => player.id === viewerId);

  return {
    phase: state.phase,
    activePlayer: state.currentPlayer,
    turn: state.turn,
    players,
    territories: territorios,
    ownCards: propio?.cards ?? [],
    ownMission: propio?.mission ?? null,
    conquered: state.conqueredTerritories,
    pendingConquest: state.pendingConquest,
    winner: state.winner,
  };
}
