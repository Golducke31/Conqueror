/**
 * Validacion del tablero generado.
 *
 * Falla (exit code 1) si:
 *   - el grafo de adyacencia no es conexo
 *   - la adyacencia no es simetrica
 *   - hay territorios huerfanos (grado 0)
 *   - un continente no es contiguo (contando enlaces maritimos)
 *   - falta un nombre en algun idioma
 *   - el grafo derivado no coincide con la matriz clasica validada
 *   - hay enlaces o exclusiones declarados que no tienen efecto
 *   - falta geometria o el indice y la adyacencia no cubren los mismos ids
 *
 * Ver docs/adr/0004-datos-de-mapa-natural-earth.md
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ADJACENCY_FILE,
  FRONTS_FILE,
  TERRITORIES_INDEX_FILE,
  TERRITORIES_TOPOLOGY_FILE,
  classicBoardEdges,
  pairKey,
} from '@conqueror/map-data';
import { loadMapConfig } from '@conqueror/map-data/node';
import type { AdjacencyFile, FrontsFile, TerritoriesFile } from '@conqueror/map-data';
import { LOCALES } from '@conqueror/shared';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(REPO_ROOT, 'packages', 'map-data', 'territories.config.json');
const GENERATED_DIR = join(REPO_ROOT, 'packages', 'map-data', 'generated');

const problems: string[] = [];

function fail(message: string): void {
  problems.push(message);
}

function check(condition: boolean, message: string): void {
  if (!condition) fail(message);
}

async function readJson<T>(name: string): Promise<T> {
  const text = await readFile(join(GENERATED_DIR, name), 'utf8');
  return JSON.parse(text) as T;
}

function neighborsFrom(
  edges: readonly (readonly [string, string])[],
  ids: readonly string[],
): Map<string, string[]> {
  const map = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [a, b] of edges) {
    map.get(a)?.push(b);
    map.get(b)?.push(a);
  }
  return map;
}

function component(start: string, neighbors: ReadonlyMap<string, readonly string[]>): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const next of neighbors.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/**
 * Comprueba una longitud contra una caja DESENROLLADA, probando tambien los
 * desplazamientos de +-360 que usan los territorios que cruzan el antimeridiano.
 */
function withinUnwrappedLongitude(lon: number, minLon: number, maxLon: number): boolean {
  return [lon, lon + 360, lon - 360].some(
    (candidate) => candidate >= minLon - 1 && candidate <= maxLon + 1,
  );
}

async function main(): Promise<void> {
  const config = loadMapConfig(CONFIG_PATH);
  const ids = config.territories.map((territory) => territory.id);

  const [adjacency, territories] = await Promise.all([
    readJson<AdjacencyFile>(ADJACENCY_FILE),
    readJson<TerritoriesFile>(TERRITORIES_INDEX_FILE),
  ]);
  const fronts = await readJson<FrontsFile>(FRONTS_FILE);

  // --- Topologia de salida presente -----------------------------------------
  const topologyText = await readFile(join(GENERATED_DIR, TERRITORIES_TOPOLOGY_FILE), 'utf8');
  const topology = JSON.parse(topologyText) as {
    objects?: Record<string, { geometries?: readonly { id?: string }[] }>;
  };
  const topoGeometries = topology.objects?.['territories']?.geometries ?? [];
  check(
    topoGeometries.length === ids.length,
    `el TopoJSON tiene ${topoGeometries.length} geometrias y se esperaban ${ids.length}`,
  );

  // --- Cobertura del indice y la adyacencia ---------------------------------
  const indexIds = territories.territories.map((territory) => territory.id).sort();
  check(
    JSON.stringify(indexIds) === JSON.stringify([...ids].sort()),
    'territories.json no cubre exactamente los ids de la config',
  );
  const adjacencyIds = Object.keys(adjacency.byTerritory).sort();
  check(
    JSON.stringify(adjacencyIds) === JSON.stringify([...ids].sort()),
    'adjacency.json no cubre exactamente los ids de la config',
  );

  // --- Simetria y consistencia de aristas -----------------------------------
  const edgeKeys = new Set<string>();
  for (const [a, b] of adjacency.edges) {
    check(a !== b, `autolazo en la adyacencia: ${a}`);
    const key = pairKey(a, b);
    check(!edgeKeys.has(key), `arista duplicada: ${a} - ${b}`);
    edgeKeys.add(key);
    check((adjacency.byTerritory[a] ?? []).includes(b), `byTerritory[${a}] no incluye ${b}`);
    check((adjacency.byTerritory[b] ?? []).includes(a), `byTerritory[${b}] no incluye ${a}`);
  }

  const neighbors = neighborsFrom(adjacency.edges, ids);

  // --- Sin huerfanos ---------------------------------------------------------
  for (const id of ids) {
    check((neighbors.get(id) ?? []).length > 0, `territorio huerfano (grado 0): ${id}`);
  }

  // --- Conexion del grafo ----------------------------------------------------
  const first = ids[0];
  if (first !== undefined) {
    const reachable = component(first, neighbors);
    check(
      reachable.size === ids.length,
      `el grafo no es conexo: se alcanzan ${reachable.size} de ${ids.length} territorios`,
    );
  }

  // --- Contigüidad de cada continente (contando enlaces) ---------------------
  for (const continent of config.continents) {
    const members = config.territories
      .filter((territory) => territory.continent === continent.id)
      .map((territory) => territory.id);
    check(members.length > 0, `continente sin territorios: ${continent.id}`);
    const memberSet = new Set(members);
    const intra = new Map<string, string[]>(
      members.map((id) => [id, (neighbors.get(id) ?? []).filter((n) => memberSet.has(n))]),
    );
    const start = members[0];
    if (start === undefined) continue;
    const reachable = component(start, intra);
    check(
      reachable.size === members.length,
      `continente no contiguo: ${continent.id} (${reachable.size}/${members.length})`,
    );
  }

  // --- Nombres en todos los idiomas -----------------------------------------
  for (const territory of config.territories) {
    for (const locale of LOCALES) {
      check(
        (territory.names[locale] ?? '').trim().length > 0,
        `falta el nombre en ${locale}: ${territory.id}`,
      );
    }
  }
  for (const continent of config.continents) {
    for (const locale of LOCALES) {
      check(
        (continent.names[locale] ?? '').trim().length > 0,
        `falta el nombre del continente en ${locale}: ${continent.id}`,
      );
    }
  }

  // --- Coincidencia exacta con el tablero clasico ---------------------------
  const expected = new Set(classicBoardEdges().map(([a, b]) => pairKey(a, b)));
  const missing = [...expected].filter((key) => !edgeKeys.has(key));
  const extra = [...edgeKeys].filter((key) => !expected.has(key));
  check(
    missing.length === 0,
    `faltan ${missing.length} aristas del tablero clasico: ${missing.join(', ')}`,
  );
  check(
    extra.length === 0,
    `sobran ${extra.length} aristas respecto del tablero clasico: ${extra.join(', ')}`,
  );

  // --- Enlaces y exclusiones con efecto real --------------------------------
  const landKeys = new Set(adjacency.landBorders.map(([a, b]) => pairKey(a, b)));
  for (const [a, b] of adjacency.links) {
    check(edgeKeys.has(pairKey(a, b)), `enlace declarado sin efecto en el grafo: ${a} - ${b}`);
    check(
      !landKeys.has(pairKey(a, b)),
      `el enlace ${a} - ${b} tambien figura como frontera terrestre`,
    );
  }
  for (const [a, b] of adjacency.ignoredLandBorders) {
    check(
      !edgeKeys.has(pairKey(a, b)),
      `la exclusion ${a} - ${b} no tuvo efecto (sigue en el grafo)`,
    );
  }

  // --- Anclas de frente -----------------------------------------------------
  const bboxById = new Map(
    territories.territories.map((territory) => [territory.id, territory.bbox]),
  );
  const anchorKeys = new Set<string>();
  const linkKeys = new Set(adjacency.links.map(([a, b]) => pairKey(a, b)));

  for (const anchor of fronts.fronts) {
    const key = pairKey(anchor.a, anchor.b);
    check(!anchorKeys.has(key), `ancla de frente duplicada: ${anchor.a} - ${anchor.b}`);
    anchorKeys.add(key);

    check(
      edgeKeys.has(key),
      `ancla de frente para una arista inexistente: ${anchor.a} - ${anchor.b}`,
    );

    const expectedKind = linkKeys.has(key) ? 'sea' : 'land';
    check(
      anchor.kind === expectedKind,
      `tipo de ancla incorrecto en ${anchor.a} - ${anchor.b}: ${anchor.kind}, se esperaba ${expectedKind}`,
    );

    check(anchor.lengthKm > 0, `longitud de frente nula en ${anchor.a} - ${anchor.b}`);

    const normalLength = Math.hypot(anchor.normal[0], anchor.normal[1]);
    check(
      Math.abs(normalLength - 1) < 0.01,
      `la normal de ${anchor.a} - ${anchor.b} no es unitaria (${normalLength.toFixed(3)})`,
    );

    if (anchor.kind === 'sea') {
      check(
        anchor.coastA !== null && anchor.coastB !== null,
        `el enlace maritimo ${anchor.a} - ${anchor.b} no trae puntos de costa`,
      );
      // El punto medio de un corredor maritimo cae en el agua a proposito: lo
      // que tiene que caer dentro de cada territorio son los puntos de costa.
      const bboxA = bboxById.get(anchor.a);
      const bboxB = bboxById.get(anchor.b);
      const near = (
        coast: readonly [number, number] | null,
        bbox: readonly [number, number, number, number] | undefined,
      ): boolean =>
        coast !== null &&
        bbox !== undefined &&
        withinUnwrappedLongitude(coast[0], bbox[0], bbox[2]) &&
        coast[1] >= bbox[1] - 2 &&
        coast[1] <= bbox[3] + 2;
      check(near(anchor.coastA, bboxA), `la costa de ${anchor.a} cae fuera de su bbox`);
      check(near(anchor.coastB, bboxB), `la costa de ${anchor.b} cae fuera de su bbox`);
    } else {
      check(
        anchor.coastA === null && anchor.coastB === null,
        `la frontera terrestre ${anchor.a} - ${anchor.b} no deberia traer costas`,
      );
      const nearA = bboxById.get(anchor.a);
      const nearB = bboxById.get(anchor.b);
      const within = (bbox: readonly [number, number, number, number] | undefined): boolean =>
        bbox !== undefined &&
        withinUnwrappedLongitude(anchor.point[0], bbox[0], bbox[2]) &&
        anchor.point[1] >= bbox[1] - 2 &&
        anchor.point[1] <= bbox[3] + 2;
      check(
        within(nearA) || within(nearB),
        `el punto de frente de ${anchor.a} - ${anchor.b} cae fuera de ambos territorios`,
      );
    }
  }

  for (const [a, b] of adjacency.edges) {
    const key = pairKey(a, b);
    check(anchorKeys.has(key), `falta el ancla de frente de ${a} - ${b}`);
  }

  // --- Geometria valida ------------------------------------------------------
  for (const territory of territories.territories) {
    const [minLon, minLat, maxLon, maxLat] = territory.bbox;
    check(minLon <= maxLon, `bbox invalida en longitud: ${territory.id}`);
    check(minLat <= maxLat, `bbox invalida en latitud: ${territory.id}`);
    check(
      withinUnwrappedLongitude(territory.centroid[0], minLon, maxLon),
      `centroide fuera de la bbox: ${territory.id}`,
    );
    check(
      withinUnwrappedLongitude(territory.labelAnchor[0], minLon, maxLon),
      `ancla de etiqueta fuera de la bbox: ${territory.id}`,
    );
    check(
      territory.crossesAntimeridian === (maxLon > 180 || minLon < -180),
      `bandera de antimeridiano inconsistente: ${territory.id}`,
    );
    check(territory.areaKm2 > 0, `area nula: ${territory.id}`);
    check(territory.polygonCount > 0, `sin poligonos: ${territory.id}`);
    check(
      territory.degree === (neighbors.get(territory.id) ?? []).length,
      `grado desactualizado en ${territory.id}`,
    );
  }

  // --- Informe ---------------------------------------------------------------
  if (problems.length > 0) {
    console.error(`[map:validate] FALLO con ${problems.length} problema(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  const grados = ids.map((id) => (neighbors.get(id) ?? []).length);
  const promedio = grados.reduce((total, value) => total + value, 0) / grados.length;

  console.log('[map:validate] OK');
  console.log(`  territorios      : ${ids.length}`);
  console.log(`  aristas          : ${adjacency.edges.length}`);
  console.log(`  enlaces no terr. : ${adjacency.links.length}`);
  console.log(`  fronteras terr.  : ${adjacency.landBorders.length}`);
  console.log(`  exclusiones      : ${adjacency.ignoredLandBorders.length}`);
  console.log(
    `  anclas de frente : ${fronts.fronts.length} (${fronts.fronts.filter((a) => a.kind === 'sea').length} maritimas)`,
  );
  console.log(`  grado promedio   : ${promedio.toFixed(2)}`);
  console.log(`  topojson         : ${(topologyText.length / 1024).toFixed(1)} KB`);
}

main().catch((error: unknown) => {
  console.error('[map:validate] error:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
