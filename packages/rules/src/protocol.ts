/**
 * Protocolo del modo online (Hito 6).
 *
 * El servidor es autoritativo: corre el motor completo (tarjetas y misiones
 * incluidas) y a cada cliente le manda SOLO su vista publica filtrada
 * (`publicState(state, viewerId)`). Los tipos del estado ya son JSON plano,
 * asi que el cable no necesita esquemas duplicados: `colyseus.js` decodifica y
 * `zod` valida el sobre entrante. El motor es el validador real de comandos
 * (`apply` rechaza lo ilegal con su mensaje).
 *
 * Ver docs/adr/0016-modo-online.md
 */

import type { GameSpec } from './core.js';
import type { Command, GameEvent, PublicGameState } from './types.js';

/** Asiento de un jugador en la sala (visible para todos; sin datos privados). */
export interface SeatInfo {
  readonly playerId: string;
  readonly name: string;
  readonly connected: boolean;
  readonly bot: boolean;
  readonly host: boolean;
}

/** Lo que el servidor manda al entrar (o al reconectar) a una sala. */
export interface Welcome {
  /** Con que jugador de la partida se identifica este cliente. */
  readonly playerId: string;
  /** Codigo de sala. */
  readonly roomId: string;
  /** Especificacion con la que se armo (o se armara) la partida. */
  readonly spec: GameSpec;
  /** Estado publico del espectador. `null` hasta que el host arranca. */
  readonly state: PublicGameState | null;
  /** Asientos actuales, para el lobby. */
  readonly seats: readonly SeatInfo[];
}

/** Cliente -> servidor. */
export type ClientMessage =
  /** El host arma la partida (jugadores de los asientos + bots). */
  | { readonly kind: 'configure'; readonly spec: GameSpec }
  /** Comando de juego: el servidor valida turno y legalidad. */
  | { readonly kind: 'command'; readonly id: number; readonly command: Command };

/** Servidor -> cliente. */
export type ServerMessage =
  /** Bienvenida (entrar o reconectar). */
  | { readonly kind: 'welcome'; readonly welcome: Welcome }
  /**
   * Comando aceptado: va solo al emisor, con su vista y los eventos para
   * animar (el HUD y el director no cambian segun el modo).
   */
  | {
      readonly kind: 'applied';
      readonly id: number;
      readonly state: PublicGameState;
      readonly events: readonly GameEvent[];
    }
  /** Comando rechazado por el motor: solo al emisor. */
  | {
      readonly kind: 'rejected';
      readonly id: number;
      readonly code: string;
      readonly message: string;
    }
  /** Cambio de estado que no viene de este cliente (bot o turno ajeno). */
  | { readonly kind: 'state'; readonly state: PublicGameState }
  /** Eventos del paso anterior (misma jugada, dibujados por el director). */
  | { readonly kind: 'events'; readonly events: readonly GameEvent[] }
  /** Asientos de la sala (solo lobby): para esperar a los jugadores. */
  | {
      readonly kind: 'seats';
      readonly fase: 'lobby' | 'playing' | 'over';
      readonly seats: readonly SeatInfo[];
    }
  /** Aviso general (sala llena, todavia no es tu turno, etc.). */
  | { readonly kind: 'notice'; readonly code: string; readonly message: string };
