/**
 * Vista previa del tablero en SVG.
 *
 * Herramienta de desarrollo: dibuja la geometria generada con la proyeccion
 * plana por defecto (geoNaturalEarth1) para poder revisar formas, tamanos y
 * distribucion sin abrir el juego. Escribe
 * `packages/map-data/generated/map-preview.svg`.
 *
 * No forma parte del build ni del CI: es para mirar.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { geoNaturalEarth1, geoPath } from 'd3-geo';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { feature as topoFeature } from 'topojson-client';

import {
  ADJACENCY_FILE,
  TERRITORIES_INDEX_FILE,
  TERRITORIES_TOPOLOGY_FILE,
} from '@conqueror/map-data';
import type { AdjacencyFile, TerritoriesFile } from '@conqueror/map-data';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED_DIR = join(REPO_ROOT, 'packages', 'map-data', 'generated');

const WIDTH = 1600;
const HEIGHT = 900;

/** Tinte por continente, elegido para que se distingan a simple vista. */
const TINTE: Readonly<Record<string, string>> = {
  america_del_norte: '#c1622f',
  america_del_sur: '#4f7a3f',
  europa: '#6a5a9c',
  asia: '#b39a3c',
  africa: '#a33f3f',
  oceania: '#3f7a72',
};

async function readJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(join(GENERATED_DIR, name), 'utf8')) as T;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function main(): Promise<void> {
  const topology = JSON.parse(
    await readFile(join(GENERATED_DIR, TERRITORIES_TOPOLOGY_FILE), 'utf8'),
  ) as unknown;
  const index = await readJson<TerritoriesFile>(TERRITORIES_INDEX_FILE);
  const adjacency = await readJson<AdjacencyFile>(ADJACENCY_FILE);

  const object = (topology as { objects: Record<string, unknown> }).objects['territories'];
  const converted = topoFeature(topology as never, object as never) as unknown;
  const collection = converted as FeatureCollection | Feature<Geometry>;

  const features: Feature<Geometry>[] =
    collection.type === 'FeatureCollection'
      ? [...collection.features]
      : [collection as Feature<Geometry>];

  const projection = geoNaturalEarth1().fitExtent(
    [
      [12, 12],
      [WIDTH - 12, HEIGHT - 12],
    ],
    collection,
  );
  const path = geoPath(projection);

  const continentOf = new Map(index.territories.map((t) => [t.id, t.continent]));
  const names = new Map(index.territories.map((t) => [t.id, t.names['es-AR']]));

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">`,
  );
  parts.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="#0b1022"/>`);

  // Relleno por territorio.
  for (const item of features) {
    const id = typeof item.id === 'string' ? item.id : '';
    const d = path(item);
    if (d === null) continue;
    const fill = TINTE[continentOf.get(id) ?? ''] ?? '#28335c';
    parts.push(`<path d="${d}" fill="${fill}" stroke="#0b1022" stroke-width="0.6"/>`);
  }

  // Fronteras terrestres marcadas, para revisar la coherencia con el grafo.
  for (const [a, b] of adjacency.landBorders) {
    const fa = features.find((item) => item.id === a);
    const fb = features.find((item) => item.id === b);
    if (fa === undefined || fb === undefined) continue;
    const da = path(fa);
    const db = path(fb);
    if (da === null || db === null) continue;
    parts.push(
      `<path d="${da}" fill="none" stroke="#efe4cc" stroke-width="1.1" stroke-opacity="0.85"/>`,
    );
    parts.push(
      `<path d="${db}" fill="none" stroke="#efe4cc" stroke-width="1.1" stroke-opacity="0.85"/>`,
    );
  }

  // Etiquetas en el ancla calculada.
  for (const territory of index.territories) {
    const projected = projection([territory.labelAnchor[0], territory.labelAnchor[1]]);
    if (projected === null) continue;
    const [x, y] = projected;
    const label = names.get(territory.id) ?? territory.id;
    parts.push(
      `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="#efe4cc" font-family="Georgia, serif" font-size="11" text-anchor="middle" paint-order="stroke" stroke="#0b1022" stroke-width="3" stroke-linejoin="round">${escapeXml(label)}</text>`,
    );
  }

  parts.push('</svg>');

  const svg = parts.join('\n');
  const destination = join(GENERATED_DIR, 'map-preview.svg');
  await writeFile(destination, svg, 'utf8');
  console.log(`[map:preview] escrito ${destination} (${(svg.length / 1024).toFixed(1)} KB)`);
}

main().catch((error: unknown) => {
  console.error('[map:preview] error:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
