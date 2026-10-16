/**
 * Proyeccion del tablero.
 *
 * Se usa `geoNaturalEarth1` (d3-geo), la proyeccion plana por defecto del plan.
 * El tablero se arma en el plano XZ de Three.js, centrado en el origen:
 *
 *   - `+X` es este
 *   - `-Z` es norte (queda arriba en pantalla con la camara mirando desde +Z)
 *   - `+Y` es altura
 *
 * Se expone tanto `toWorld` (lon/lat -> mundo) como `toShape` (lon/lat -> plano
 * 2D para `THREE.Shape`, con la Y invertida para que al rotar -90 grados sobre X
 * el norte quede hacia -Z).
 */

import { geoNaturalEarth1, geoPath, type GeoPermissibleObjects } from 'd3-geo';

/** Ancho del tablero en unidades de mundo. */
export const BOARD_WIDTH = 1000;

const SPHERE = { type: 'Sphere' } as unknown as GeoPermissibleObjects;

export interface BoardProjection {
  /** Ancho real del tablero ya proyectado. */
  readonly width: number;
  /** Alto real del tablero ya proyectado. */
  readonly height: number;
  /** Centro del tablero en coordenadas de mundo (siempre el origen). */
  toWorld(lon: number, lat: number): { readonly x: number; readonly z: number };
  /** Punto del contorno de la proyeccion, util para dibujar el oceano. */
  outline(): readonly (readonly [number, number])[];
  /** Proyeccion cruda, por si hace falta proyectar mas cosas. */
  readonly projection: ReturnType<typeof geoNaturalEarth1>;
}

interface PathContext {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  arc(): void;
}

export function createBoardProjection(): BoardProjection {
  const projection = geoNaturalEarth1();
  // Se ajusta a un cuadrado: fitExtent respeta la relacion de aspecto propia de
  // la proyeccion, asi que el alto real sale de medir el contorno.
  projection.fitExtent(
    [
      [0, 0],
      [BOARD_WIDTH, BOARD_WIDTH],
    ],
    SPHERE,
  );

  const path = geoPath(projection);
  const [[x0, y0], [x1, y1]] = path.bounds(SPHERE);
  const width = x1 - x0;
  const height = y1 - y0;
  const centerX = (x0 + x1) / 2;
  const centerY = (y0 + y1) / 2;

  return {
    width,
    height,
    projection,
    toWorld(lon: number, lat: number): { readonly x: number; readonly z: number } {
      const point = projection([lon, lat]);
      if (point === null) return { x: 0, z: 0 };
      return { x: point[0] - centerX, z: point[1] - centerY };
    },
    outline(): readonly (readonly [number, number])[] {
      const points: Array<readonly [number, number]> = [];
      const context: PathContext = {
        moveTo: (x, y) => points.push([x - centerX, y - centerY]),
        lineTo: (x, y) => points.push([x - centerX, y - centerY]),
        closePath: () => undefined,
        arc: () => undefined,
      };
      geoPath(projection, context as never)(SPHERE);
      return points;
    },
  };
}

/**
 * Punto del plano 2D para `THREE.Shape`.
 * La Y va invertida respecto de la pantalla porque despues la geometria se rota
 * -90 grados sobre X: asi el norte termina en -Z.
 */
export function toShapePoint(
  projection: BoardProjection,
  lon: number,
  lat: number,
): readonly [number, number] {
  const world = projection.toWorld(lon, lat);
  return [world.x, -world.z];
}
