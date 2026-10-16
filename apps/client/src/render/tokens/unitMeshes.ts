/**
 * Primitivas de unidad (fase placeholder).
 *
 * Segun el plan de combate (seccion 14), hasta el hito C6 las unidades son
 * primitivas: lo que importa es que las SILUETAS se distingan entre si. El arte
 * final (glTF) entra despues, con la misma interfaz.
 *
 * Cada vertice lleva:
 *   - `aColor`  color propio de la pieza
 *   - `aMask`   1 si es uniforme (se tinta con el color del jugador), 0 si no
 *
 * El origen queda en los pies y el frente mira hacia +Z, igual que la
 * especificacion de los modelos finales.
 */

import type { BufferGeometry } from 'three';
import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Matrix4,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { UnitType } from '@conqueror/rules';

/** Colores de las piezas que NO se tinen con el color del jugador. */
const CUERO = new Color('#6b4a2f');
const METAL = new Color('#8d9199');
const MADERA = new Color('#4a3524');
const PIEL = new Color('#c99b6e');

interface Part {
  readonly geometry: BufferGeometry;
  readonly color: Color;
  /** 1 = uniforme (tintable), 0 = equipo. */
  readonly mask: number;
}

function box(
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  color: Color,
  mask: number,
): Part {
  const geometry = new BoxGeometry(width, height, depth);
  geometry.translate(x, y, z);
  return { geometry, color, mask };
}

function capsule(
  radius: number,
  length: number,
  x: number,
  y: number,
  z: number,
  color: Color,
  mask: number,
): Part {
  const geometry = new CapsuleGeometry(radius, length, 4, 8);
  geometry.translate(x, y, z);
  return { geometry, color, mask };
}

function cylinder(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  x: number,
  y: number,
  z: number,
  color: Color,
  mask: number,
  axis: 'x' | 'y' | 'z' = 'y',
): Part {
  const geometry = new CylinderGeometry(radiusTop, radiusBottom, height, 10);
  if (axis === 'x') geometry.rotateZ(Math.PI / 2);
  if (axis === 'z') geometry.rotateX(Math.PI / 2);
  geometry.translate(x, y, z);
  return { geometry, color, mask };
}

/** Fusiona las piezas y les hornea color y mascara por vertice. */
function mergeParts(parts: readonly Part[]): BufferGeometry {
  const prepared = parts.map((part) => {
    const count = part.geometry.getAttribute('position').count;
    const color = new Float32Array(count * 3);
    const mask = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      color[index * 3] = part.color.r;
      color[index * 3 + 1] = part.color.g;
      color[index * 3 + 2] = part.color.b;
      mask[index] = part.mask;
    }
    part.geometry.setAttribute('aColor', new Float32BufferAttribute(color, 3));
    part.geometry.setAttribute('aMask', new Float32BufferAttribute(mask, 1));
    return part.geometry;
  });

  const merged = mergeGeometries(prepared, false);
  if (merged === null) throw new Error('No se pudieron fusionar las piezas de la unidad');
  for (const geometry of prepared) geometry.dispose();
  merged.computeVertexNormals();
  return merged;
}

/** Infanteria: soldado con casaca y mosquete. */
function infantry(): BufferGeometry {
  return mergeParts([
    // piernas
    box(1.1, 2.6, 1.1, -0.45, 1.3, 0, CUERO, 0),
    box(1.1, 2.6, 1.1, 0.45, 1.3, 0, CUERO, 0),
    // torso con casaca (se tinta)
    box(2.4, 3.2, 1.5, 0, 4.2, 0, new Color('#ffffff'), 1),
    // brazos
    capsule(0.42, 2.2, -1.5, 4.3, 0.1, new Color('#ffffff'), 1),
    capsule(0.42, 2.2, 1.5, 4.3, 0.1, new Color('#ffffff'), 1),
    // cabeza
    capsule(0.75, 0.5, 0, 6.6, 0, PIEL, 0),
    // morrion
    capsule(0.85, 0.2, 0, 7.2, 0, METAL, 0),
    // mosquete apoyado al hombro
    box(0.28, 6.4, 0.28, 1.5, 4.6, 0.5, MADERA, 0),
    box(0.34, 0.5, 0.34, 1.5, 1.6, 0.5, METAL, 0),
  ]);
}

/** Caballeria: jinete montado, silueta mas larga y baja. */
function cavalry(): BufferGeometry {
  return mergeParts([
    // patas
    box(0.8, 3, 0.8, -1, 1.5, 2.2, CUERO, 0),
    box(0.8, 3, 0.8, 1, 1.5, 2.2, CUERO, 0),
    box(0.8, 3, 0.8, -1, 1.5, -2.2, CUERO, 0),
    box(0.8, 3, 0.8, 1, 1.5, -2.2, CUERO, 0),
    // cuerpo del caballo
    box(2.6, 2.8, 6.4, 0, 4.4, 0, CUERO, 0),
    // cuello y cabeza
    box(1.4, 3, 1.4, 0, 6.4, 3.2, CUERO, 0),
    box(1, 1.2, 2, 0, 7.4, 4.2, CUERO, 0),
    // jinete: torso tintable
    box(2.2, 3, 1.4, 0, 8, -0.4, new Color('#ffffff'), 1),
    capsule(0.7, 0.4, 0, 10.1, -0.4, PIEL, 0),
    capsule(0.8, 0.2, 0, 10.6, -0.4, METAL, 0),
    // sable
    box(0.2, 4.4, 0.2, 1.6, 8.6, 0.6, METAL, 0),
  ]);
}

/** Artilleria: canon de campana con curena y ruedas. */
function artillery(): BufferGeometry {
  return mergeParts([
    // ruedas
    cylinder(1.8, 1.8, 0.7, -2, 1.8, 0, MADERA, 0, 'x'),
    cylinder(1.8, 1.8, 0.7, 2, 1.8, 0, MADERA, 0, 'x'),
    // curena
    box(3.6, 1.4, 5.4, 0, 2.6, -0.4, MADERA, 0),
    // tubo del canon, apuntando hacia +Z
    cylinder(0.9, 1.25, 8.4, 0, 3.8, 1.8, METAL, 0, 'z'),
    // boca
    cylinder(1.15, 1.15, 0.6, 0, 3.8, 6, METAL, 0, 'z'),
    // artilleros con casaca (se tinta)
    box(2, 2.8, 1.3, -3.4, 3.6, -2.4, new Color('#ffffff'), 1),
    capsule(0.65, 0.4, -3.4, 5.4, -2.4, PIEL, 0),
    box(2, 2.8, 1.3, 3.4, 3.6, -2.4, new Color('#ffffff'), 1),
    capsule(0.65, 0.4, 3.4, 5.4, -2.4, PIEL, 0),
  ]);
}

/** Geometria placeholder de cada tipo de unidad. */
export function createUnitGeometries(): Record<UnitType, BufferGeometry> {
  return {
    infantry: infantry(),
    cavalry: cavalry(),
    artillery: artillery(),
  };
}

/** Huella aproximada de cada tipo, para separar las unidades en la formacion. */
export const UNIT_FOOTPRINT: Record<UnitType, number> = {
  infantry: 3.2,
  cavalry: 7.4,
  artillery: 9,
};

/** Altura de cada tipo, para ordenar la formacion de atras hacia adelante. */
export const UNIT_HEIGHT: Record<UnitType, number> = {
  infantry: 7.6,
  cavalry: 11,
  artillery: 6.4,
};

/** Matriz auxiliar reutilizada para no crear objetos por unidad. */
export const UNIT_SCRATCH_MATRIX = new Matrix4();
