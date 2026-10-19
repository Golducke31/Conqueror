/**
 * Sala autoritativa de Conqueror (Hito 6).
 *
 * Corre el motor completo (`@conqueror/rules`, tarjetas y misiones incluidas)
 * y a cada cliente le manda SOLO su vista publica (`publicState(state,
 * viewerId)`): el servidor nunca emite la vista de otro jugador. Los comandos
 * se validan contra el estado real (turno + legalidad): el motor es el unico
 * juez, esta sala solo orquesta.
 *
 * Sin estado sincronizado (@colyseus/schema): todo el protocolo va por
 * mensajes tipados (`ServerMessage` / `ClientMessage` en @conqueror/rules),
 * porque la vista publica ya es JSON plano y duplicarla en esquemas solo
 * agregaria un lugar donde divergir. Ver docs/adr/0016-modo-online.md
 *
 * `Room` sin parametros a proposito: el tipado de mensajes de @colyseus/core
 * 0.18 (via `~messages`) no aporta aca —el contrato real son los tipos de
 * protocolo— y los `send`/`onMessage` se castean en un solo lugar
 * (`enviar`/`onMessage`).
 */

import type { Client } from '@colyseus/core';
import { Room } from '@colyseus/core';
import { Schema } from '@colyseus/schema';
import { z } from 'zod';

import type {
  ApplyResult,
  Command,
  GameSpec,
  PublicGameState,
  SeatInfo,
  ServerMessage,
} from '@conqueror/rules';
import { DEFAULT_RULES_CONFIG } from '@conqueror/shared';
import { COMMAND_TYPES, GameCore, startAutoPlay } from '@conqueror/rules';

/** Vista de un espectador: `publicState` da cartas/mision vacios. */
const ESPECTADOR = 'espectador';

/** Partida sin armar: solo para el `spec` de la bienvenida en el lobby. */
const SIN_ARMAR: GameSpec = { players: [], config: DEFAULT_RULES_CONFIG, seed: 0 };

class EstadoSala extends Schema {}

interface Asiento {
  readonly indice: number;
  sessionId: string;
  playerId: string;
  name: string;
  connected: boolean;
  bot: boolean;
  host: boolean;
}

// --- Validacion del sobre entrante --------------------------------------------
// El motor valida los comandos de verdad (codigo + mensaje); aca solo se
// controla la forma del sobre para no alimentar basura al motor.
const COMANDOS = new Set<string>(COMMAND_TYPES);

const esquemaComando = z.looseObject({
  type: z.string().refine((tipo) => COMANDOS.has(tipo), { message: 'tipo de comando desconocido' }),
});

const esquemaSpec = z.looseObject({
  players: z.array(z.looseObject({ id: z.string(), name: z.string(), color: z.string() })),
  config: z.looseObject({}),
  seed: z.number(),
  botPlayers: z.array(z.string()).optional(),
  botSeed: z.number().optional(),
});

interface Conexion {
  readonly client: Client;
  readonly asiento: Asiento | null;
}

export class ConquerorRoom extends Room {
  static readonly NOMBRE = 'conqueror';

  override maxClients = 6;
  override autoDispose = true;
  /** Segundos que un asiento queda reservado para reconectar. */
  override seatReservationTimeout = 120;

  private readonly asientos: Asiento[] = [];
  private readonly clientes = new Map<string, Conexion>();
  private core: GameCore | null = null;
  private spec: GameSpec | null = null;
  private fase: 'lobby' | 'playing' | 'over' = 'lobby';
  private detenerBots: (() => void) | null = null;

  override onCreate(): void {
    this.setState(new EstadoSala());
    this.onMessage('configure', (client, payload) => this.configurar(client, payload));
    this.onMessage('command', (client, payload) => this.recibirComando(client, payload));
    // La bienvenida es respuesta a un saludo: asi el cliente tiene sus
    // handlers registrados antes de que llegue (no hay carrera de registro).
    // Los asientos viajan con ella: el que saluda ve siempre la sala completa.
    this.onMessage('hola', (client) => {
      this.enviarBienvenida(client, this.asientoDe(client));
      this.enviar(client, { kind: 'seats', fase: this.fase, seats: this.infoAsientos() });
    });
  }

  // --- Entrada y salida ---------------------------------------------------------

  override onJoin(client: Client, options?: { name?: string }): void {
    const nombre = typeof options?.name === 'string' ? options.name : 'Jugador';

    // Reconexion: el mismo sessionId recupera su asiento.
    const previo = this.asientos.find((asiento) => asiento.sessionId === client.sessionId);
    if (previo !== undefined) {
      previo.connected = true;
      this.clientes.set(client.sessionId, { client, asiento: previo });
      this.difundirAsientos();
      return;
    }

    if (this.asientos.length < this.maxClients && this.fase === 'lobby') {
      const indice = this.asientos.length;
      const asiento: Asiento = {
        indice,
        sessionId: client.sessionId,
        playerId: `p${indice + 1}`,
        name: nombre,
        connected: true,
        bot: false,
        host: this.asientos.length === 0,
      };
      this.asientos.push(asiento);
      this.clientes.set(client.sessionId, { client, asiento });
      this.difundirAsientos();
      return;
    }

    // Sala llena o ya empezada: entra como espectador (ve la partida, no juega).
    this.clientes.set(client.sessionId, { client, asiento: null });
    this.difundirAsientos();
  }

  override async onLeave(client: Client): Promise<void> {
    const conexion = this.clientes.get(client.sessionId);
    this.clientes.delete(client.sessionId);
    const asiento = conexion?.asiento ?? null;
    if (asiento === null) {
      this.difundirAsientos();
      return;
    }

    asiento.connected = false;

    // El asiento se reserva un rato: si vuelve, sigue en la misma silla.
    const reconecto = await this.allowReconnection(client, this.seatReservationTimeout)
      .then(() => true)
      .catch(() => false);
    if (reconecto) return;

    // No volvio: se libera la silla y el host pasa al siguiente conectado.
    const indice = this.asientos.indexOf(asiento);
    if (indice >= 0) this.asientos.splice(indice, 1);
    if (asiento.host) {
      const siguiente = this.asientos.find((candidato) => candidato.connected);
      if (siguiente !== undefined) siguiente.host = true;
    }
    this.difundirAsientos();
  }

  override onDispose(): void {
    this.detenerBots?.();
    this.detenerBots = null;
  }

  // --- Mensajes -----------------------------------------------------------------

  /** El host arma la partida con los asientos conectados (+ bots si quiere). */
  private configurar(client: Client, payload: unknown): void {
    const asiento = this.asientoDe(client);
    if (asiento === null || !asiento.host) {
      this.enviar(client, {
        kind: 'notice',
        code: 'NOT_HOST',
        message: 'Solo el host arma la partida',
      });
      return;
    }
    if (this.fase !== 'lobby') {
      this.enviar(client, {
        kind: 'notice',
        code: 'ALREADY_STARTED',
        message: 'La partida ya arranco',
      });
      return;
    }

    const datos = payload as { spec?: unknown };
    const parseado = esquemaSpec.safeParse(datos?.spec);
    if (!parseado.success) {
      this.enviar(client, {
        kind: 'notice',
        code: 'BAD_SPEC',
        message: 'Configuracion de partida invalida',
      });
      return;
    }
    const spec = parseado.data as unknown as GameSpec;

    const jugando = this.asientos.filter((silla) => silla.connected && !silla.bot);
    if (spec.players.length < jugando.length) {
      this.enviar(client, {
        kind: 'notice',
        code: 'BAD_SPEC',
        message: 'Faltan jugadores en la configuracion',
      });
      return;
    }
    // Cada asiento conectado tiene que ser un jugador humano de la especificacion.
    for (const silla of jugando) {
      const jugador = spec.players[silla.indice];
      if (jugador === undefined || (spec.botPlayers ?? []).includes(jugador.id)) {
        this.enviar(client, {
          kind: 'notice',
          code: 'BAD_SPEC',
          message: 'Los asientos conectados no coinciden con los jugadores',
        });
        return;
      }
    }

    this.core = new GameCore();
    this.core.create(spec);
    this.spec = spec;
    this.fase = 'playing';

    // Los clientes piden su bienvenida al ver la fase 'playing' (no hay
    // carrera de registro: el que saluda recibe).
    this.difundirAsientos();
    this.programarBots();
    this.registrar('partida_armada', { roomId: this.roomId, jugadores: spec.players.length });
  }

  /** Comando de juego: se valida turno y legalidad contra el motor real. */
  private recibirComando(client: Client, payload: unknown): void {
    const bruto = payload as { id?: unknown; command?: unknown };
    const id = typeof bruto?.id === 'number' ? (bruto.id as number) : null;
    const comando = esquemaComando.safeParse(bruto?.command);
    if (id === null || !comando.success) {
      this.enviar(client, {
        kind: 'notice',
        code: 'BAD_COMMAND',
        message: 'Comando invalido',
      });
      return;
    }

    const asiento = this.asientoDe(client);
    if (asiento === null || this.core === null || this.spec === null || this.fase !== 'playing') {
      if (id !== null) {
        this.enviar(client, {
          kind: 'rejected',
          id,
          code: 'NOT_STARTED',
          message: 'La partida no esta armada',
        });
      }
      return;
    }

    const completo = this.core.estadoCompleto();
    const turnoActual = this.spec.players.findIndex(
      (jugador) => jugador.id === completo.currentPlayer,
    );
    if (asiento.indice !== turnoActual) {
      this.enviar(client, {
        kind: 'rejected',
        id,
        code: 'NOT_YOUR_TURN',
        message: 'Todavia no es tu turno',
      });
      return;
    }

    const resultado = this.core.send(comando.data as unknown as Command);
    this.publicar(resultado, client, asiento, id);
  }

  // --- Publicacion ---------------------------------------------------------------

  /**
   * Un paso del motor (humano o bot) repartido a cada cliente: al emisor llega
   * `applied` (con su acuse), a los demas `state` + `events`.Todos los estados
   * van filtrados por el espectador.
   */
  private publicar(
    resultado: ApplyResult,
    emisor: Client | null,
    asientoEmisor: Asiento | null,
    id: number | null,
  ): void {
    if (!resultado.ok) {
      if (emisor !== null && id !== null) {
        this.enviar(emisor, {
          kind: 'rejected',
          id,
          code: resultado.code,
          message: resultado.message,
        });
      }
      return;
    }

    if (this.core === null) return;
    const eventos = resultado.events;

    if (this.core.estadoCompleto().phase === 'game-over') {
      this.fase = 'over';
      this.detenerBots?.();
      this.detenerBots = null;
    }

    for (const conexion of this.clientes.values()) {
      const esEmisor = emisor !== null && conexion.client === emisor;
      if (esEmisor && asientoEmisor !== null && id !== null) {
        this.enviar(conexion.client, {
          kind: 'applied',
          id,
          state: this.core.vistaPara(asientoEmisor.playerId),
          events: eventos,
        });
        continue;
      }
      this.enviar(conexion.client, {
        kind: 'state',
        state: this.core.vistaPara(conexion.asiento?.playerId ?? ESPECTADOR),
      });
      if (eventos.length > 0) {
        this.enviar(conexion.client, { kind: 'events', events: eventos });
      }
    }

    this.programarBots();
  }

  /** Si el turno quedo en manos de un bot, que siga jugando solo. */
  private programarBots(): void {
    this.detenerBots?.();
    this.detenerBots = null;
    if (this.core === null || this.fase !== 'playing') return;
    this.detenerBots = startAutoPlay(this.core, 700, (resultado) => {
      this.publicar(resultado, null, null, null);
    });
  }

  // --- Ayudantes ------------------------------------------------------------------

  private asientoDe(client: Client): Asiento | null {
    return this.clientes.get(client.sessionId)?.asiento ?? null;
  }

  /** Bienvenida al entrar o reconectar: con que jugador soy y que veo. */
  private enviarBienvenida(client: Client, asiento: Asiento | null): void {
    const estado: PublicGameState | null =
      this.core !== null && this.fase !== 'lobby'
        ? this.core.vistaPara(asiento?.playerId ?? ESPECTADOR)
        : null;
    this.enviar(client, {
      kind: 'welcome',
      welcome: {
        playerId: asiento?.playerId ?? ESPECTADOR,
        roomId: this.roomId,
        spec: this.spec ?? SIN_ARMAR,
        state: estado,
        seats: this.infoAsientos(),
      },
    });
  }

  private difundirAsientos(): void {
    const mensaje: ServerMessage = { kind: 'seats', fase: this.fase, seats: this.infoAsientos() };
    for (const conexion of this.clientes.values()) this.enviar(conexion.client, mensaje);
  }

  private infoAsientos(): SeatInfo[] {
    return this.asientos.map((asiento) => ({
      playerId: asiento.playerId,
      name: asiento.name,
      connected: asiento.connected,
      bot: asiento.bot,
      host: asiento.host,
    }));
  }

  private enviar(client: Client, mensaje: ServerMessage): void {
    (client.send as (tipo: string, mensaje: unknown) => void)(mensaje.kind, mensaje);
  }

  private registrar(evento: string, datos: Record<string, unknown>): void {
    console.log(JSON.stringify({ level: 'info', event: evento, ...datos }));
  }
}
