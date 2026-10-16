/**
 * Lote de unidades.
 *
 * Un `InstancedMesh` por tipo de unidad y nada mas: el plan prohibe una malla
 * por soldado y un `SkinnedMesh` por unidad. Lo usan tanto las fichas del mapa
 * como las escuadras de la escena de batalla, para no duplicar el instancing.
 */

import type { Color } from 'three';
import { DynamicDrawUsage, Group, InstancedMesh, Object3D } from 'three';
import type { UnitType } from '@conqueror/rules';
import { createUnitGeometries } from './unitMeshes.js';
import { createUnitMaterial, type UnitMaterialHandle } from './unitMaterial.js';

/** Orden de dibujo fijo, de mayor a menor nivel. */
export const UNIT_ORDER: readonly UnitType[] = ['artillery', 'cavalry', 'infantry'];

export interface UnitInstance {
  readonly type: UnitType;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Giro sobre el eje Y, en radianes. */
  readonly rotationY: number;
  /** Caida: inclinacion sobre el eje local X, en radianes. */
  readonly tilt?: number;
  readonly scale: number;
  readonly color: Color;
}

export interface UnitBatchOptions {
  /** Capacidad por tipo. */
  readonly capacity: number;
}

export class UnitBatch {
  readonly group = new Group();

  private readonly meshes: Record<UnitType, InstancedMesh>;
  private readonly material: UnitMaterialHandle;
  private readonly scratch = new Object3D();
  private readonly counts: Record<UnitType, number> = { artillery: 0, cavalry: 0, infantry: 0 };

  constructor(options: UnitBatchOptions) {
    this.material = createUnitMaterial();
    const geometries = createUnitGeometries();
    // Orden YXZ: primero se inclina (caida) y despues se orienta (formacion).
    this.scratch.rotation.order = 'YXZ';

    this.meshes = {
      artillery: new InstancedMesh(geometries.artillery, this.material.material, options.capacity),
      cavalry: new InstancedMesh(geometries.cavalry, this.material.material, options.capacity),
      infantry: new InstancedMesh(geometries.infantry, this.material.material, options.capacity),
    };

    for (const type of UNIT_ORDER) {
      const mesh = this.meshes[type];
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
    }
  }

  /** Reemplaza todas las instancias. */
  setInstances(instances: readonly UnitInstance[]): void {
    for (const type of UNIT_ORDER) this.counts[type] = 0;

    for (const instance of instances) {
      const mesh = this.meshes[instance.type];
      const cursor = this.counts[instance.type];
      if (cursor >= mesh.instanceMatrix.count) continue;

      this.scratch.position.set(instance.x, instance.y, instance.z);
      this.scratch.rotation.set(instance.tilt ?? 0, instance.rotationY, 0);
      this.scratch.scale.setScalar(instance.scale);
      this.scratch.updateMatrix();

      mesh.setMatrixAt(cursor, this.scratch.matrix);
      mesh.setColorAt(cursor, instance.color);
      this.counts[instance.type] = cursor + 1;
    }

    for (const type of UNIT_ORDER) {
      const mesh = this.meshes[type];
      mesh.count = this.counts[type];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  setTime(seconds: number): void {
    this.material.setTime(seconds);
  }

  setDim(value: number): void {
    this.material.setDim(value);
  }

  setOpacity(value: number): void {
    this.material.setOpacity(value);
  }

  visibleUnits(): number {
    return UNIT_ORDER.reduce((total, type) => total + this.counts[type], 0);
  }

  dispose(): void {
    for (const type of UNIT_ORDER) {
      const mesh = this.meshes[type];
      mesh.geometry.dispose();
      this.group.remove(mesh);
    }
    this.material.dispose();
  }
}
