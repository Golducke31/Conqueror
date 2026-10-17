/**
 * Normalizacion de la geometria de un modelo final.
 *
 * Toma la geometria cruda que devuelve el cargador de glTF y la deja en el
 * contrato que espera el material de unidades: `aColor` (vec3) y `aMask`
 * (float) por vertice, mas `position`, `normal` y `uv`. Es PURA: no toca la
 * red, ni el DOM, ni el renderer, asi que se puede probar con una geometria
 * armada a mano (ADR 0012).
 *
 * Contrato de los modelos (docs/art-spec.md):
 *   - Origen en los pies, eje Y hacia arriba, mirando hacia +Z.
 *   - `COLOR_0` con el color base; three lo renombra a `color` al cargar.
 *   - Atributo propio `_MASK` con la mascara de uniforme (1 = se tine).
 *   - Si falta el color, se usa el `baseColor` del manifiesto; si falta la
 *     mascara, se usa su `maskValue`.
 */

import type { BufferGeometry } from 'three';
import { Color, Float32BufferAttribute } from 'three';
import type { Result } from '@conqueror/rules';

import { TRIANGLE_BUDGET, type ModelSlot, type UnitModelType } from './manifest.js';

/** Lo minimo que se usa de un atributo: sirve igual si es entrelazado o no. */
interface AtributoLectura {
  readonly count: number;
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
}

/**
 * Cantidad de triangulos de una geometria, indexada o no. Es lo que se compara
 * contra el presupuesto del tipo.
 */
export function triangleCount(geometry: BufferGeometry): number {
  const index = geometry.getIndex();
  if (index !== null) return Math.floor(index.count / 3);
  const position = geometry.getAttribute('position');
  return position === undefined ? 0 : Math.floor(position.count / 3);
}

/** Si un modelo entra en el presupuesto de su tipo (seccion 12 del plan). */
export function withinBudget(type: UnitModelType, triangles: number): boolean {
  return triangles <= TRIANGLE_BUDGET[type];
}

/** Lee un atributo y comprueba que tenga las componentes que se esperan. */
function leerAtributo(
  geometry: BufferGeometry,
  nombre: string,
  minimo: number,
): Result<AtributoLectura, string> {
  const attribute = geometry.getAttribute(nombre);
  if (attribute === undefined) {
    return { ok: false, error: `no existe el atributo «${nombre}»` };
  }
  if (attribute.itemSize < minimo) {
    return {
      ok: false,
      error: `el atributo «${nombre}» tiene ${attribute.itemSize} componentes y se esperan ${minimo}`,
    };
  }
  return { ok: true, value: attribute };
}

/**
 * Reescribe las posiciones con la escala y el desplazamiento vertical del
 * manifiesto. Siempre deja un atributo float propio (no entrelazado), que es
 * lo que conviene para el instancing.
 */
function aplicarTransformacion(geometry: BufferGeometry, scale: number, yOffset: number): void {
  const origen = geometry.getAttribute('position');
  const destino = new Float32Array(origen.count * 3);
  for (let index = 0; index < origen.count; index += 1) {
    destino[index * 3] = origen.getX(index) * scale;
    destino[index * 3 + 1] = origen.getY(index) * scale + yOffset;
    destino[index * 3 + 2] = origen.getZ(index) * scale;
  }
  geometry.setAttribute('position', new Float32BufferAttribute(destino, 3));

  // Las posiciones cambiaron: los volumenes que calculo el cargador quedaron
  // viejos, y el recorte por frustum de las instancias los usa.
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

/**
 * Normaliza una geometria cruda al contrato de unidades. Devuelve una
 * geometria NUEVA (la de entrada no se toca).
 */
export function normalizeUnitGeometry(
  source: BufferGeometry,
  slot: ModelSlot,
): Result<BufferGeometry, string> {
  const geometry = source.clone();

  const posiciones = geometry.getAttribute('position');
  if (posiciones === undefined || posiciones.count === 0) {
    return { ok: false, error: 'el modelo no tiene vertices' };
  }

  // --- Color base por vertice ------------------------------------------------
  const colorFuente = leerAtributo(geometry, slot.colorAttribute, 3);
  const color = new Float32Array(posiciones.count * 3);
  if (colorFuente.ok) {
    for (let index = 0; index < posiciones.count; index += 1) {
      color[index * 3] = colorFuente.value.getX(index);
      color[index * 3 + 1] = colorFuente.value.getY(index);
      color[index * 3 + 2] = colorFuente.value.getZ(index);
    }
  } else {
    // Sin color por vertice: el manifiesto manda un color plano.
    const plano = new Color(slot.baseColor);
    for (let index = 0; index < posiciones.count; index += 1) {
      color[index * 3] = plano.r;
      color[index * 3 + 1] = plano.g;
      color[index * 3 + 2] = plano.b;
    }
  }
  geometry.setAttribute('aColor', new Float32BufferAttribute(color, 3));

  // --- Mascara de uniforme ---------------------------------------------------
  const mascaraFuente = leerAtributo(geometry, slot.maskAttribute, 1);
  const mascara = new Float32Array(posiciones.count);
  for (let index = 0; index < posiciones.count; index += 1) {
    const valor = mascaraFuente.ok ? mascaraFuente.value.getX(index) : slot.maskValue;
    mascara[index] = Math.max(0, Math.min(1, valor));
  }
  geometry.setAttribute('aMask', new Float32BufferAttribute(mascara, 1));

  // --- Transformacion y normales --------------------------------------------
  aplicarTransformacion(geometry, slot.scale, slot.yOffset);
  if (geometry.getAttribute('normal') === undefined) geometry.computeVertexNormals();

  return { ok: true, value: geometry };
}
