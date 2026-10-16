/**
 * Geometria del tablero.
 *
 * Todo el mundo se arma como UNA sola malla fusionada, no una por territorio:
 * 50 mallas serian 50 draw calls solo para el mapa. La malla fusionada lleva:
 *
 *   - `color`        color del dueno por vertice (o el color neutral)
 *   - `aTerritory`   indice de territorio por vertice
 *
 * Con `aTerritory` se resuelven dos cosas sin geometria extra:
 *   - el resaltado de hover/seleccion, descartando en el shader lo que no
 *     coincide (una segunda malla que comparte la misma geometria)
 *   - el picking exacto: `intersection.faceIndex` se traduce a territorio con
 *     una tabla plana, sin necesidad de color-ID offscreen
 */

import type { Feature, MultiLineString, MultiPolygon, Polygon } from 'geojson';
import type { Color } from 'three';
import { BufferGeometry, Float32BufferAttribute, Path, Shape, ShapeGeometry, Vector3 } from 'three';
import { ExtrudeGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { feature as topoFeature, mesh as topoMesh } from 'topojson-client';

import type { TerritoryId } from '@conqueror/shared';
import type { LoadedMapData } from './loadMapData.js';
import { createBoardProjection, type BoardProjection } from './projection.js';

/** Altura del relieve del tablero. */
export const RELIEF = 9;

/** Separacion entre el oceano y la base del relieve. */
const OCEAN_DROP = 2;

export interface BoardBuildOptions {
  /** Color de cada territorio segun su dueno. `null` = sin dueno. */
  readonly colorFor: (territory: TerritoryId) => Color | null;
  /** Color de los territorios sin dueno. */
  readonly neutralColor: Color;
  /** Color de las lineas de frontera. */
  readonly borderColor: Color;
  /** Color de las rutas maritimas. */
  readonly seaRouteColor: Color;
}

export interface BoardBuild {
  readonly projection: BoardProjection;
  /** Malla unica con todos los territorios. */
  readonly map: BufferGeometry;
  /** Fronteras y costas, como `LineSegments`. */
  readonly borders: BufferGeometry;
  /** Contorno del oceano. */
  readonly ocean: BufferGeometry;
  /** Rutas maritimas punteadas. */
  readonly seaRoutes: BufferGeometry;
  /** `faceIndex` -> indice de territorio. */
  readonly faceTerritory: Int32Array;
  /** Indice de territorio -> id. */
  readonly territoryIds: readonly TerritoryId[];
  readonly relief: number;
}

/** Agrega un anillo de lon/lat, ya proyectado, a un `Path`. */
function addRing(
  target: Path,
  projection: BoardProjection,
  ring: readonly (readonly number[])[],
): void {
  ring.forEach((point, index) => {
    const lon = point[0];
    const lat = point[1];
    if (typeof lon !== 'number' || typeof lat !== 'number') return;
    const world = projection.toWorld(lon, lat);
    // La Y del plano va invertida: al rotar -90 grados sobre X el norte cae en -Z.
    const x = world.x;
    const y = -world.z;
    if (index === 0) target.moveTo(x, y);
    else target.lineTo(x, y);
  });
  target.closePath();
}

function polygonToShapes(projection: BoardProjection, polygon: Polygon): Shape[] {
  const rings = polygon.coordinates;
  const outer = rings[0];
  if (outer === undefined || outer.length < 4) return [];

  const shape = new Shape();
  addRing(shape, projection, outer);

  for (let index = 1; index < rings.length; index += 1) {
    const ring = rings[index];
    if (ring === undefined || ring.length < 4) continue;
    const hole = new Path();
    addRing(hole, projection, ring);
    shape.holes.push(hole);
  }

  return [shape];
}

/** Convierte un MultiLineString en segmentos sueltos para `LineSegments`. */
function linesToSegments(lines: MultiLineString): Float32BufferAttribute {
  const positions: number[] = [];
  for (const line of lines.coordinates) {
    for (let index = 1; index < line.length; index += 1) {
      const from = line[index - 1];
      const to = line[index];
      if (from === undefined || to === undefined) continue;
      positions.push(from[0] ?? 0, 0, from[1] ?? 0);
      positions.push(to[0] ?? 0, 0, to[1] ?? 0);
    }
  }
  return new Float32BufferAttribute(positions, 3);
}

export function buildBoard(data: LoadedMapData, options: BoardBuildOptions): BoardBuild {
  const projection = createBoardProjection();

  const topologyObject = (data.topology as { objects: Record<string, { readonly type: string }> })
    .objects[data.objectName];
  if (topologyObject === undefined) {
    throw new Error(`La topologia no tiene el objeto ${data.objectName}`);
  }

  const converted = topoFeature(data.topology as never, topologyObject as never) as unknown as
    { readonly type: string; readonly features?: readonly Feature[] } | Feature;

  const features: readonly Feature[] =
    converted.type === 'FeatureCollection'
      ? ((converted as { readonly features?: readonly Feature[] }).features ?? [])
      : [converted as Feature];

  const territoryIds: TerritoryId[] = [];
  const geometries: BufferGeometry[] = [];
  const vertexCounts: number[] = [];

  const neutral = options.neutralColor;

  features.forEach((item, featureIndex) => {
    const id = typeof item.id === 'string' ? item.id : `t${featureIndex}`;
    if (item.geometry === null) return;
    if (item.geometry.type !== 'Polygon' && item.geometry.type !== 'MultiPolygon') return;

    const polygons: Polygon[] =
      item.geometry.type === 'Polygon'
        ? [item.geometry]
        : (item.geometry as MultiPolygon).coordinates.map((coordinates) => ({
            type: 'Polygon' as const,
            coordinates,
          }));

    const shapes: Shape[] = [];
    for (const polygon of polygons) shapes.push(...polygonToShapes(projection, polygon));
    if (shapes.length === 0) return;

    const extruded = new ExtrudeGeometry(shapes, {
      depth: RELIEF,
      bevelEnabled: false,
      curveSegments: 1,
    });
    extruded.rotateX(-Math.PI / 2);

    const count = extruded.getAttribute('position').count;
    const territoryIndex = territoryIds.length;

    const owner = options.colorFor(id);
    const color = owner ?? neutral;

    const territoryAttribute = new Float32Array(count);
    territoryAttribute.fill(territoryIndex);
    extruded.setAttribute('aTerritory', new Float32BufferAttribute(territoryAttribute, 1));

    const colorAttribute = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      colorAttribute[index * 3] = color.r;
      colorAttribute[index * 3 + 1] = color.g;
      colorAttribute[index * 3 + 2] = color.b;
    }
    extruded.setAttribute('color', new Float32BufferAttribute(colorAttribute, 3));

    territoryIds.push(id);
    geometries.push(extruded);
    vertexCounts.push(count);
  });

  const merged = mergeGeometries(geometries, false);
  if (merged === null) {
    throw new Error('No se pudo fusionar la geometria del tablero');
  }
  for (const geometry of geometries) geometry.dispose();

  const totalVertices = merged.getAttribute('position').count;
  const faceTerritory = new Int32Array(Math.floor(totalVertices / 3));
  let vertexOffset = 0;
  vertexCounts.forEach((count, territoryIndex) => {
    const firstFace = Math.floor(vertexOffset / 3);
    const lastFace = Math.floor((vertexOffset + count) / 3);
    faceTerritory.fill(territoryIndex, firstFace, lastFace);
    vertexOffset += count;
  });

  // Fronteras y costas: `mesh()` devuelve todos los arcos de la topologia.
  const mesh = topoMesh(
    data.topology as never,
    (data.topology as { objects: Record<string, unknown> }).objects[data.objectName] as never,
  ) as MultiLineString;

  const borderLines: MultiLineString = {
    type: 'MultiLineString',
    coordinates: mesh.coordinates.map((line) =>
      line.map((point) => {
        const world = projection.toWorld(point[0] ?? 0, point[1] ?? 0);
        // Apenas por encima de la cara superior del relieve: si quedaran a la
        // altura de la base, los taparia la propia extrusion.
        return [world.x, world.z] as [number, number];
      }),
    ),
  };
  const borders = new BufferGeometry();
  const borderSegments = linesToSegments(borderLines);
  for (let index = 1; index < borderSegments.array.length; index += 3) {
    borderSegments.array[index] = RELIEF + 0.25;
  }
  borders.setAttribute('position', borderSegments);
  borders.computeBoundingSphere();

  // Oceano: el contorno de la proyeccion, apenas por debajo del relieve.
  const outline = projection.outline();
  const oceanShape = new Shape();
  outline.forEach((point, index) => {
    if (index === 0) oceanShape.moveTo(point[0], -point[1]);
    else oceanShape.lineTo(point[0], -point[1]);
  });
  oceanShape.closePath();
  const ocean = new ShapeGeometry(oceanShape, 1);
  ocean.rotateX(-Math.PI / 2);
  ocean.translate(0, -OCEAN_DROP, 0);

  // Rutas maritimas: lineas punteadas sobre el corredor de cada enlace.
  //
  // Se interpola en el PLANO proyectado, no sobre la esfera: un arco de circulo
  // maximo entre Chile y Australia se va por debajo del continente antartico y
  // sale del tablero. El tablero clasico dibuja estas rutas como rectas.
  const seaPositions: number[] = [];
  for (const front of data.fronts.fronts) {
    if (front.kind !== 'sea' || front.coastA === null || front.coastB === null) continue;
    const from = projection.toWorld(front.coastA[0], front.coastA[1]);
    const to = projection.toWorld(front.coastB[0], front.coastB[1]);

    const steps = 30;
    let previous: Vector3 | null = null;
    for (let step = 0; step <= steps; step += 1) {
      const ratio = step / steps;
      const point = new Vector3(
        from.x + (to.x - from.x) * ratio,
        RELIEF * 0.35,
        from.z + (to.z - from.z) * ratio,
      );
      // Se dibuja un segmento si y otro no: queda punteado.
      if (previous !== null && step % 2 === 1) {
        seaPositions.push(previous.x, previous.y, previous.z, point.x, point.y, point.z);
      }
      previous = point;
    }
  }
  const seaRoutes = new BufferGeometry();
  seaRoutes.setAttribute('position', new Float32BufferAttribute(seaPositions, 3));
  seaRoutes.computeBoundingSphere();

  return {
    projection,
    map: merged,
    borders,
    ocean,
    seaRoutes,
    faceTerritory,
    territoryIds,
    relief: RELIEF,
  };
}

/** Centro de cada territorio en coordenadas de mundo, para fichas y etiquetas. */
export function territoryAnchors(
  data: LoadedMapData,
  projection: BoardProjection,
): Map<TerritoryId, { readonly x: number; readonly z: number }> {
  const out = new Map<TerritoryId, { readonly x: number; readonly z: number }>();
  for (const territory of data.territories.territories) {
    out.set(territory.id, projection.toWorld(territory.labelAnchor[0], territory.labelAnchor[1]));
  }
  return out;
}
