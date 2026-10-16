/**
 * Busca pares de territorios vecinos con duenos de colores CONTRASTADOS,
 * para las capturas del hito C3 (la onda de cambio de dueno necesita que el
 * color nuevo se distinga del viejo).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createMockGameState } from '../apps/client/src/app/fixtures.js';

const root = join(import.meta.dirname, '..');
const territories = JSON.parse(
  readFileSync(join(root, 'apps/client/public/map/territories.json'), 'utf8'),
) as { territories: { id: string }[] };
const adjacency = JSON.parse(
  readFileSync(join(root, 'apps/client/public/map/adjacency.json'), 'utf8'),
) as { edges: [string, string][] };
const fronts = JSON.parse(
  readFileSync(join(root, 'apps/client/public/map/fronts.json'), 'utf8'),
) as {
  fronts: { a: string; b: string; kind: string }[];
};

const territoryIds = territories.territories.map((entry) => entry.id);
const neighbors: Record<string, string[]> = {};
for (const [a, b] of adjacency.edges) {
  (neighbors[a] ??= []).push(b);
  (neighbors[b] ??= []).push(a);
}

const kindOf = (a: string, b: string): string => {
  const front = fronts.fronts.find(
    (candidate) =>
      (candidate.a === a && candidate.b === b) || (candidate.a === b && candidate.b === a),
  );
  return front?.kind ?? 'land';
};

const state = createMockGameState({ territoryIds, neighbors, playerCount: 4, seed: 4242 });
const colorOf = (id: string): string => {
  const owner = state.territories[id]?.owner ?? null;
  const player = state.players.find((candidate) => candidate.id === owner);
  return player === undefined ? 'neutral' : player.color;
};

/** Colores que se leen bien sobre el mapa azul del tablero. */
const vistosos = new Set(['rojo', 'amarillo', 'verde', 'magenta']);

const filtro = process.argv[2] === 'sea' ? 'sea' : 'land';

const encontrados: { a: string; b: string; ca: string; cb: string }[] = [];
for (const [a, b] of adjacency.edges) {
  if (kindOf(a, b) !== filtro) continue;
  const ca = colorOf(a);
  const cb = colorOf(b);
  if (ca === cb || ca === 'neutral' || cb === 'neutral') continue;
  if (!vistosos.has(ca) && !vistosos.has(cb)) continue;
  encontrados.push({ a, b, ca, cb });
}

console.log(`pares ${filtro} con contraste: ${encontrados.length}`);
for (const par of encontrados.slice(0, 12)) {
  console.log(`${par.a} (${par.ca}) vs ${par.b} (${par.cb})`);
}
