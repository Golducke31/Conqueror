/**
 * Navio de vela (primitiva de la fase placeholder).
 *
 * Silueta de navio historico: casco prismatico afilado a proa, cubierta,
 * mastil, vela mayor (se tine con el color del jugador, como el uniforme de
 * las unidades) y estandarte de mastil. El origen queda en la linea de
 * flotacion, en el centro del casco, mirando hacia +Z.
 *
 * La especificacion de los modelos finales (docs/art-spec.md) pide < 1200
 * triangulos por navio; esta primitiva se queda muy por debajo.
 */

import type { BufferGeometry } from 'three';
import { BoxGeometry, Color, CylinderGeometry, Float32BufferAttribute, PlaneGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const MADERA = new Color('#4a3524');
const MADERA_CLARA = new Color('#6b4a2f');
const VELA = new Color('#ffffff');
const METAL = new Color('#8d9199');

interface ShipPart {
  readonly geometry: BufferGeometry;
  readonly color: Color;
  /** 1 = se tine con el color del jugador. */
  readonly mask: number;
}

function part(geometry: BufferGeometry, color: Color, mask: number): ShipPart {
  return { geometry, color, mask };
}

/** Cilindro de seccion prismatica (4 caras), acostado sobre el eje Z. */
function prism(
  radiusTop: number,
  radiusBottom: number,
  length: number,
  x: number,
  y: number,
  z: number,
  color: Color,
  mask: number,
): ShipPart {
  const geometry = new CylinderGeometry(radiusTop, radiusBottom, length, 4);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(x, y, z);
  return part(geometry, color, mask);
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
): ShipPart {
  const geometry = new BoxGeometry(width, height, depth);
  geometry.translate(x, y, z);
  return part(geometry, color, mask);
}

function plane(
  width: number,
  height: number,
  x: number,
  y: number,
  z: number,
  color: Color,
  mask: number,
): ShipPart {
  const geometry = new PlaneGeometry(width, height);
  geometry.translate(x, y, z);
  return part(geometry, color, mask);
}

/** Fusiona las piezas y les hornea color y mascara por vertice. */
function mergeShipParts(parts: readonly ShipPart[]): BufferGeometry {
  const prepared = parts.map((entry) => {
    const count = entry.geometry.getAttribute('position').count;
    const color = new Float32Array(count * 3);
    const mask = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      color[index * 3] = entry.color.r;
      color[index * 3 + 1] = entry.color.g;
      color[index * 3 + 2] = entry.color.b;
      mask[index] = entry.mask;
    }
    entry.geometry.setAttribute('aColor', new Float32BufferAttribute(color, 3));
    entry.geometry.setAttribute('aMask', new Float32BufferAttribute(mask, 1));
    return entry.geometry;
  });
  const merged = mergeGeometries(prepared, false);
  if (merged === null) throw new Error('No se pudieron fusionar las piezas del navio');
  for (const geometry of prepared) geometry.dispose();
  merged.computeVertexNormals();
  return merged;
}

/** Geometria del navio, con el origen en la linea de flotacion. */
export function createShipGeometry(): BufferGeometry {
  return mergeShipParts([
    // Casco: prisma afinado a proa (+Z), mas ancho a popa.
    prism(0.9, 2.1, 13, 0, 0, 0, MADERA, 0),
    // Cubierta
    box(4.4, 0.5, 11.5, 0, 1.5, 0, MADERA_CLARA, 0),
    // Borda a proa
    box(0.5, 2.2, 3.4, 0, 2.2, 5.4, MADERA, 0),
    // Mastil
    box(0.4, 12, 0.4, 0, 7, -1.2, MADERA_CLARA, 0),
    // Vela mayor: se tine con el color del jugador.
    plane(7.5, 7.5, 0, 7.2, -1.7, VELA, 1),
    // Estandarte de mastil
    plane(2.6, 1.6, 1.5, 12.6, -1.2, VELA, 1),
    // Botalon
    box(0.3, 0.3, 4.5, 0, 2.4, 7.6, MADERA_CLARA, 0),
    // Timon
    box(0.4, 3, 2.2, 0, 0.5, -6.6, MADERA, 0),
    // Remache de proa
    box(0.5, 0.5, 0.9, 0, 2.4, 6.6, METAL, 0),
  ]);
}
