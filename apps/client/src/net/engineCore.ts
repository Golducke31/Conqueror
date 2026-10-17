/**
 * Nucleo del motor en el cliente.
 *
 * Envuelve el `GameState` completo (con tarjetas y misiones, que NUNCA salen
 * del cliente) y expone solo lo que la UI necesita: la vista publica filtrada
 * por el jugador activo y los eventos para animar.
 *
 * Es puro (sin DOM): lo usan igual el Web Worker del modo local y el motor en
 * el hilo principal (tests, y navegadores sinWorker). La logica de aplicar
 * comandos vive UNA sola vez aca.
 *
 * Ver docs/adr/0013-modo-local.md
 */

import type { PlayerId, RulesConfig } from '@conqueror/shared';

import {
  apply,
  createBot,
  createGameState,
  createRng,
  publicState,
  type Bot,
  type Command,
  type GameEvent,
  type GameState,
  type PlayerSetup,
  type PublicGameState,
  type Rng,
} from '@conqueror/rules';

/** Como se arma la partida. */
export interface GameSpec {
  readonly players: readonly PlayerSetup[];
  readonly config: RulesConfig;
  /** Semilla: la partida entera se reproduce con ella. */
  readonly seed: number;
  /** Jugadores que juega el bot nivel 1. */
  readonly botPlayers?: readonly PlayerId[];
  /** Semilla propia del bot (independiente de la de la partida). */
  readonly botSeed?: number;
}

export interface ApplyOk {
  readonly ok: true;
  readonly state: PublicGameState;
  readonly events: readonly GameEvent[];
}

export interface ApplyFail {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

export type ApplyResult = ApplyOk | ApplyFail;

export class GameCore {
  private state: GameState | null = null;
  private rng: Rng | null = null;
  private botPlayers = new Set<PlayerId>();
  private bot: Bot | null = null;

  /** Arma la partida y devuelve la vista publica del primer jugador. */
  create(spec: GameSpec): PublicGameState {
    const state = createGameState({
      players: spec.players,
      config: spec.config,
      seed: spec.seed,
    });
    this.state = state;
    // `rngState` del estado cubre todo el armado: resumir desde ahi reproduce
    // la partida exacta con (semilla, comandos).
    this.rng = createRng(state.rngState);
    this.botPlayers = new Set(spec.botPlayers ?? []);
    this.bot =
      this.botPlayers.size > 0 ? createBot(createRng(spec.botSeed ?? spec.seed + 1)) : null;
    return this.vista();
  }

  /** Estado visible para el jugador de turno (sin tarjetas ni misiones ajenas). */
  vista(): PublicGameState {
    if (this.state === null) throw new Error('GameCore: la partida no esta armada');
    return publicState(this.state, this.state.currentPlayer);
  }

  /** Si el jugador de turno lo juega el bot. */
  activeIsBot(): boolean {
    return this.state !== null && this.botPlayers.has(this.state.currentPlayer);
  }

  /** Proximo comando del bot, o `null` si no hay nada legal. */
  nextBotCommand(): Command | null {
    if (this.state === null || this.bot === null) return null;
    return this.bot.choose(this.state);
  }

  /** Aplica un comando del jugador de turno. No muta lo que ya devolvio. */
  send(command: Command): ApplyResult {
    if (this.state === null || this.rng === null) {
      return { ok: false, code: 'NOT_STARTED', message: 'La partida no esta armada' };
    }
    const jugador = this.state.currentPlayer;
    const resultado = apply(this.state, command, jugador, {
      rng: this.rng,
      config: this.state.config,
    });
    if (!resultado.ok) {
      return { ok: false, code: resultado.error.code, message: resultado.error.message };
    }
    this.state = resultado.value.state;
    return { ok: true, state: this.vista(), events: resultado.value.events };
  }
}

/**
 * Arranca el juego automatico de los bots: mientras el jugador de turno sea un
 * bot, aplica su comando tras `delayMs`. Devuelve una funcion para detenerlo.
 *
 * Vive aca (y no en el worker) para que el motor en hilo principal y el worker
 * compartan el mismo ciclo.
 */
export function startAutoPlay(
  core: GameCore,
  delayMs: number,
  emit: (resultado: ApplyResult) => void,
): () => void {
  let detenido = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const limpiar = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const paso = (): void => {
    if (detenido) return;
    limpiar();
    if (!core.activeIsBot()) return;

    const comando = core.nextBotCommand();
    if (comando === null) {
      emit({ ok: false, code: 'BOT_STUCK', message: 'El bot no encontro un comando legal' });
      return;
    }
    emit(core.send(comando));
    if (!detenido && core.activeIsBot()) timer = setTimeout(paso, Math.max(0, delayMs));
  };

  if (core.activeIsBot()) timer = setTimeout(paso, Math.max(0, delayMs));

  return () => {
    detenido = true;
    limpiar();
  };
}
