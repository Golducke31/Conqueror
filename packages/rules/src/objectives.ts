/**
 * Objetivos de victoria.
 *
 * El plan pide una estrategia intercambiable con dos implementaciones:
 *
 *   - `secret-missions`: a cada jugador le toca una mision secreta. Si la mision
 *     es imposible o ya estaba cumplida al repartirla, cae a "conquistar N
 *     territorios".
 *   - `common-objective`: todos juegan a lo mismo (por defecto, conquistar 30
 *     territorios).
 *
 * El mazo de misiones se GENERA a partir del tablero (pares de continentes, un
 * "elimina al color X" por color en juego y un "conquista N territorios"), asi
 * no hay datos del tablero hardcodeados en la config. Si
 * `config.victory.missionDeck` trae misiones, esas mandan.
 */

import type {
  ContinentId,
  PlayerColorId,
  PlayerId,
  RulesConfig,
  SecretMission,
  TerritoryId,
} from '@conqueror/shared';

import { ownerOf, territoryCount } from './queries.js';
import { shuffle } from './rng.js';
import type { GameState, PlayerState, Rng } from './types.js';

/** Como se decide quien gana. */
export type VictoryStrategy = 'secret-missions' | 'common-objective';

export interface ObjectiveProvider {
  readonly strategy: VictoryStrategy;
  /**
   * Misiones que le tocan a cada jugador. Con objetivo comun devuelve `null`
   * para todos: no hay nada secreto que repartir.
   */
  assign(
    state: GameState,
    config: RulesConfig,
    rng: Rng,
  ): Readonly<Record<PlayerId, SecretMission | null>>;
  /** Si el jugador ya cumplio su objetivo. */
  achieved(state: GameState, playerId: PlayerId, config: RulesConfig): boolean;
}

/**
 * Arma el mazo de misiones a partir del tablero y de los jugadores en partida.
 * Es deterministico: mismos datos, mismas misiones.
 */
export function buildMissionDeck(state: GameState, config: RulesConfig): SecretMission[] {
  const misiones: SecretMission[] = [];

  // "Conquistar A y B" para cada par de continentes.
  const continentes = state.board.continents;
  for (let a = 0; a < continentes.length; a += 1) {
    for (let b = a + 1; b < continentes.length; b += 1) {
      const primero = continentes[a] as ContinentId;
      const segundo = continentes[b] as ContinentId;
      misiones.push({
        kind: 'conquer-continents',
        continents: [primero, segundo],
        extraTerritories: 0,
      });
    }
  }

  // "Eliminar al jugador <color>", uno por color presente.
  for (const player of state.players) {
    misiones.push({ kind: 'eliminate-player', targetColor: player.color });
  }

  // "Conquistar N territorios" (el objetivo comun, tambien como mision).
  misiones.push({ kind: 'conquer-territories', count: config.victory.commonObjectiveTerritories });

  return misiones;
}

/**
 * Si una mision se puede cumplir y todavia no esta cumplida. Las que no pasan
 * este filtro caen al objetivo de respaldo.
 */
export function isMissionUsable(
  state: GameState,
  playerId: PlayerId,
  mission: SecretMission,
): boolean {
  switch (mission.kind) {
    case 'eliminate-player': {
      // Necesita que exista un jugador de ese color y que no sea uno mismo.
      const objetivo = state.players.find((player) => player.color === mission.targetColor);
      const propio = state.players.find((player) => player.id === playerId);
      return (
        objetivo !== undefined && objetivo.id !== playerId && propio?.color !== mission.targetColor
      );
    }
    case 'own-territories':
      return !mission.territories.every((territory) => ownerOf(state, territory) === playerId);
    case 'conquer-territories':
      return territoryCount(state, playerId) < mission.count;
    case 'conquer-continents':
      return mission.continents.every(
        (continent) => (state.board.territoriesByContinent[continent] ?? []).length > 0,
      );
    default:
      return true;
  }
}

/** Si el jugador cumple la mision. */
export function missionAchieved(
  state: GameState,
  playerId: PlayerId,
  mission: SecretMission,
): boolean {
  switch (mission.kind) {
    case 'conquer-continents': {
      const continentesOk = mission.continents.every((continent) =>
        (state.board.territoriesByContinent[continent] ?? []).every(
          (territory) => ownerOf(state, territory) === playerId,
        ),
      );
      if (!continentesOk) return false;
      if (mission.extraTerritories <= 0) return true;

      const propiosFuera = state.board.territories.filter(
        (territory) =>
          ownerOf(state, territory) === playerId &&
          !mission.continents.includes(state.board.continentOf[territory] ?? ''),
      );
      return propiosFuera.length >= mission.extraTerritories;
    }
    case 'eliminate-player': {
      const objetivo = state.players.find((player) => player.color === mission.targetColor);
      return objetivo !== undefined && !objetivo.alive;
    }
    case 'conquer-territories':
      return territoryCount(state, playerId) >= mission.count;
    case 'own-territories':
      return mission.territories.every((territory) => ownerOf(state, territory) === playerId);
    default:
      return false;
  }
}

/** Objetivo de respaldo: conquistar N territorios. */
function fallbackMission(config: RulesConfig): SecretMission {
  return { kind: 'conquer-territories', count: config.victory.missionFallbackTerritories };
}

function createSecretMissions(): ObjectiveProvider {
  return {
    strategy: 'secret-missions',
    assign(state, config, rng): Readonly<Record<PlayerId, SecretMission | null>> {
      const mazo =
        config.victory.missionDeck.length > 0
          ? [...config.victory.missionDeck]
          : buildMissionDeck(state, config);
      const mezclado = shuffle(mazo, rng);
      const asignadas: Record<PlayerId, SecretMission | null> = {};

      let cursor = 0;
      for (const player of state.players) {
        let elegida: SecretMission | null = null;
        while (cursor < mezclado.length && elegida === null) {
          const candidata = mezclado[cursor] as SecretMission;
          cursor += 1;
          if (isMissionUsable(state, player.id, candidata)) elegida = candidata;
        }
        // Sin misiones utilizables (o mazo corto): objetivo de respaldo.
        asignadas[player.id] = elegida ?? fallbackMission(config);
      }
      return asignadas;
    },
    achieved(state, playerId, config): boolean {
      const player = state.players.find((candidato) => candidato.id === playerId);
      if (player === undefined) return false;
      if (player.mission === null) {
        return territoryCount(state, playerId) >= config.victory.commonObjectiveTerritories;
      }
      return missionAchieved(state, playerId, player.mission);
    },
  };
}

function createCommonObjective(): ObjectiveProvider {
  return {
    strategy: 'common-objective',
    assign(state): Readonly<Record<PlayerId, SecretMission | null>> {
      const asignadas: Record<PlayerId, SecretMission | null> = {};
      for (const player of state.players) asignadas[player.id] = null;
      return asignadas;
    },
    achieved(state, playerId, config): boolean {
      return territoryCount(state, playerId) >= config.victory.commonObjectiveTerritories;
    },
  };
}

/** Proveedor de objetivos segun la estrategia configurada. */
export function createObjectiveProvider(strategy: VictoryStrategy): ObjectiveProvider {
  return strategy === 'common-objective' ? createCommonObjective() : createSecretMissions();
}

/** Texto legible de una mision, para el HUD y los tests. */
export function describeMission(
  mission: SecretMission,
  names: Readonly<Record<string, string>>,
): string {
  switch (mission.kind) {
    case 'conquer-continents': {
      const continentes = mission.continents.map((continent) => names[continent] ?? continent);
      const extra =
        mission.extraTerritories > 0 ? ` y ${mission.extraTerritories} territorios mas` : '';
      return `Conquistar ${continentes.join(' y ')}${extra}`;
    }
    case 'eliminate-player':
      return `Eliminar al jugador ${names[mission.targetColor] ?? mission.targetColor}`;
    case 'conquer-territories':
      return `Conquistar ${mission.count} territorios`;
    case 'own-territories':
      return `Ocupar ${mission.territories.map((territory) => names[territory] ?? territory).join(', ')}`;
    default:
      return 'Mision desconocida';
  }
}

/** Color de un jugador, para los mensajes de mision. */
export function colorOf(state: GameState, playerId: PlayerId): PlayerColorId | null {
  return state.players.find((player) => player.id === playerId)?.color ?? null;
}

/** Territorios de un continente, para los mensajes de mision. */
export function continentTerritories(
  state: GameState,
  continent: ContinentId,
): readonly TerritoryId[] {
  return state.board.territoriesByContinent[continent] ?? [];
}

/** Jugadores con mision asignada, para el HUD. */
export function playersWithMissions(state: GameState): readonly PlayerState[] {
  return state.players.filter((player) => player.mission !== null);
}
