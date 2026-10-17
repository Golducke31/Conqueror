/**
 * Contrato del motor de reglas: tipos y firmas, sin implementacion.
 *
 * Vive aparte de `index.ts` para que los modulos del motor puedan importarlo sin
 * ciclos: `types.ts` no depende de nada (solo de `@conqueror/shared`), y
 * `index.ts` reexporta todo.
 *
 * Ver docs/adr/0003-motor-de-reglas-puro-y-determinista.md
 */

import type {
  CardId,
  ContinentId,
  PlayerColorId,
  PlayerId,
  RulesConfig,
  SecretMission,
  TerritoryId,
} from '@conqueror/shared';

export type {
  CardId,
  ContinentId,
  Locale,
  LocalizedNames,
  PlayerColorId,
  PlayerId,
  RulesConfig,
  SecretMission,
  TerritoryId,
} from '@conqueror/shared';

/** Fases de un turno. */
export type Phase =
  'setup-placement' | 'reinforce' | 'attack' | 'conquest-move' | 'regroup' | 'game-over';

/** Comandos que un jugador puede enviar. */
export type Command =
  | { readonly type: 'PLACE_ARMIES'; readonly territory: TerritoryId; readonly count: number }
  | { readonly type: 'TRADE_CARDS'; readonly cardIds: readonly [string, string, string] }
  | {
      readonly type: 'ATTACK';
      readonly from: TerritoryId;
      readonly to: TerritoryId;
      readonly dice: 1 | 2 | 3;
    }
  | { readonly type: 'MOVE_AFTER_CONQUEST'; readonly count: number }
  | {
      readonly type: 'REGROUP';
      readonly from: TerritoryId;
      readonly to: TerritoryId;
      readonly count: number;
    }
  | { readonly type: 'END_PHASE' }
  | { readonly type: 'END_TURN' }
  | { readonly type: 'SURRENDER' };

/** Tipos de comando, para validacion en el borde de red. */
export const COMMAND_TYPES = [
  'PLACE_ARMIES',
  'TRADE_CARDS',
  'ATTACK',
  'MOVE_AFTER_CONQUEST',
  'REGROUP',
  'END_PHASE',
  'END_TURN',
  'SURRENDER',
] as const satisfies readonly Command['type'][];

/** Una comparacion de dados, ya resuelta por el motor. */
export interface DiceComparison {
  readonly attackerDie: number;
  readonly defenderDie: number;
  readonly winner: 'attacker' | 'defender';
}

/**
 * Resultado de UNA ronda de combate, ya resuelto.
 *
 * Es el unico insumo del combate visual: la presentacion no decide nada, solo
 * cuenta lo que el motor (local) o el servidor (online) ya resolvieron.
 * Ver docs/adr/0006-combate-visual-no-decide.md
 */
export interface BattleRoundResolved {
  readonly type: 'BATTLE_ROUND_RESOLVED';
  readonly from: TerritoryId;
  readonly to: TerritoryId;
  /** Dados del atacante, de mayor a menor. */
  readonly attackerDice: readonly number[];
  /** Dados del defensor, de mayor a menor. */
  readonly defenderDice: readonly number[];
  readonly comparisons: readonly DiceComparison[];
  readonly attackerLosses: number;
  readonly defenderLosses: number;
  readonly attackerArmiesAfter: number;
  readonly defenderArmiesAfter: number;
}

/** Eventos que la UI usa para animar. No bloquean la logica. */
export type GameEvent =
  | { readonly type: 'ARMIES_PLACED'; readonly territory: TerritoryId; readonly count: number }
  | {
      readonly type: 'ARMIES_MOVED';
      readonly from: TerritoryId;
      readonly to: TerritoryId;
      readonly count: number;
    }
  | BattleRoundResolved
  | {
      readonly type: 'DICE_ROLLED';
      readonly attacker: readonly number[];
      readonly defender: readonly number[];
    }
  | { readonly type: 'TERRITORY_CONQUERED'; readonly territory: TerritoryId }
  | { readonly type: 'CARD_DRAWN'; readonly player: string }
  | { readonly type: 'CARDS_TRADED'; readonly armies: number }
  | { readonly type: 'PLAYER_ELIMINATED'; readonly player: string }
  | { readonly type: 'PHASE_CHANGED'; readonly phase: Phase }
  | { readonly type: 'TURN_CHANGED'; readonly player: string }
  | { readonly type: 'GAME_WON'; readonly player: string };

/** Error de regla, con codigo estable para i18n. */
export interface RuleError {
  readonly code: string;
  readonly message: string;
}

/** Resultado de aplicar un comando. */
export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** Generador pseudoaleatorio inyectable, con semilla. */
export interface Rng {
  /** Entero uniforme en `[1, sides]`, como una tirada de dado. */
  rollDie(sides: number): number;
  /** Entero uniforme en `[min, max]`. */
  int(min: number, max: number): number;
  /** Estado serializable para reproducir la partida. */
  snapshot(): number;
}

/** Contexto de aplicacion de un comando. */
export interface ApplyContext {
  readonly rng: Rng;
  readonly config: RulesConfig;
}

/**
 * Tablero de reglas: lo que el motor necesita saber del mundo.
 *
 * Se arma con `buildClassicBoard()` (o con cualquier otra fuente que respete la
 * forma) y viaja dentro del estado, porque `getLegalCommands(state, playerId)`
 * no recibe contexto y necesita la adyacencia.
 */
export interface Board {
  /** Identificador de la fuente, para rehidratar el tablero al serializar. */
  readonly id: string;
  readonly territories: readonly TerritoryId[];
  readonly neighbors: Readonly<Record<TerritoryId, readonly TerritoryId[]>>;
  readonly continentOf: Readonly<Record<TerritoryId, ContinentId>>;
  readonly continents: readonly ContinentId[];
  readonly territoriesByContinent: Readonly<Record<ContinentId, readonly TerritoryId[]>>;
}

/** Un jugador dentro de la partida. */
export interface PlayerState {
  readonly id: PlayerId;
  readonly name: string;
  readonly color: PlayerColorId;
  /**
   * Tarjetas en mano. En la partida real es informacion privada: el estado
   * publico que se sincroniza solo lleva la cantidad (ADR 0003).
   */
  readonly cards: readonly CardId[];
  /** Mision secreta, o `null` si la partida usa objetivo comun. */
  readonly mission: SecretMission | null;
  /** Sigue en juego. Al quedar sin territorios pasa a `false`. */
  readonly alive: boolean;
}

/** Lo que el estado guarda de cada territorio. */
export interface TerritoryState {
  readonly owner: PlayerId | null;
  readonly armies: number;
}

/** Estado de una partida. Inmutable: cada comando devuelve uno nuevo. */
export interface GameState {
  readonly board: Board;
  /**
   * Reglas con las que se esta jugando.
   *
   * Va en el estado (y no solo en el contexto de `apply`) porque
   * `getLegalCommands(state, playerId)` no recibe contexto y necesita los topes
   * de la config para no hardcodearlos. `apply` la deja siempre igual a la
   * `config` de su contexto: la partida no puede cambiar de reglas a mitad de
   * camino sin querer.
   */
  readonly config: RulesConfig;
  readonly seed: number;
  /** Estado del RNG, para reanudar exactamente donde quedo. */
  readonly rngState: number;
  readonly players: readonly PlayerState[];
  readonly territories: Readonly<Record<TerritoryId, TerritoryState>>;
  readonly currentPlayer: PlayerId;
  readonly phase: Phase;
  /** Ronda de juego (sube cuando vuelve a jugar el primer jugador). */
  readonly turn: number;
  /** Mazo por robar. */
  readonly deck: readonly CardId[];
  /** Descartes: lo que vuelve al mazo cuando se agota. */
  readonly discard: readonly CardId[];
  /** Canjes ya hechos en la partida: escalan el valor del siguiente. */
  readonly trades: number;
  /**
   * Ejercitos que le faltan poner al jugador actual: en el despliegue inicial
   * son los que le tocan en total, y en el refuerzo son los del turno.
   */
  readonly armiesToPlace: number;
  /** Ronda del despliegue inicial (0 cuando ya termino). */
  readonly placementRound: number;
  /**
   * Tope de ejercitos que puede poner en esta ronda del despliegue inicial.
   * En el refuerzo es `null`: no hay tope por ronda.
   */
  readonly placementRoundAllowance: number | null;
  /** Movimiento pendiente tras una conquista. */
  readonly pendingConquest: {
    readonly from: TerritoryId;
    readonly to: TerritoryId;
    readonly min: number;
    readonly max: number;
  } | null;
  /** Movimientos de reagrupe ya usados en el turno, por par origen-destino. */
  readonly regroupMoves: Readonly<Record<string, number>>;
  /** Si el jugador actual ya conquisto algun territorio en este turno. */
  readonly conqueredThisTurn: boolean;
  /** Ganador, si la partida termino. */
  readonly winner: PlayerId | null;
  /** Territorios conquistados en el turno, para animar y para el robo. */
  readonly conqueredTerritories: readonly TerritoryId[];
}

/** Jugador en la vista publica: sin tarjetas ni mision. */
export interface PublicPlayer {
  readonly id: string;
  readonly name: string;
  readonly color: PlayerColorId;
  readonly territories: number;
  readonly armies: number;
  readonly cardCount: number;
  readonly eliminated: boolean;
}

/** Territorio en la vista publica. */
export interface PublicTerritory {
  readonly owner: string | null;
  readonly armies: number;
}

/** Vista publica del estado: nunca incluye tarjetas ni misiones ajenas. */
export interface PublicGameState {
  readonly phase: Phase;
  readonly activePlayer: string;
  readonly turn: number;
  readonly players: readonly PublicPlayer[];
  readonly territories: Readonly<Record<TerritoryId, PublicTerritory>>;
  /** Solo las tarjetas del jugador que mira. Vacio en modo online ajeno. */
  readonly ownCards: readonly CardId[];
  /** Mision del jugador que mira, si la partida usa misiones secretas. */
  readonly ownMission: SecretMission | null;
  /** Territorios conquistados en el turno, para animar. */
  readonly conquered: readonly TerritoryId[];
  readonly pendingConquest: {
    readonly from: TerritoryId;
    readonly to: TerritoryId;
    readonly min: number;
    readonly max: number;
  } | null;
  readonly winner: string | null;
}
