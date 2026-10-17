/**
 * Presupuestos de la seccion 12 del plan de combate.
 *
 * El criterio de terminado de C6 es cumplir estos presupuestos. Lo que se puede
 * medir sin GPU ni DOM se mide aca: triangulos de cada primitiva contra la
 * especificacion, y draw calls extra de una batalla (una malla instanciada por
 * tipo, nunca una por soldado).
 *
 * El resto del presupuesto (60 fps en un movil de gama media) se comprueba a
 * mano con el overlay de depuracion: aca no hay forma de medirlo.
 */

import type { Object3D } from 'three';
import { describe, expect, it } from 'vitest';

import { UnitBatch, UNIT_ORDER } from '../tokens/UnitBatch.js';
import { createUnitGeometries } from '../tokens/unitMeshes.js';
import { TRIANGLE_BUDGET, type UnitModelType } from '../tokens/models/manifest.js';
import { triangleCount } from '../tokens/models/unitGeometry.js';
import { createShipGeometry } from './units/shipMesh.js';
import { ShipLayer } from './units/ShipLayer.js';
import { createBannerLayer } from './BannerLayer.js';

/** Tope de draw calls extra durante una batalla. */
const DRAW_CALL_BUDGET = 30;

/** Cuenta los objetos que three dibuja de verdad (mallas, puntos, lineas). */
function countDrawables(root: Object3D): number {
  let total = 0;
  root.traverse((object) => {
    const posible = object as { isMesh?: boolean; isPoints?: boolean; isLine?: boolean };
    if (posible.isMesh === true || posible.isPoints === true || posible.isLine === true) total += 1;
  });
  return total;
}

describe('presupuestos de la batalla', () => {
  it('las primitivas entran en el presupuesto de triangulos de su tipo', () => {
    const geometries = createUnitGeometries();
    for (const type of ['infantry', 'cavalry', 'artillery'] as const) {
      const triangulos = triangleCount(geometries[type]);
      expect(triangulos, `${type}: ${triangulos} triangulos`).toBeLessThanOrEqual(
        TRIANGLE_BUDGET[type],
      );
    }
  });

  it('el navio primitivo entra en su presupuesto', () => {
    const triangulos = triangleCount(createShipGeometry());
    expect(triangulos).toBeLessThanOrEqual(TRIANGLE_BUDGET.ship);
  });

  it('la batalla no pasa de 30 draw calls extra', () => {
    const batch = new UnitBatch({ capacity: 64 });
    const ships = new ShipLayer({ capacity: 8 });
    const banner = createBannerLayer({ baseY: 0 });

    // Las capas que se pueden armar sin DOM: unidades, navios y estandarte.
    const sinDom =
      countDrawables(batch.group) + countDrawables(ships.group) + countDrawables(banner.group);
    // Los dados son un solo InstancedMesh y las particulas un solo Points.
    const dadosYParticulas = 2;

    expect(sinDom + dadosYParticulas).toBeLessThanOrEqual(DRAW_CALL_BUDGET);

    batch.dispose();
    ships.dispose();
    banner.dispose();
  });

  it('hay una sola malla instanciada por tipo de unidad', () => {
    const batch = new UnitBatch({ capacity: 64 });

    // Ni una malla por soldado ni un SkinnedMesh por unidad: tres en total.
    expect(countDrawables(batch.group)).toBe(UNIT_ORDER.length);
    expect(countDrawables(batch.group)).toBe(3);

    batch.dispose();
  });

  it('los tipos con presupuesto son los cuatro de la especificacion', () => {
    const tipos: readonly UnitModelType[] = ['infantry', 'cavalry', 'artillery', 'ship'];
    for (const type of tipos) expect(TRIANGLE_BUDGET[type]).toBeGreaterThan(0);
  });
});
