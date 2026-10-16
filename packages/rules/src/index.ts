/**
 * @conqueror/rules
 * Motor de reglas del juego: puro, determinista y sin dependencias de DOM,
 * Three.js, Colyseus ni Node.
 *
 * ESTADO: Hito 0 deja definido el CONTRATO (tipos y firmas). La implementacion
 * completa corresponde al Hito 3. Las funciones marcadas como no implementadas
 * lanzan un error explicito para que nada pase en silencio.
 *
 * Ver docs/adr/0003-motor-de-reglas-puro-y-determinista.md
 */

import type { RulesConfig } from '@conqueror/shared';
import type { TerritoryId } from '@conqueror/shared';

export type {
  CardId,
  CardSymbol,
  ContinentId,
  Locale,
  LocalizedNames,
  PlayerColorId,
  PlayerId,
  RulesConfig,
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
 * Estado de partida. Se completa en el Hito 3.
 * Se declara como tipo abierto para que el contrato ya sea usable por el
 * transporte y el servidor.
 */
export interface GameState {
  readonly phase: Phase;
  readonly seed: number;
}

/** Aplica un comando. No muta el estado de entrada. */
export function apply(
  _state: GameState,
  _command: Command,
  _playerId: string,
  _ctx: ApplyContext,
): Result<{ state: GameState; events: readonly GameEvent[] }, RuleError> {
  throw new Error('apply(): no implementado todavia (Hito 3 - motor de reglas)');
}

/** Comandos legales para un jugador. Lo usan la UI y los bots. */
export function getLegalCommands(_state: GameState, _playerId: string): readonly Command[] {
  throw new Error('getLegalCommands(): no implementado todavia (Hito 3 - motor de reglas)');
}

export * from './compose-squad.js';
