/**
 * Anclas de frente.
 *
 * El campo de batalla no se ubica en los centroides de los territorios sino en
 * el borde entre ellos. Este modulo, a partir de la topologia final ya
 * simplificada, calcula por cada arista del grafo:
 *
 *   - `point`      punto medio del tramo mas largo de frontera compartida
 *   - `normal`     direccion unitaria del territorio `a` hacia el `b`
 *   - `lengthKm`   longitud de ese tramo
 *
 * Y para los enlaces maritimos, donde no hay frontera compartida:
 *
 *   - `coastA` / `coastB`  el punto de costa de cada territorio mas cercano al
 *                          otro, y el corredor maritimo entre ambos
 *
 * La topologia guarda los arcos en coordenadas cuantizadas y delta-encoded, asi
 * que aca se los devuelve a lon/lat antes de medir nada.
 */

import { geoDistance, geoInterpolate } from 'd3-geo';
import type { TerritoryPair } from '@conqueror/map-data';
import type { TerritoryId } from '@conqueror/shared';

/** Radio terrestre medio en km (IUGG). */
const EARTH_RADIUS_KM = 6371.0088;

interface QuantizedTransform {
  readonly scale: readonly [number, number];
  readonly translate: readonly [number, number];
}

interface TopoGeometryLike {
  readonly id?: string | number;
  readonly arcs?: unknown;
}

interface TopologyLike {
  readonly arcs: readonly (readonly (readonly number[])[])[];
  readonly transform?: QuantizedTransform;
  readonly objects: Record<string, { readonly geometries: readonly TopoGeometryLike[] }>;
}

/** Resultado por arista. */
export interface FrontAnchor {
  readonly a: TerritoryId;
  readonly b: TerritoryId;
  readonly kind: 'land' | 'sea';
  readonly point: readonly [number, number];
  readonly normal: readonly [number, number];
  readonly lengthKm: number;
  readonly coastA: readonly [number, number] | null;
  readonly coastB: readonly [number, number] | null;
}

/** Punto `[lon, lat]`. Tupla mutable porque d3-geo no acepta tuplas readonly. */
type Point = [number, number];

/**
 * Devuelve los puntos de un arco en lon/lat.
 * Los indices negativos significan "el arco al reves" (codificacion TopoJSON:
 * `~i` es el indice real).
 */
function arcPoints(topology: TopologyLike, index: number): Point[] {
  const reversed = index < 0;
  const arc = topology.arcs[reversed ? ~index : index];
  if (arc === undefined) return [];

  const transform = topology.transform;
  const scaleX = transform?.scale[0] ?? 1;
  const scaleY = transform?.scale[1] ?? 1;
  const translateX = transform?.translate[0] ?? 0;
  const translateY = transform?.translate[1] ?? 0;

  const points: Point[] = [];
  let x = 0;
  let y = 0;
  for (const delta of arc) {
    x += delta[0] ?? 0;
    y += delta[1] ?? 0;
    points.push([x * scaleX + translateX, y * scaleY + translateY]);
  }
  if (reversed) points.reverse();
  return points;
}

/**
 * Todos los indices de arco REALES que usa una geometria.
 *
 * En TopoJSON un MultiPolygon guarda `arcs` como poligono -> anillo -> indices,
 * y cada anillo puede encadenar varios arcos. Un indice negativo `i` no es "el
 * arco |i|": significa el arco `~i` (o sea `-i - 1`) recorrido al reves. Usar
 * `Math.abs()` aca leeria arcos ajenos y es un error silencioso.
 */
function geometryArcIndices(geometry: TopoGeometryLike): number[] {
  const out: number[] = [];
  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;
    if (node.every((item) => typeof item === 'number')) {
      for (const item of node) {
        const value = item as number;
        out.push(value < 0 ? ~value : value);
      }
      return;
    }
    for (const child of node) walk(child);
  };
  walk(geometry.arcs);
  return out;
}

function polylineLengthKm(points: readonly Point[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous === undefined || current === undefined) continue;
    total += geoDistance(previous, current) * EARTH_RADIUS_KM;
  }
  return total;
}

/** Punto y direccion en el medio de una polilinea (por longitud acumulada). */
function midpointOf(points: readonly Point[]): { point: Point; direction: Point } | null {
  if (points.length < 2) return null;

  const segments: number[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous === undefined || current === undefined) continue;
    const length = geoDistance(previous, current);
    segments.push(length);
    total += length;
  }
  if (total === 0) return null;

  let travelled = 0;
  const half = total / 2;
  for (let index = 0; index < segments.length; index += 1) {
    const length = segments[index] ?? 0;
    if (travelled + length >= half) {
      const from = points[index];
      const to = points[index + 1];
      if (from === undefined || to === undefined) break;
      const ratio = length === 0 ? 0 : (half - travelled) / length;
      const point: Point = [
        from[0] + (to[0] - from[0]) * ratio,
        from[1] + (to[1] - from[1]) * ratio,
      ];
      const direction = unitVector(from, to);
      return { point, direction };
    }
    travelled += length;
  }

  const last = points[points.length - 1];
  const beforeLast = points[points.length - 2];
  if (last === undefined || beforeLast === undefined) return null;
  return { point: last, direction: unitVector(beforeLast, last) };
}

function unitVector(from: Point, to: Point): Point {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return [1, 0];
  return [dx / length, dy / length];
}

/** Gira una direccion 90 grados y la orienta hacia el punto de referencia. */
function perpendicularTowards(direction: Point, from: Point, towards: Point): Point {
  const candidates: Point[] = [
    [-direction[1], direction[0]],
    [direction[1], -direction[0]],
  ];
  const toReference: Point = [towards[0] - from[0], towards[1] - from[1]];
  let best = candidates[0] ?? [0, 1];
  let bestDot = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const dot = candidate[0] * toReference[0] + candidate[1] * toReference[1];
    if (dot > bestDot) {
      bestDot = dot;
      best = candidate;
    }
  }
  return best;
}

/** Punto del contorno mas cercano a una referencia. */
function closestBoundaryPoint(points: readonly Point[], reference: Point): Point | null {
  let best: Point | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const point of points) {
    const distance = geoDistance(point, reference);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best;
}

export interface FrontAnchorsInput {
  readonly topology: unknown;
  readonly objectName: string;
  /** Id de cada geometria, en el orden del objeto de la topologia. */
  readonly geometryIds: readonly TerritoryId[];
  /** Aristas del grafo, ya normalizadas. */
  readonly edges: readonly TerritoryPair[];
  /** Claves `a|b` normalizadas de los enlaces maritimos. */
  readonly seaLinkKeys: ReadonlySet<string>;
  /** Centroides por territorio, `[lon, lat]`. */
  readonly centroids: ReadonlyMap<TerritoryId, Point>;
}

/**
 * Calcula el ancla de cada arista del grafo.
 * Lanza si falta una geometria o un centroide: el build no debe seguir.
 */
export function computeFrontAnchors(input: FrontAnchorsInput): FrontAnchor[] {
  const topology = input.topology as TopologyLike;
  const object = topology.objects[input.objectName];
  if (object === undefined) {
    throw new Error(`La topologia no tiene el objeto "${input.objectName}"`);
  }

  // Puntos de arco y contornos por geometria, calculados una sola vez.
  const arcCache = new Map<number, Point[]>();
  const arcsOf = (index: number): Point[] => {
    const cached = arcCache.get(index);
    if (cached !== undefined) return cached;
    const points = arcPoints(topology, index);
    arcCache.set(index, points);
    return points;
  };

  const indexById = new Map<TerritoryId, number>();
  input.geometryIds.forEach((id, index) => indexById.set(id, index));

  const arcIndicesById = new Map<TerritoryId, Set<number>>();
  const boundaryById = new Map<TerritoryId, Point[]>();

  // Se indexa por el `id` que trae la propia topologia, no por posicion: es la
  // unica correspondencia que no depende del orden en que se serializo.
  for (const geometry of object.geometries) {
    const id = geometry.id === undefined ? '' : String(geometry.id);
    if (id === '') {
      throw new Error('Hay una geometria sin id en la topologia');
    }
    if (!indexById.has(id)) {
      throw new Error(`La topologia trae una geometria desconocida: ${id}`);
    }

    const indices = geometryArcIndices(geometry);
    arcIndicesById.set(id, new Set(indices));

    const boundary: Point[] = [];
    for (const arcIndex of new Set(indices)) {
      boundary.push(...arcsOf(arcIndex));
    }
    boundaryById.set(id, boundary);
  }

  for (const id of input.geometryIds) {
    if (!arcIndicesById.has(id)) {
      throw new Error(`Falta la geometria de ${id} en la topologia`);
    }
  }

  const anchors: FrontAnchor[] = [];

  for (const [a, b] of input.edges) {
    const centroidA = input.centroids.get(a);
    const centroidB = input.centroids.get(b);
    if (centroidA === undefined || centroidB === undefined) {
      throw new Error(`Falta el centroide de ${a} o ${b}`);
    }

    const arcsA = arcIndicesById.get(a);
    const arcsB = arcIndicesById.get(b);
    if (arcsA === undefined || arcsB === undefined) {
      throw new Error(`Falta el indice de arcos de ${a} o ${b}`);
    }

    const isSea = input.seaLinkKeys.has(`${a}|${b}`);

    if (!isSea) {
      // Camino normal: la frontera comun son arcos compartidos por ambas
      // geometrias. Se elige el tramo mas largo.
      const shared: number[] = [];
      for (const index of arcsA) {
        if (arcsB.has(index)) shared.push(index);
      }

      if (shared.length > 0) {
        let bestPoints: Point[] = [];
        let bestLength = -1;
        for (const index of shared) {
          const points = arcsOf(index);
          const length = polylineLengthKm(points);
          if (length > bestLength) {
            bestLength = length;
            bestPoints = points;
          }
        }

        const middle = midpointOf(bestPoints);
        if (middle !== null) {
          anchors.push({
            a,
            b,
            kind: 'land',
            point: middle.point,
            normal: perpendicularTowards(middle.direction, middle.point, centroidB),
            lengthKm: Math.max(1, Math.round(polylineLengthKm(bestPoints))),
            coastA: null,
            coastB: null,
          });
          continue;
        }
      }

      // Respaldo: despues de simplificar, dos geometrias pueden tocarse sin
      // compartir un arco entero (el empalme quedo partido distinto de cada
      // lado). En ese caso la frontera se aproxima por el par de puntos de
      // contorno mas cercanos entre ambos territorios.
      const contactA = closestBoundaryPoint(boundaryById.get(a) ?? [], centroidB);
      if (contactA !== null) {
        const contactB = closestBoundaryPoint(boundaryById.get(b) ?? [], contactA);
        if (contactB !== null) {
          const point = geoInterpolate(contactA, contactB)(0.5) as [number, number];
          const gapKm = geoDistance(contactA, contactB) * EARTH_RADIUS_KM;
          anchors.push({
            a,
            b,
            kind: 'land',
            point: [point[0], point[1]],
            normal: unitVector(contactA, contactB),
            lengthKm: Math.max(1, Math.round(gapKm)),
            coastA: null,
            coastB: null,
          });
          continue;
        }
      }
    }

    // Enlace maritimo: corredor entre los puntos de costa mas cercanos.
    const coastA = closestBoundaryPoint(boundaryById.get(a) ?? [], centroidB);
    const coastB = closestBoundaryPoint(boundaryById.get(b) ?? [], centroidA);
    if (coastA === null || coastB === null) {
      throw new Error(`No se pudo calcular el corredor entre ${a} y ${b}`);
    }

    const point = geoInterpolate(coastA, coastB)(0.5) as [number, number];
    anchors.push({
      a,
      b,
      kind: 'sea',
      point: [point[0], point[1]],
      normal: unitVector(coastA, coastB),
      lengthKm: Math.max(1, Math.round(geoDistance(coastA, coastB) * EARTH_RADIUS_KM)),
      coastA: [coastA[0], coastA[1]],
      coastB: [coastB[0], coastB[1]],
    });
  }

  return anchors;
}
