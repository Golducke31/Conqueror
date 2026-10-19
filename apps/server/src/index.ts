/**
 * Servidor del modo online (Hito 6).
 *
 * Colyseus (rooms v2, @colyseus/core 0.18) con transporte WebSocket: el
 * proceso es el anfitrion de todas las salas de Conqueror. Cada sala
 * (`ConquerorRoom`) es autoritativa: corre el motor completo y difunde solo la
 * vista publica de cada jugador.
 *
 * El mismo puerto sirve `/health` (verificado por CI y por el tunnel que se
 * usa para jugar con un amigo). `HOST`/`PORT` se configuran por entorno: por
 * defecto escucha solo en local.
 *
 * Ver docs/adr/0016-modo-online.md
 */

import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';

import { ADJACENCY_FILE, TERRITORIES_INDEX_FILE } from '@conqueror/map-data';
import { DEFAULT_RULES_CONFIG } from '@conqueror/shared';

import { ConquerorRoom } from './rooms/conquerorRoom.js';

const PORT = Number.parseInt(process.env['PORT'] ?? '2567', 10);
const HOST = process.env['HOST'] ?? '127.0.0.1';

const gameServer = new Server({
  transport: new WebSocketTransport(),
  greet: true,
  express: (app) => {
    // Salud del proceso: lo usan los smokes y el chequeo externo del tunel.
    app.get('/health', (_request, response) => {
      response.json({
        status: 'ok',
        version: '0.0.0',
        rooms: ConquerorRoom.NOMBRE,
        mapArtifacts: [TERRITORIES_INDEX_FILE, ADJACENCY_FILE],
        players: `${DEFAULT_RULES_CONFIG.players.min}-${DEFAULT_RULES_CONFIG.players.max}`,
      });
    });
  },
});

gameServer.define(ConquerorRoom.NOMBRE, ConquerorRoom);

await gameServer.listen(PORT, HOST);
console.log(
  JSON.stringify({
    level: 'info',
    event: 'server_listening',
    host: HOST,
    port: PORT,
    rooms: [ConquerorRoom.NOMBRE],
  }),
);
