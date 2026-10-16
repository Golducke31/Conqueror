/**
 * Picking del tablero.
 *
 * Como el mundo es UNA malla fusionada, no hace falta render de color-ID
 * offscreen: cada triangulo conoce su territorio en `faceTerritory`, asi que
 * `intersection.faceIndex` alcanza para resolver el territorio exacto.
 *
 * El raycast solo corre cuando el puntero se mueve, nunca por frame.
 */

import type { Camera, Mesh, Raycaster, Vector2 } from 'three';
import type { TerritoryId } from '@conqueror/shared';

export interface PickResult {
  readonly territory: TerritoryId;
  /** Punto del impacto en coordenadas de mundo. */
  readonly point: { readonly x: number; readonly y: number; readonly z: number };
}

export class TerritoryPicker {
  private readonly faceTerritory: Int32Array;
  private readonly territoryIds: readonly TerritoryId[];

  constructor(faceTerritory: Int32Array, territoryIds: readonly TerritoryId[]) {
    this.faceTerritory = faceTerritory;
    this.territoryIds = territoryIds;
  }

  /** Indice interno del territorio de una cara, o -1. */
  indexAt(faceIndex: number | null | undefined): number {
    if (faceIndex === undefined || faceIndex === null || faceIndex < 0) return -1;
    const index = this.faceTerritory[faceIndex];
    return index === undefined ? -1 : index;
  }

  /** Indice de un territorio por id, o -1. */
  indexOf(territory: TerritoryId): number {
    return this.territoryIds.indexOf(territory);
  }

  /** Territorio bajo el puntero, o `null` si el rayo no toca el tablero. */
  pick(raycaster: Raycaster, camera: Camera, mesh: Mesh, pointer: Vector2): PickResult | null {
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(mesh, false);
    const first = hits[0];
    if (first === undefined) return null;

    const index = this.indexAt(first.faceIndex);
    if (index < 0) return null;

    const id = this.territoryIds[index];
    if (id === undefined) return null;

    return {
      territory: id,
      point: { x: first.point.x, y: first.point.y, z: first.point.z },
    };
  }
}
