/**
 * Servidor del modo online.
 *
 * ESTADO: Hito 0 deja un servidor HTTP minimo con `/health` para poder levantar
 * y verificar el proceso. Las salas de Colyseus (`LobbyRoom`, `GameRoom`) y el
 * estado sincronizado llegan en el Hito 6.
 *
 * Decision: no se instala Colyseus todavia para no arrastrar dependencias que
 * el Hito 0 no necesita. Ver docs/adr/0001-monorepo-y-stack.md
 */

import { createServer } from 'node:http';
import { ADJACENCY_FILE, TERRITORIES_INDEX_FILE } from '@conqueror/map-data';
import { DEFAULT_RULES_CONFIG } from '@conqueror/shared';

const PORT = Number.parseInt(process.env['PORT'] ?? '2567', 10);
const HOST = process.env['HOST'] ?? '127.0.0.1';

interface HealthPayload {
  readonly status: 'ok';
  readonly version: string;
  readonly mapArtifacts: readonly string[];
  readonly players: string;
}

const payload: HealthPayload = {
  status: 'ok',
  version: '0.0.0',
  mapArtifacts: [TERRITORIES_INDEX_FILE, ADJACENCY_FILE],
  players: `${DEFAULT_RULES_CONFIG.players.min}-${DEFAULT_RULES_CONFIG.players.max}`,
};

const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(payload));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, HOST, () => {
  // Log estructurado minimo (plan, seccion 12).
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'server_listening',
      host: HOST,
      port: PORT,
      note: 'Hito 0: sin Colyseus todavia',
    }),
  );
});
