/**
 * Tests de la sala autoritativa (Hito 6).
 *
 * Levantan un Server de Colyseus en memoria (`@colyseus/testing`), conectan
 * clientes REALES por WebSocket y verifican el contrato online: bienvenida,
 * asientos, validacion de turno, aplicacion de comandos y bots jugando solos
 * en el servidor. El motor local espeja la misma partida (misma semilla) para
 * saber que comandos son legales y como tienen que quedar las cuentas.
 *
 * Ver docs/adr/0016-modo-online.md
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import type { Room as RoomCliente } from '@colyseus/sdk';

import type { Command, GameSpec, PlayerId, ServerMessage } from '@conqueror/rules';
import { GameCore, getLegalCommands } from '@conqueror/rules';
import { DEFAULT_RULES_CONFIG } from '@conqueror/shared';

import { ConquerorRoom } from './conquerorRoom.js';

const SEMILLA = 20261017;
const TIMEOUT = 15000;

interface SalaArmada {
  readonly sala: unknown;
  readonly host: RoomCliente;
  readonly amigo: RoomCliente;
}

interface SalaSola {
  readonly sala: unknown;
  readonly host: RoomCliente;
}

let testServer: ColyseusTestServer;

beforeAll(async () => {
  const gameServer = new Server({
    transport: new WebSocketTransport(),
    greet: false,
  });
  gameServer.define(ConquerorRoom.NOMBRE, ConquerorRoom);
  testServer = await boot(gameServer);
});

afterAll(async () => {
  if (testServer !== undefined) await testServer.cleanup();
});

/** Sala fresca por test: los clientes se pelean solos. */
async function armar(): Promise<SalaArmada> {
  const sala = await testServer.createRoom(ConquerorRoom.NOMBRE);
  const host = await testServer.connectTo(sala, { name: 'Host' });
  conectarCola(host);
  const amigo = await testServer.connectTo(sala, { name: 'Amigo' });
  conectarCola(amigo);
  return { sala, host, amigo };
}

/** Sala de un solo humano (los demas jugadores, bots). */
async function armarSolo(): Promise<SalaSola> {
  const sala = await testServer.createRoom(ConquerorRoom.NOMBRE);
  const host = await testServer.connectTo(sala, { name: 'Host' });
  conectarCola(host);
  return { sala, host };
}

function specDosHumanos(): GameSpec {
  return {
    players: [
      { id: 'p1', name: 'Host', color: 'rojo' },
      { id: 'p2', name: 'Amigo', color: 'azul' },
    ],
    config: DEFAULT_RULES_CONFIG,
    seed: SEMILLA,
  };
}

function specConBot(): GameSpec {
  return { ...specDosHumanos(), botPlayers: ['p2'] };
}

// --- Cola de mensajes por sala -------------------------------------------------
// Todo lo que llega por el comodin se guarda: un mensaje puede haber llegado
// antes de que el test espere por su tipo.

const colas = new WeakMap<RoomCliente, [string, unknown][]>();

function conectarCola(room: RoomCliente): void {
  const cola: [string, unknown][] = [];
  colas.set(room, cola);
  room.onMessage('*', ((tipo: string, mensaje: unknown) => {
    cola.push([tipo, mensaje]);
  }) as never);
}

function mandar(room: RoomCliente, tipo: string, mensaje: unknown): void {
  (room.send as (tipo: string, mensaje: unknown) => void)(tipo, mensaje);
}

/** Espera un mensaje del servidor (lo busca primero en la cola). */
function esperar<T>(room: RoomCliente, tipo: string, ms = TIMEOUT): Promise<T> {
  const cola = colas.get(room);
  if (cola !== undefined) {
    const indice = cola.findIndex(([t]) => t === tipo);
    if (indice >= 0) {
      const [, mensaje] = cola.splice(indice, 1)[0] as [string, T];
      return Promise.resolve(mensaje);
    }
  }
  return new Promise<T>((resolve, reject) => {
    const fuera = setTimeout(() => reject(new Error(`timeout esperando '${tipo}'`)), ms);
    const baja = room.onMessage(tipo, ((mensaje: T) => {
      clearTimeout(fuera);
      baja();
      resolve(mensaje);
    }) as never);
  });
}

/** Saludo -> bienvenida: sin carrera de registro. */
async function saludar(room: RoomCliente): Promise<Extract<ServerMessage, { kind: 'welcome' }>> {
  mandar(room, 'hola', {});
  return esperar<Extract<ServerMessage, { kind: 'welcome' }>>(room, 'welcome');
}

/** Espera el aviso de asientos de una fase concreta (descarta los viejos). */
async function esperarFase(
  room: RoomCliente,
  fase: 'lobby' | 'playing' | 'over',
): Promise<Extract<ServerMessage, { kind: 'seats' }>> {
  for (;;) {
    const mensaje = await esperar<Extract<ServerMessage, { kind: 'seats' }>>(room, 'seats');
    if (mensaje.fase === fase) return mensaje;
  }
}

/** Espejo local de la misma partida: misma semilla, mismos comandos. */
function espejo(spec: GameSpec): GameCore {
  const core = new GameCore();
  core.create(spec);
  return core;
}

describe('sala online (Hito 6)', () => {
  it(
    'cada cliente recibe su bienvenida y ve los asientos',
    async () => {
      const { host, amigo } = await armar();

      const wHost = await saludar(host);
      expect(wHost.welcome.playerId).toBe('p1');
      expect(wHost.welcome.state).toBeNull();

      const wAmigo = await saludar(amigo);
      expect(wAmigo.welcome.playerId).toBe('p2');

      const asientos = await esperar<Extract<ServerMessage, { kind: 'seats' }>>(host, 'seats');
      expect(asientos.seats).toHaveLength(2);
      expect(asientos.fase).toBe('lobby');
      expect(asientos.seats[0]).toMatchObject({ playerId: 'p1', name: 'Host', host: true });
      expect(asientos.seats[1]).toMatchObject({ playerId: 'p2', name: 'Amigo', host: false });
    },
    TIMEOUT,
  );

  it(
    'el host arma la partida y cada jugador recibe su propio estado',
    async () => {
      const { host, amigo } = await armar();
      const spec = specDosHumanos();
      await saludar(host);

      mandar(host, 'configure', { spec });

      const fase = await esperarFase(host, 'playing');
      expect(fase.seats).toHaveLength(2);

      const wHost = await saludar(host);
      expect(wHost.welcome.state).not.toBeNull();
      expect(wHost.welcome.state?.phase).toBe('setup-placement');
      expect(wHost.welcome.spec.players).toHaveLength(2);

      const wAmigo = await saludar(amigo);
      expect(wAmigo.welcome.state).not.toBeNull();
      expect(wAmigo.welcome.playerId).toBe('p2');
    },
    TIMEOUT,
  );

  it(
    'un comando fuera de turno se rechaza con su motivo',
    async () => {
      const { host, amigo } = await armar();

      mandar(host, 'configure', { spec: specDosHumanos() });
      await esperarFase(host, 'playing');
      await saludar(host);

      // El turno es del host (p1): el amigo manda igual.
      mandar(amigo, 'command', { id: 1, command: { type: 'END_TURN' } });

      const rechazo = await esperar<Extract<ServerMessage, { kind: 'rejected' }>>(
        amigo,
        'rejected',
      );
      expect(rechazo.id).toBe(1);
      expect(rechazo.code).toBe('NOT_YOUR_TURN');
    },
    TIMEOUT,
  );

  it(
    'el comando del turno se aplica y avisa al otro jugador',
    async () => {
      const { host, amigo } = await armar();
      const spec = specDosHumanos();

      const core = espejo(spec);
      const legal = getLegalCommands(core.estadoCompleto(), 'p1' as PlayerId)[0];
      expect(legal).toBeDefined();
      const aplicado = core.send(legal as Command);
      expect(aplicado.ok).toBe(true);

      mandar(host, 'configure', { spec });
      await esperarFase(host, 'playing');

      mandar(host, 'command', { id: 7, command: legal });
      const ok = await esperar<Extract<ServerMessage, { kind: 'applied' }>>(host, 'applied');
      expect(ok.id).toBe(7);
      if (aplicado.ok) {
        expect(ok.state.turn).toBe(aplicado.state.turn);
        expect(ok.state.armiesToPlace).toBe(aplicado.state.armiesToPlace);
        expect(ok.state.territories).toEqual(aplicado.state.territories);
      }

      // El otro cliente recibe el estado nuevo (filtrado por el).
      const cambio = await esperar<Extract<ServerMessage, { kind: 'state' }>>(amigo, 'state');
      expect(cambio.state.phase).toBe('setup-placement');
      expect(cambio.state.activePlayer).toBe(
        aplicado.ok ? aplicado.state.activePlayer : cambio.state.activePlayer,
      );
    },
    TIMEOUT,
  );

  it('los bots juegan solos en el servidor cuando les toca el turno', async () => {
    const { host } = await armarSolo();
    const spec = specConBot();

    mandar(host, 'configure', { spec });
    await esperarFase(host, 'playing');

    // El humano juega su turno (comandos legales del espejo) hasta que el
    // turno pase al bot.
    const core = espejo(spec);
    for (let paso = 0; paso < 20; paso += 1) {
      if (core.estadoCompleto().currentPlayer !== 'p1') break;
      const legal = getLegalCommands(core.estadoCompleto(), 'p1' as PlayerId)[0];
      if (legal === undefined) break;
      const resultado = core.send(legal);
      if (!resultado.ok) break;
      mandar(host, 'command', { id: paso + 1, command: legal });
      await esperar(host, 'applied');
    }
    expect(core.estadoCompleto().currentPlayer).toBe('p2');

    // Sin enviar nada mas, el bot juega: tienen que llegar estados solos.
    let turnoVuelto = false;
    for (let espera = 0; espera < 40 && !turnoVuelto; espera += 1) {
      const cambio = await esperar<Extract<ServerMessage, { kind: 'state' }>>(host, 'state', 8000);
      if (cambio.state.activePlayer === 'p1') turnoVuelto = true;
    }
    expect(turnoVuelto).toBe(true);
  }, 60000);
});
