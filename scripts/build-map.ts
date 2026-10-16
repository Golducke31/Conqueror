/**
 * Pipeline del tablero.
 *
 * Lee Natural Earth 50m, fusiona las geometrias de cada territorio, absorbe los
 * paises sin asignar para que el mapa no quede con huecos, simplifica
 * manteniendo topologia compartida (TopoJSON) y exporta:
 *   - generated/territories.topojson.json  (geometria para el cliente)
 *   - generated/territories.json           (indice: centroide, bbox, ancla, area)
 *   - generated/adjacency.json             (grafo de reglas)
 *
 * El grafo se DERIVA de la geometria + los `seaLinks` de la config, y se
 * reconcilia con la matriz clasica del tablero. Si no coincide, el build falla
 * (o con `--suggest` imprime las entradas listas para pegar en la config).
 *
 * Ver docs/adr/0004-datos-de-mapa-natural-earth.md
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { geoArea, geoCentroid } from 'd3-geo';
import type {
  Feature,
  FeatureCollection,
  GeoJsonObject,
  GeoJsonProperties,
  MultiPolygon,
  Polygon,
} from 'geojson';
import {
  feature as topoFeature,
  merge as topoMerge,
  neighbors as topoNeighbors,
  quantize as topoQuantize,
} from 'topojson-client';
import { topology as topoTopology } from 'topojson-server';
import { presimplify as topoPresimplify, simplify as topoSimplify } from 'topojson-simplify';

import {
  ADJACENCY_FILE,
  FRONTS_FILE,
  TERRITORIES_INDEX_FILE,
  TERRITORIES_TOPOLOGY_FILE,
  classicBoardEdges,
  normalizePair,
  pairKey,
} from '@conqueror/map-data';
import { loadMapConfig } from '@conqueror/map-data/node';
import type {
  AdjacencyFile,
  FrontAnchor,
  FrontsFile,
  MapConfig,
  TerritoryConfigEntry,
  TerritoriesFile,
  TerritoryGeometry,
  TerritoryPair,
} from '@conqueror/map-data';
import type { LocalizedNames } from '@conqueror/shared';
import { computeFrontAnchors } from './lib/front-anchors.js';

// ---------------------------------------------------------------------------
// Rutas y constantes
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(REPO_ROOT, 'packages', 'map-data', 'territories.config.json');
const GENERATED_DIR = join(REPO_ROOT, 'packages', 'map-data', 'generated');
const CLIENT_PUBLIC_DIR = join(REPO_ROOT, 'apps', 'client', 'public', 'map');

/** Radio terrestre medio en km (IUGG). */
const EARTH_RADIUS_KM = 6371.0088;

/** Paises que nunca entran al tablero. */
const EXCLUDED_ADM0 = new Set(['ATA']);

const suggestMode = process.argv.includes('--suggest');

// ---------------------------------------------------------------------------
// Tipos estructurales minimos de TopoJSON
// ---------------------------------------------------------------------------

interface TopoGeometry {
  readonly id?: string | number;
  readonly type: string;
  readonly arcs?: unknown;
  readonly properties?: Record<string, unknown>;
}

interface TopoObject {
  readonly type: string;
  readonly geometries: readonly TopoGeometry[];
}

interface TopoLike {
  readonly type: 'Topology';
  readonly objects: Record<string, TopoObject>;
  readonly arcs: readonly unknown[];
}

type AnyFeature = Feature<Polygon | MultiPolygon, GeoJsonProperties>;

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function areaKm2(geometry: Polygon | MultiPolygon): number {
  return geoArea(geometry) * EARTH_RADIUS_KM * EARTH_RADIUS_KM;
}

function toMultiPolygon(geometry: Polygon | MultiPolygon): MultiPolygon {
  return geometry.type === 'MultiPolygon'
    ? geometry
    : { type: 'MultiPolygon', coordinates: [geometry.coordinates] };
}

/** Poligono de mayor superficie de un MultiPolygon. */
function largestPolygon(multi: MultiPolygon): Polygon | null {
  let best: Polygon | null = null;
  let bestArea = -1;
  for (const coordinates of multi.coordinates) {
    const polygon: Polygon = { type: 'Polygon', coordinates };
    const area = areaKm2(polygon);
    if (area > bestArea) {
      bestArea = area;
      best = polygon;
    }
  }
  return best;
}

/** Descarta islas por debajo del minimo, conservando siempre la principal. */
function filterSmallPolygons(multi: MultiPolygon, minAreaKm2: number): MultiPolygon {
  const kept = multi.coordinates.filter(
    (coordinates) => areaKm2({ type: 'Polygon', coordinates }) >= minAreaKm2,
  );
  if (kept.length === 0) {
    const main = largestPolygon(multi);
    return main === null ? multi : { type: 'MultiPolygon', coordinates: [main.coordinates] };
  }
  return { type: 'MultiPolygon', coordinates: kept };
}

/** Quita puntos consecutivos repetidos. */
function dedupeRing(ring: readonly (readonly number[])[]): number[][] {
  const out: number[][] = [];
  for (const point of ring) {
    const last = out[out.length - 1];
    if (last !== undefined && last[0] === point[0] && last[1] === point[1]) continue;
    out.push([point[0] as number, point[1] as number]);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first !== undefined && last !== undefined) {
    if (first[0] === last[0] && first[1] === last[1] && out.length > 1) out.pop();
    out.push([first[0] as number, first[1] as number]);
  }
  return out;
}

/**
 * Sanea un poligono tras la simplificacion.
 *
 * Dos problemas reales que aparecen al simplificar a escala mundial:
 *  1. Las islas chicas colapsan en anillos degenerados (todos los puntos en la
 *     misma coordenada). Se descartan.
 *  2. La simplificacion puede invertir el sentido de un anillo. d3-geo
 *     interpreta un anillo invertido como "el complemento del globo" y pinta
 *     todo el mapamundi. Se corrige comparando el area esferica con media
 *     esfera: si la supera, el anillo esta al reves.
 *
 * Devuelve `null` si el poligono no sobrevive.
 */
function sanitizePolygon(
  coordinates: readonly (readonly (readonly number[])[])[],
  minAreaKm2: number,
): number[][][] | null {
  const rings = coordinates.map((ring) => dedupeRing(ring)).filter((ring) => ring.length >= 4);
  if (rings.length === 0) return null;

  const polygon: Polygon = { type: 'Polygon', coordinates: rings };
  const area = areaKm2(polygon);
  if (area < minAreaKm2) return null;

  // Mas de media esfera solo puede significar un anillo invertido.
  if (geoArea(polygon) > 2 * Math.PI) {
    return rings.map((ring) => [...ring].reverse());
  }
  return rings;
}

/** Aplica el saneamiento a toda la coleccion. */
function sanitizeCollection(
  features: readonly Feature<MultiPolygon, GeoJsonProperties>[],
  minAreaKm2: number,
): Feature<MultiPolygon, GeoJsonProperties>[] {
  const out: Feature<MultiPolygon, GeoJsonProperties>[] = [];
  for (const item of features) {
    const polygons = item.geometry.coordinates
      .map((coordinates) => sanitizePolygon(coordinates, minAreaKm2))
      .filter((coordinates): coordinates is number[][][] => coordinates !== null);
    if (polygons.length === 0) continue;
    out.push({
      type: 'Feature',
      ...(item.id !== undefined ? { id: item.id } : {}),
      properties: item.properties,
      geometry: { type: 'MultiPolygon', coordinates: polygons },
    });
  }
  return out;
}

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

const DEG2RAD = Math.PI / 180;

interface UnwrappedBounds {
  readonly bbox: readonly [number, number, number, number];
  readonly crossesAntimeridian: boolean;
}

/**
 * Caja envolvente con la longitud DESENROLLADA.
 *
 * Natural Earth corta los poligonos en el antimeridiano, asi que un territorio
 * como Kamchatka (que incluye Chukotka) tiene puntos cerca de +180 y cerca de
 * -180. Una caja `[min, max]` ingenua quedaria invertida. Aca se toma la
 * longitud media circular como referencia y se desplazan los puntos +-360 hasta
 * caer dentro de +-180 de esa referencia, de modo que el rectangulo sea valido.
 */
function unwrappedBounds(multi: MultiPolygon): UnwrappedBounds {
  let sumSin = 0;
  let sumCos = 0;
  let count = 0;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const polygon of multi.coordinates) {
    for (const ring of polygon) {
      for (const point of ring) {
        const lon = point[0];
        const lat = point[1];
        if (typeof lon !== 'number' || typeof lat !== 'number') continue;
        sumSin += Math.sin(lon * DEG2RAD);
        sumCos += Math.cos(lon * DEG2RAD);
        count += 1;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }

  if (count === 0) {
    return { bbox: [0, 0, 0, 0], crossesAntimeridian: false };
  }

  const meanLon = Math.atan2(sumSin / count, sumCos / count) / DEG2RAD;

  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;

  for (const polygon of multi.coordinates) {
    for (const ring of polygon) {
      for (const point of ring) {
        const lon = point[0];
        if (typeof lon !== 'number') continue;
        let shifted = lon;
        while (shifted - meanLon > 180) shifted -= 360;
        while (meanLon - shifted > 180) shifted += 360;
        if (shifted < minLon) minLon = shifted;
        if (shifted > maxLon) maxLon = shifted;
      }
    }
  }

  return {
    bbox: [round(minLon), round(minLat), round(maxLon), round(maxLat)],
    crossesAntimeridian: maxLon > 180 || minLon < -180,
  };
}

function roundPair(point: readonly [number, number]): readonly [number, number] {
  return [round(point[0], 4), round(point[1], 4)];
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function pairList(items: Iterable<readonly [string, string]>): TerritoryPair[] {
  const seen = new Map<string, TerritoryPair>();
  for (const [a, b] of items) {
    const pair = normalizePair(a, b);
    seen.set(pairKey(pair[0], pair[1]), pair);
  }
  return [...seen.values()].sort((x, y) =>
    x[0] === y[0] ? x[1].localeCompare(y[1]) : x[0].localeCompare(y[0]),
  );
}

// ---------------------------------------------------------------------------
// Lectura de datos
// ---------------------------------------------------------------------------

async function readGeoJson(path: string): Promise<FeatureCollection> {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text) as FeatureCollection;
}

/** Codigo ISO_A3 efectivo de un pais de admin_0. */
function admin0Code(feature: AnyFeature): string {
  const props = feature.properties ?? {};
  const iso = typeof props['ISO_A3'] === 'string' ? props['ISO_A3'] : '';
  if (iso !== '' && iso !== '-99' && iso !== '-099') return iso;
  const adm0 = typeof props['ADM0_A3'] === 'string' ? props['ADM0_A3'] : '';
  return adm0;
}

function admin1Key(feature: AnyFeature): { code: string; name: string } {
  const props = feature.properties ?? {};
  const code = typeof props['adm0_a3'] === 'string' ? props['adm0_a3'] : '';
  const name = typeof props['name'] === 'string' ? props['name'] : '';
  return { code, name };
}

// ---------------------------------------------------------------------------
// Asignacion de geometrias a territorios
// ---------------------------------------------------------------------------

interface Assignment {
  readonly feature: AnyFeature;
  owner: string | null;
  readonly origin: 'adm0' | 'adm1';
}

function assignOwners(
  config: MapConfig,
  admin0: FeatureCollection,
  admin1: FeatureCollection,
): Assignment[] {
  const byCountry = new Map<string, TerritoryConfigEntry>();
  const bySubdivision = new Map<string, TerritoryConfigEntry>();
  const subdividedCountries = new Set<string>();

  for (const territory of config.territories) {
    for (const code of territory.source.countries ?? []) {
      if (byCountry.has(code)) {
        throw new Error(`El pais ${code} esta reclamado por dos territorios`);
      }
      byCountry.set(code, territory);
    }
    for (const [code, names] of Object.entries(territory.source.subdivisions ?? {})) {
      subdividedCountries.add(code);
      for (const name of names) {
        const key = `${code}|${name}`;
        if (bySubdivision.has(key)) {
          throw new Error(`La subdivision ${key} esta reclamada por dos territorios`);
        }
        bySubdivision.set(key, territory);
      }
    }
  }

  const assignments: Assignment[] = [];

  for (const feature of admin0.features) {
    const code = admin0Code(feature as AnyFeature);
    if (code === '' || EXCLUDED_ADM0.has(code)) continue;
    if (subdividedCountries.has(code)) continue; // se maneja por admin_1
    if (feature.geometry === null) continue;
    assignments.push({
      feature: feature as AnyFeature,
      owner: byCountry.get(code)?.id ?? null,
      origin: 'adm0',
    });
  }

  for (const feature of admin1.features) {
    const { code, name } = admin1Key(feature as AnyFeature);
    if (!subdividedCountries.has(code)) continue;
    if (feature.geometry === null) continue;
    assignments.push({
      feature: feature as AnyFeature,
      owner: bySubdivision.get(`${code}|${name}`)?.id ?? null,
      origin: 'adm1',
    });
  }

  return assignments;
}

/**
 * Absorbe las geometrias sin dueno en el territorio con el que comparten mas
 * arcos (frontera mas larga). Si no tiene vecinos asignados, usa el territorio
 * de centroide mas cercano.
 *
 * Esto evita huecos en el mapa: un pais que no es territorio jugable queda
 * dibujado dentro del territorio jugable mas proximo.
 */
function absorbUnassigned(
  assignments: Assignment[],
  featureNeighbors: readonly (readonly number[])[],
): number {
  let absorbed = 0;
  let pending = assignments.filter((item) => item.owner === null).length;

  // Se resuelve en pasadas: cada absorcion puede habilitar a las siguientes.
  while (pending > 0) {
    let progressed = false;
    for (let index = 0; index < assignments.length; index += 1) {
      const item = assignments[index];
      if (item === undefined || item.owner !== null) continue;

      const tally = new Map<string, number>();
      for (const neighborIndex of featureNeighbors[index] ?? []) {
        const neighbor = assignments[neighborIndex];
        if (neighbor === undefined || neighbor.owner === null) continue;
        tally.set(neighbor.owner, (tally.get(neighbor.owner) ?? 0) + 1);
      }

      if (tally.size === 0) continue;

      let bestOwner = '';
      let bestCount = -1;
      for (const [owner, count] of tally) {
        if (count > bestCount || (count === bestCount && owner < bestOwner)) {
          bestOwner = owner;
          bestCount = count;
        }
      }
      item.owner = bestOwner;
      absorbed += 1;
      pending -= 1;
      progressed = true;
    }
    if (!progressed) break;
  }

  // Los que siguen sin dueno (islas sin vecinos) van al centroide mas cercano.
  for (const item of assignments) {
    if (item.owner !== null) continue;
    const centroid = geoCentroid(item.feature as never);
    let bestOwner = '';
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const other of assignments) {
      if (other.owner === null) continue;
      const otherCentroid = geoCentroid(other.feature as never);
      const dx = centroid[0] - otherCentroid[0];
      const dy = centroid[1] - otherCentroid[1];
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestOwner = other.owner;
      }
    }
    if (bestOwner !== '') {
      item.owner = bestOwner;
      absorbed += 1;
    }
  }

  return absorbed;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function build(): Promise<void> {
  const config = loadMapConfig(CONFIG_PATH);
  const dataDir = join(REPO_ROOT, config.dataset.dir);

  console.log('[map:build] leyendo Natural Earth 50m...');
  const [admin0, admin1] = await Promise.all([
    readGeoJson(join(dataDir, config.dataset.admin0)),
    readGeoJson(join(dataDir, config.dataset.admin1)),
  ]);

  const assignments = assignOwners(config, admin0, admin1);
  console.log(
    `[map:build] ${assignments.length} geometrias de origen (${admin0.features.length} admin_0, ${admin1.features.length} admin_1)`,
  );

  // Topologia auxiliar solo para conocer vecindades entre geometrias de origen.
  const sourceCollection = {
    type: 'FeatureCollection',
    features: assignments.map((item) => item.feature),
  } as unknown as GeoJsonObject;
  const sourceTopology = topoTopology({ source: sourceCollection }, 1e5);
  const sourceTopo = sourceTopology as unknown as TopoLike;
  const sourceObject = sourceTopo.objects['source'];
  if (sourceObject === undefined) throw new Error('topology() no genero el objeto source');
  const featureNeighbors = topoNeighbors(sourceObject.geometries as never);

  const absorbed = config.build.absorbUnassigned
    ? absorbUnassigned(assignments, featureNeighbors)
    : 0;
  console.log(`[map:build] ${absorbed} geometrias sin dueno absorbidas por el vecino mas cercano`);

  const sinDueno = assignments.filter((item) => item.owner === null).length;
  if (sinDueno > 0) {
    throw new Error(`${sinDueno} geometrias quedaron sin dueno: revisar ` + '`absorbUnassigned`');
  }

  // Fusionar por territorio.
  const grouped = new Map<string, number[]>();
  assignments.forEach((item, index) => {
    const owner = item.owner;
    if (owner === null) return;
    const list = grouped.get(owner) ?? [];
    list.push(index);
    grouped.set(owner, list);
  });

  const mergedFeatures: Feature<MultiPolygon, GeoJsonProperties>[] = [];
  for (const territory of config.territories) {
    const indices = grouped.get(territory.id) ?? [];
    if (indices.length === 0) {
      throw new Error(`El territorio ${territory.id} no reclama ninguna geometria`);
    }
    const geometries = indices.map((index) => {
      const item = sourceObject.geometries[index];
      if (item === undefined) throw new Error(`Indice invalido ${index}`);
      return item as never;
    });

    const merged = topoMerge(sourceTopology as never, geometries) as Polygon | MultiPolygon | null;
    if (merged === null) {
      throw new Error(`No se pudo fusionar la geometria de ${territory.id}`);
    }

    const multi = filterSmallPolygons(toMultiPolygon(merged), config.build.minIslandAreaKm2);

    mergedFeatures.push({
      type: 'Feature',
      id: territory.id,
      properties: { id: territory.id, continent: territory.continent },
      geometry: multi,
    });
  }

  console.log(`[map:build] ${mergedFeatures.length} territorios fusionados, simplificando...`);

  // --- Paso 1: topologia con arcos compartidos + simplificacion ------------
  const quantization = config.build.quantization;
  const outputCollection = {
    type: 'FeatureCollection',
    features: mergedFeatures,
  } as unknown as GeoJsonObject;

  const roughTopology = topoTopology({ territories: outputCollection }, quantization);

  // `presimplify` calcula, para cada punto, el area del triangulo que forma con
  // sus vecinos, en GRADOS CUADRADOS (el peso por defecto es planarTriangleArea
  // sobre las coordenadas geograficas). La tolerancia de la config esta en
  // grados, asi que el peso minimo es su cuadrado.
  const toleranceQuantized = config.build.simplificationTolerance ** 2;

  const simplified = topoQuantize(
    topoSimplify(topoPresimplify(roughTopology as never) as never, toleranceQuantized) as never,
    quantization,
  ) as unknown as TopoLike;

  const simplifiedObject = simplified.objects['territories'];
  if (simplifiedObject === undefined) {
    throw new Error('topology() no genero el objeto territories');
  }

  // --- Paso 2: saneamiento -------------------------------------------------
  // La simplificacion puede dejar anillos degenerados o invertidos. Se limpian
  // antes de reconstruir la topologia definitiva.
  const roughFeatures = topoFeature(simplified as never, simplifiedObject as never) as unknown as
    FeatureCollection | Feature<MultiPolygon>;
  const roughList: Feature<MultiPolygon, GeoJsonProperties>[] =
    roughFeatures.type === 'FeatureCollection'
      ? (roughFeatures.features as Feature<MultiPolygon, GeoJsonProperties>[])
      : [roughFeatures as Feature<MultiPolygon, GeoJsonProperties>];

  const minPostAreaKm2 = config.build.minIslandAreaKm2 / 4;
  const cleanFeatures = sanitizeCollection(roughList, minPostAreaKm2);
  const keptIds = new Set(cleanFeatures.map((item) => item.id));
  const droppedIds = roughList
    .filter((item) => !keptIds.has(item.id))
    .map((item) => String(item.id));
  if (droppedIds.length > 0) {
    throw new Error(
      `el saneamiento elimino ${droppedIds.length} territorios completos ` +
        `(minPostAreaKm2=${minPostAreaKm2}): ${droppedIds.join(', ')}`,
    );
  }
  console.log(`[map:build] saneamiento aplicado a ${cleanFeatures.length} territorios`);

  // --- Paso 3: topologia final --------------------------------------------
  const cleanCollection = {
    type: 'FeatureCollection',
    features: cleanFeatures,
  } as unknown as GeoJsonObject;

  const finalTopology = topoTopology({ territories: cleanCollection }, quantization);
  const finalTopo = finalTopology as unknown as TopoLike;
  const finalObject = finalTopo.objects['territories'];
  if (finalObject === undefined) throw new Error('topology() no genero el objeto territories');

  // Adyacencia terrestre derivada de la topologia final.
  const finalNeighbors = topoNeighbors(finalObject.geometries as never);
  const landPairs = pairList(
    finalNeighbors.flatMap((neighborIndices, index) => {
      const from = mergedFeatures[index]?.id;
      if (typeof from !== 'string') return [];
      return neighborIndices
        .filter((other) => other > index)
        .flatMap((other) => {
          const to = mergedFeatures[other]?.id;
          return typeof to === 'string' ? [[from, to] as const] : [];
        });
    }),
  );

  // Enlaces no terrestres y exclusiones declaradas en la config.
  const linkPairs = pairList(
    config.territories.flatMap((territory) =>
      (territory.seaLinks ?? []).map((to) => [territory.id, to] as const),
    ),
  );
  const ignoreKeys = new Set(
    config.territories.flatMap((territory) =>
      (territory.ignoreLandBorders ?? []).map((to) => pairKey(territory.id, to)),
    ),
  );

  const ignoredLandBorders = landPairs.filter(([a, b]) => ignoreKeys.has(pairKey(a, b)));
  const effectiveLand = landPairs.filter(([a, b]) => !ignoreKeys.has(pairKey(a, b)));

  const edges = pairList([...effectiveLand, ...linkPairs]);

  // Reconciliacion con la matriz clasica.
  const expected = classicBoardEdges();
  const expectedKeys = new Set(expected.map(([a, b]) => pairKey(a, b)));
  const actualKeys = new Set(edges.map(([a, b]) => pairKey(a, b)));
  const missing = expected.filter(([a, b]) => !actualKeys.has(pairKey(a, b)));
  const extra = edges.filter(([a, b]) => !expectedKeys.has(pairKey(a, b)));

  if (missing.length > 0 || extra.length > 0) {
    reportarDesajuste(missing, extra, config);
    if (!suggestMode) {
      throw new Error(
        `El grafo derivado no coincide con el tablero clasico: ` +
          `faltan ${missing.length} aristas y sobran ${extra.length}. ` +
          'Corregir territories.config.json (seaLinks / ignoreLandBorders).',
      );
    }
  }

  // Indice de territorios.
  const degree = new Map<string, number>();
  for (const [a, b] of edges) {
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }

  const territoriesIndex: TerritoryGeometry[] = config.territories.map((territory) => {
    const merged = cleanFeatures.find((item) => item.id === territory.id);
    if (merged === undefined) throw new Error(`Falta la geometria de ${territory.id}`);
    const multi = merged.geometry;
    const main = largestPolygon(multi) ?? multi;

    const bounds = unwrappedBounds(multi);
    const centroid = roundPair(geoCentroid(multi));
    const anchor = roundPair(geoCentroid(main));

    return {
      id: territory.id,
      names: territory.names as LocalizedNames,
      continent: territory.continent,
      polygonCount: multi.coordinates.length,
      centroid,
      labelAnchor: anchor,
      bbox: bounds.bbox,
      crossesAntimeridian: bounds.crossesAntimeridian,
      areaKm2: Math.round(areaKm2(multi)),
      degree: degree.get(territory.id) ?? 0,
    };
  });

  // Anclas de frente: donde se pelea cada arista.
  const centroids = new Map<string, [number, number]>(
    territoriesIndex.map((territory) => [
      territory.id,
      [territory.centroid[0], territory.centroid[1]] as [number, number],
    ]),
  );
  const geometryIds = cleanFeatures.map((item) => String(item.id));

  const anchors: FrontAnchor[] = computeFrontAnchors({
    topology: finalTopo,
    objectName: 'territories',
    geometryIds,
    edges,
    seaLinkKeys: new Set(linkPairs.map(([a, b]) => pairKey(a, b))),
    centroids,
  });
  console.log(
    `[map:build] ${anchors.length} anclas de frente ` +
      `(${anchors.filter((anchor) => anchor.kind === 'sea').length} maritimas)`,
  );

  const generatedAt = new Date().toISOString();

  const territoriesFile: TerritoriesFile = {
    version: config.version,
    generatedAt,
    generator: 'scripts/build-map.ts',
    dataset: `Natural Earth ${config.dataset.scale} admin_0 + admin_1 (dominio publico)`,
    projectionNote:
      'Coordenadas geograficas [lon, lat] en EPSG:4326. La proyeccion a pantalla la resuelve el cliente con d3-geo (geoNaturalEarth1).',
    territories: territoriesIndex,
  };

  const adjacencyFile: AdjacencyFile = {
    version: config.version,
    generatedAt,
    generator: 'scripts/build-map.ts',
    edges,
    byTerritory: Object.fromEntries(
      config.territories.map((territory) => [
        territory.id,
        sortedUnique(
          edges.flatMap(([a, b]) => (a === territory.id ? [b] : b === territory.id ? [a] : [])),
        ),
      ]),
    ),
    links: linkPairs,
    landBorders: effectiveLand,
    ignoredLandBorders,
  };

  const frontsFile: FrontsFile = {
    version: config.version,
    generatedAt,
    generator: 'scripts/build-map.ts',
    fronts: anchors,
  };

  await mkdir(GENERATED_DIR, { recursive: true });
  await mkdir(CLIENT_PUBLIC_DIR, { recursive: true });

  const topologyJson = JSON.stringify(finalTopo);
  const indexJson = `${JSON.stringify(territoriesFile, null, 2)}\n`;
  const adjacencyJson = `${JSON.stringify(adjacencyFile, null, 2)}\n`;
  const frontsJson = `${JSON.stringify(frontsFile, null, 2)}\n`;

  for (const dir of [GENERATED_DIR, CLIENT_PUBLIC_DIR]) {
    await writeFile(join(dir, TERRITORIES_TOPOLOGY_FILE), topologyJson, 'utf8');
    await writeFile(join(dir, TERRITORIES_INDEX_FILE), indexJson, 'utf8');
    await writeFile(join(dir, ADJACENCY_FILE), adjacencyJson, 'utf8');
    await writeFile(join(dir, FRONTS_FILE), frontsJson, 'utf8');
  }

  const polygons = cleanFeatures.reduce(
    (total, item) => total + item.geometry.coordinates.length,
    0,
  );

  console.log('[map:build] listo');
  console.log(`  territorios      : ${cleanFeatures.length}`);
  console.log(`  poligonos        : ${polygons}`);
  console.log(
    `  aristas          : ${edges.length} (${effectiveLand.length} terrestres, ${linkPairs.length} enlaces)`,
  );
  console.log(`  topojson         : ${(topologyJson.length / 1024).toFixed(1)} KB`);
  console.log(`  indice           : ${(indexJson.length / 1024).toFixed(1)} KB`);
  console.log(`  adyacencia       : ${(adjacencyJson.length / 1024).toFixed(1)} KB`);
  console.log(`  frentes          : ${(frontsJson.length / 1024).toFixed(1)} KB`);
}

/** Imprime el desajuste con entradas listas para pegar en la config. */
function reportarDesajuste(
  missing: readonly TerritoryPair[],
  extra: readonly TerritoryPair[],
  config: MapConfig,
): void {
  console.warn('[map:build] el grafo derivado no coincide con el tablero clasico');

  if (missing.length > 0) {
    console.warn(`  faltan ${missing.length} aristas -> agregar como seaLinks:`);
    const byTerritory = new Map<string, string[]>();
    for (const [a, b] of missing) {
      const list = byTerritory.get(a) ?? [];
      list.push(b);
      byTerritory.set(a, list);
    }
    for (const [id, targets] of byTerritory) {
      console.warn(`    "${id}": seaLinks += ${JSON.stringify(targets)}`);
    }
  }

  if (extra.length > 0) {
    console.warn(`  sobran ${extra.length} aristas -> agregar como ignoreLandBorders:`);
    const byTerritory = new Map<string, string[]>();
    for (const [a, b] of extra) {
      const list = byTerritory.get(a) ?? [];
      list.push(b);
      byTerritory.set(a, list);
    }
    for (const [id, targets] of byTerritory) {
      console.warn(`    "${id}": ignoreLandBorders += ${JSON.stringify(targets)}`);
    }
  }

  const known = new Set(config.territories.map((territory) => territory.id));
  for (const [a, b] of [...missing, ...extra]) {
    if (!known.has(a) || !known.has(b)) {
      console.warn(`  ATENCION: par con id desconocido: ${a} - ${b}`);
    }
  }
}

build().catch((error: unknown) => {
  console.error('[map:build] error:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
