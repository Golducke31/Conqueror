/**
 * Transporte de comandos.
 *
 * La UI habla SIEMPRE contra esta interfaz: no sabe si la partida corre local
 * o en un servidor. Eso permite que el modo hot-seat y el modo online compartan
 * HUD, animaciones y validacion de la UI.
 *
 * Ver docs/adr/0003-motor-de-reglas-puro-y-determinista.md
 */

import type { Command, GameEvent, Phase } from '@conqueror/rules';
import type { PlayerColorId, TerritoryId } from '@conqueror/shared';

/** Cancela una suscripcion. */
export type Unsub = () => void;

/** Vista publica del estado: nunca incluye tarjetas ni misiones ajenas. */
export interface PublicGameState {
  readonly phase: Phase;
  readonly activePlayer: string;
  readonly turn: number;
  readonly players: readonly PublicPlayer[];
  readonly territories: Readonly<Record<TerritoryId, PublicTerritory>>;
  /** Solo las tarjetas del jugador que mira. Vacio en modo online ajeno. */
  readonly ownCards: readonly string[];
}

export interface PublicPlayer {
  readonly id: string;
  readonly name: string;
  readonly color: PlayerColorId;
  readonly territories: number;
  readonly armies: number;
  readonly cardCount: number;
  readonly eliminated: boolean;
}

export interface PublicTerritory {
  readonly owner: string | null;
  readonly armies: number;
}

export interface GameTransport {
  /** Envia un comando. Resuelve cuando el comando fue aceptado. */
  send(command: Command): Promise<void>;
  /** Estado publico actual. */
  getState(): PublicGameState | null;
  /** Notificacion de estado nuevo. */
  onState(callback: (state: PublicGameState) => void): Unsub;
  /** Notificacion de eventos para animar. */
  onEvents(callback: (events: readonly GameEvent[]) => void): Unsub;
  /** Notificacion de errores de regla. */
  onError(callback: (message: string) => void): Unsub;
  /** Libera recursos. */
  dispose(): void;
}

/** Implementacion base con manejo de suscripciones. */
export abstract class BaseTransport implements GameTransport {
  protected readonly stateListeners = new Set<(state: PublicGameState) => void>();
  protected readonly eventListeners = new Set<(events: readonly GameEvent[]) => void>();
  protected readonly errorListeners = new Set<(message: string) => void>();

  protected currentState: PublicGameState | null = null;

  abstract send(command: Command): Promise<void>;

  getState(): PublicGameState | null {
    return this.currentState;
  }

  onState(callback: (state: PublicGameState) => void): Unsub {
    this.stateListeners.add(callback);
    if (this.currentState !== null) callback(this.currentState);
    return () => this.stateListeners.delete(callback);
  }

  onEvents(callback: (events: readonly GameEvent[]) => void): Unsub {
    this.eventListeners.add(callback);
    return () => this.eventListeners.delete(callback);
  }

  onError(callback: (message: string) => void): Unsub {
    this.errorListeners.add(callback);
    return () => this.errorListeners.delete(callback);
  }

  protected emitState(state: PublicGameState): void {
    this.currentState = state;
    for (const listener of this.stateListeners) listener(state);
  }

  protected emitEvents(events: readonly GameEvent[]): void {
    for (const listener of this.eventListeners) listener(events);
  }

  protected emitError(message: string): void {
    for (const listener of this.errorListeners) listener(message);
  }

  dispose(): void {
    this.stateListeners.clear();
    this.eventListeners.clear();
    this.errorListeners.clear();
  }
}
