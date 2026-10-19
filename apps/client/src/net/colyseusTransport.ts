/**
 * Transporte online (Hito 6).
 *
 * Envuelve una sala de Colyseus (`@colyseus/sdk`) detras de la MISMA interfaz
 * `GameTransport` que usa el transporte local: el HUD, el director de combate y
 * la pantalla de relevo no saben donde corre la partida.
 *
 * La sala la crea/une el lobby (`ui/online.ts`) y la pasa construida: el
 * transporte solo traduce mensajes. Los comandos van con un `id` que el
 * servidor acusa (`applied`) o rechaza (`rejected`, que sale por `onError`,
 * igual que en local). El estado llega filtrado por el servidor, asi que este
 * transporte nunca ve la vista de otro jugador.
 *
 * Ver docs/adr/0016-modo-online.md
 */

import type { Room as RoomColyseus } from '@colyseus/sdk';

import type { Command, ServerMessage, Welcome } from '@conqueror/rules';

import { BaseTransport, type Unsub } from './transport.js';

interface Pendiente {
  readonly resolver: () => void;
}

export class ColyseusTransport extends BaseTransport {
  private readonly room: RoomColyseus;
  private readonly limpieza: Unsub[] = [];
  private siguiente = 0;
  private readonly pendientes = new Map<number, Pendiente>();
  private readonly resolverBienvenida: ((welcome: Welcome) => void)[] = [];

  private constructor(room: RoomColyseus) {
    super();
    this.room = room;
    this.suscribir();
  }

  /** Envuelve una sala ya conectada (creada o unida por el lobby). */
  static desdeSala(room: RoomColyseus): ColyseusTransport {
    return new ColyseusTransport(room);
  }

  /** Codigo de sala, para mostrar y compartir. */
  get roomId(): string {
    return this.room.roomId;
  }

  /**
   * Saluda a la sala y espera la bienvenida: con que jugador se identifica
   * este cliente y con que estado arranca. La bienvenida la manda el servidor
   * como respuesta a ESTE saludo (no antes), para no perder mensajes; se pide
   * de nuevo cada vez que hace falta (al entrar y cuando arranca la partida),
   * asi nunca se devuelve una bienvenida vieja.
   */
  saludar(): Promise<Welcome> {
    this.enviar('hola', {});
    return new Promise<Welcome>((resolve) => {
      this.resolverBienvenida.push(resolve);
    });
  }

  override async send(command: Command): Promise<void> {
    const id = this.siguiente;
    this.siguiente += 1;
    const promesa = new Promise<void>((resolve) => {
      this.pendientes.set(id, { resolver: resolve });
    });
    this.enviar('command', { kind: 'command', id, command });
    return promesa;
  }

  override dispose(): void {
    for (const baja of this.limpieza) baja();
    this.limpieza.length = 0;
    this.pendientes.clear();
    // Salida consentida: no es una desconexion, no se avisa como error.
    void this.room.leave(true).catch(() => undefined);
    super.dispose();
  }

  // --- Cableado de la sala --------------------------------------------------------

  private suscribir(): void {
    const escuchar = <T>(tipo: string, handler: (mensaje: T) => void): void => {
      this.limpieza.push(this.room.onMessage(tipo, handler as never));
    };

    escuchar<Extract<ServerMessage, { kind: 'welcome' }>>('welcome', (mensaje) => {
      if (mensaje.welcome.state !== null) this.emitState(mensaje.welcome.state);
      // Un saludo, una bienvenida: se resuelven las esperas en orden.
      const resolvers = this.resolverBienvenida.splice(0);
      for (const resolver of resolvers) resolver(mensaje.welcome);
    });

    escuchar<Extract<ServerMessage, { kind: 'applied' }>>('applied', (mensaje) => {
      this.pendientes.get(mensaje.id)?.resolver();
      this.pendientes.delete(mensaje.id);
      this.emitState(mensaje.state);
      if (mensaje.events.length > 0) this.emitEvents(mensaje.events);
    });

    escuchar<Extract<ServerMessage, { kind: 'rejected' }>>('rejected', (mensaje) => {
      this.pendientes.get(mensaje.id)?.resolver();
      this.pendientes.delete(mensaje.id);
      this.emitError(mensaje.message);
    });

    escuchar<Extract<ServerMessage, { kind: 'state' }>>('state', (mensaje) => {
      this.emitState(mensaje.state);
    });

    escuchar<Extract<ServerMessage, { kind: 'events' }>>('events', (mensaje) => {
      this.emitEvents(mensaje.events);
    });

    escuchar<Extract<ServerMessage, { kind: 'notice' }>>('notice', (mensaje) => {
      this.emitError(mensaje.message);
    });

    // Salon cerrado o caida de red: no consentida = error visible.
    this.room.onLeave((codigo: number) => {
      if (codigo === 1000 || codigo === 1005) return;
      this.emitError('Se perdio la conexion con la sala');
    });
  }

  private enviar(tipo: string, mensaje: unknown): void {
    (this.room.send as (tipo: string, mensaje: unknown) => void)(tipo, mensaje);
  }
}

/**
 * Endpoint por defecto: mismo origen que la pagina, bajo `/colyseus`
 * (Vite hace de proxy en desarrollo; detras de un tunel va directo al server).
 * `wss:` cuando la pagina es https.
 */
export function endpointOnline(): string {
  const protocolo = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocolo}//${window.location.host}/colyseus`;
}
