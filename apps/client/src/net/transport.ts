/**
 * Transporte de comandos.
 *
 * La UI habla SIEMPRE contra esta interfaz: no sabe si la partida corre local
 * o en un servidor. Eso permite que el modo hot-seat y el modo online compartan
 * HUD, animaciones y validacion de la UI.
 *
 * `PublicGameState`, `PublicPlayer` y `PublicTerritory` vienen de
 * `@conqueror/rules`: son la vista publica que define el motor, y el estado que
 * el servidor difundiria en el modo online (Hito 6). El transporte local la
 * produce con la misma funcion (`publicState`), asi que no hay dos definiciones
 * de lo mismo.
 *
 * Ver docs/adr/0003-motor-de-reglas-puro-y-determinista.md
 */

import type { Command, GameEvent, PublicGameState } from '@conqueror/rules';

export type { PublicGameState, PublicPlayer, PublicTerritory } from '@conqueror/rules';

/** Cancela una suscripcion. */
export type Unsub = () => void;

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
