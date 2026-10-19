/**
 * Transporte local (modo hot-seat y vs. bots).
 *
 * Corre el motor en el cliente, por defecto en un Web Worker (el render y el
 * HUD nunca compiten con la logica). Expone la MISMA interfaz `GameTransport`
 * que usara el modo online (Hito 6), as que la UI no sabe donde corre la
 * partida.
 *
 * La vista publica se filtra siempre por el jugador de turno: en hot-seat eso
 * alcanza para que cada jugador vea solo sus tarjetas y su mision (la pantalla
 * de relevo oculta el HUD entre turno y turno).
 *
 * Ver docs/adr/0013-modo-local.md
 */

import {
  GameCore,
  startAutoPlay,
  type Command,
  type GameEvent,
  type GameSpec,
  type PublicGameState,
} from '@conqueror/rules';

import { BaseTransport } from './transport.js';

export interface LocalTransportOptions {
  readonly spec: GameSpec;
  /** Demora entre comandos de bot, en ms (0 = lo mas rapido posible). */
  readonly botDelayMs?: number;
  /** `'worker'` por defecto; `'inline'` corre en el hilo principal (tests). */
  readonly engine?: 'worker' | 'inline';
}

export type MotorResultado =
  | { readonly ok: true; readonly state: PublicGameState; readonly events: readonly GameEvent[] }
  | { readonly ok: false; readonly code: string; readonly message: string };

interface GameEngine {
  create(spec: GameSpec, delayMs: number): Promise<PublicGameState>;
  send(command: Command): Promise<MotorResultado>;
  /** Pasos de bot: no tienen pedido, llegan solos. */
  onAuto(listener: (resultado: MotorResultado) => void): void;
  dispose(): void;
}

/** Motor en el hilo principal: el mismo nucleo, sin Worker. */
class InlineEngine implements GameEngine {
  private readonly core = new GameCore();
  private detenerAuto: (() => void) | null = null;
  private delay = 0;
  private autoListeners: ((resultado: MotorResultado) => void)[] = [];

  async create(spec: GameSpec, delayMs: number): Promise<PublicGameState> {
    this.delay = delayMs;
    const state = this.core.create(spec);
    this.detenerAuto?.();
    this.detenerAuto = startAutoPlay(this.core, this.delay, (resultado) => {
      for (const listener of this.autoListeners) listener(resultado);
    });
    return state;
  }

  async send(command: Command): Promise<MotorResultado> {
    const resultado = this.core.send(command);
    // El turno puede haber quedado en manos de un bot: sigue jugando solo.
    this.detenerAuto?.();
    this.detenerAuto = startAutoPlay(this.core, this.delay, (paso) => {
      for (const listener of this.autoListeners) listener(paso);
    });
    return resultado;
  }

  onAuto(listener: (resultado: MotorResultado) => void): void {
    this.autoListeners.push(listener);
  }

  dispose(): void {
    this.detenerAuto?.();
    this.detenerAuto = null;
    this.autoListeners = [];
  }
}

/** Motor en Web Worker: el nucleo corre en otro hilo. */
class WorkerEngine implements GameEngine {
  private readonly worker: Worker;
  private siguiente = 0;
  private readonly espera = new Map<number, (resultado: MotorResultado) => void>();
  private autoListeners: ((resultado: MotorResultado) => void)[] = [];

  constructor() {
    this.worker = new Worker(new URL('./rulesWorker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', (event: MessageEvent) => {
      const mensaje = event.data as
        | { id?: number; kind: 'created'; state: PublicGameState }
        | { id?: number; kind: 'applied'; state: PublicGameState; events: readonly GameEvent[] }
        | { id?: number; kind: 'rejected'; code: string; message: string }
        | { kind: 'auto'; state: PublicGameState; events: readonly GameEvent[] }
        | { kind: 'autoFailed'; code: string; message: string };

      if (mensaje.kind === 'auto') {
        for (const listener of this.autoListeners) {
          listener({ ok: true, state: mensaje.state, events: mensaje.events });
        }
        return;
      }
      if (mensaje.kind === 'autoFailed') {
        for (const listener of this.autoListeners) {
          listener({ ok: false, code: mensaje.code, message: mensaje.message });
        }
        return;
      }

      const resolver = mensaje.id === undefined ? undefined : this.espera.get(mensaje.id);
      if (resolver === undefined) return;
      this.espera.delete(mensaje.id as number);
      if (mensaje.kind === 'created' || mensaje.kind === 'applied') {
        resolver({
          ok: true,
          state: mensaje.state,
          events: mensaje.kind === 'applied' ? mensaje.events : [],
        });
      } else {
        resolver({ ok: false, code: mensaje.code, message: mensaje.message });
      }
    });
    this.worker.addEventListener('error', (event) => {
      for (const [id, resolver] of this.espera) {
        resolver({ ok: false, code: 'WORKER_ERROR', message: event.message });
        this.espera.delete(id);
      }
    });
  }

  private pedir(mensaje: Record<string, unknown>): number {
    const id = this.siguiente;
    this.siguiente += 1;
    this.worker.postMessage({ id, ...mensaje });
    return id;
  }

  async create(spec: GameSpec, delayMs: number): Promise<PublicGameState> {
    const id = this.pedir({ kind: 'create', spec, delayMs });
    const resultado = await new Promise<MotorResultado>((resolve) => {
      this.espera.set(id, resolve);
    });
    if (!resultado.ok) throw new Error(resultado.message);
    return resultado.state as PublicGameState;
  }

  async send(command: Command): Promise<MotorResultado> {
    const id = this.pedir({ kind: 'command', command });
    return new Promise<MotorResultado>((resolve) => {
      this.espera.set(id, resolve);
    });
  }

  onAuto(listener: (resultado: MotorResultado) => void): void {
    this.autoListeners.push(listener);
  }

  dispose(): void {
    this.pedir({ kind: 'stopAuto' });
    this.worker.terminate();
    this.espera.clear();
    this.autoListeners = [];
  }
}

/** Transporte de la partida local: la UI solo ve `GameTransport`. */
export class LocalTransport extends BaseTransport {
  private readonly engine: GameEngine;

  private constructor(engine: GameEngine) {
    super();
    this.engine = engine;
    engine.onAuto((resultado) => this.publicar(resultado));
  }

  /** Arma la partida y deja el transporte listo para recibir comandos. */
  static async create(options: LocalTransportOptions): Promise<LocalTransport> {
    const engine: GameEngine =
      options.engine === 'inline' || typeof Worker === 'undefined'
        ? new InlineEngine()
        : new WorkerEngine();
    const transport = new LocalTransport(engine);
    const state = await engine.create(options.spec, options.botDelayMs ?? 700);
    transport.emitState(state);
    return transport;
  }

  override async send(command: Command): Promise<void> {
    const resultado = await this.engine.send(command);
    this.publicar(resultado);
  }

  private publicar(resultado: MotorResultado): void {
    if (resultado.ok) {
      this.emitState(resultado.state);
      if (resultado.events.length > 0) this.emitEvents(resultado.events);
      return;
    }
    this.emitError(resultado.message);
  }

  override dispose(): void {
    this.engine.dispose();
    super.dispose();
  }
}
