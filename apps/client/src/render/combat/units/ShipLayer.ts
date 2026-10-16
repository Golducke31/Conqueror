/**
 * Capa de navios.
 *
 * Un `InstancedMesh` con la geometria del navio, igual que las unidades: el
 * plan prohibe una malla por unidad. Se usa solo en los cruces maritimos de la
 * escena de batalla; la capacidad (8) cubre con holgura el tope de unidades
 * por bando.
 *
 * El vaiven en reposo lo hace el vertex shader del material de unidades (la
 * fase sale de la posicion de la instancia), asi que flotar no cuesta CPU.
 */

import type { Color } from 'three';
import { DynamicDrawUsage, Group, InstancedMesh, Object3D } from 'three';

import { createShipGeometry } from './shipMesh.js';
import { createUnitMaterial, type UnitMaterialHandle } from '../../tokens/unitMaterial.js';

export interface ShipInstance {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Giro sobre el eje Y, en radianes. */
  readonly rotationY: number;
  readonly scale: number;
  readonly color: Color;
}

export interface ShipLayerOptions {
  /** Capacidad de navios simultaneos. */
  readonly capacity?: number;
}

export class ShipLayer {
  readonly group = new Group();

  private readonly mesh: InstancedMesh;
  private readonly material: UnitMaterialHandle;
  private readonly scratch = new Object3D();

  constructor(options: ShipLayerOptions = {}) {
    this.material = createUnitMaterial();
    this.mesh = new InstancedMesh(
      createShipGeometry(),
      this.material.material,
      options.capacity ?? 8,
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.group.add(this.mesh);
  }

  /** Reemplaza todas las instancias. */
  setInstances(instances: readonly ShipInstance[]): void {
    let cursor = 0;
    for (const instance of instances) {
      if (cursor >= this.mesh.instanceMatrix.count) break;
      this.scratch.position.set(instance.x, instance.y, instance.z);
      this.scratch.rotation.set(0, instance.rotationY, 0);
      this.scratch.scale.setScalar(instance.scale);
      this.scratch.updateMatrix();
      this.mesh.setMatrixAt(cursor, this.scratch.matrix);
      this.mesh.setColorAt(cursor, instance.color);
      cursor += 1;
    }
    this.mesh.count = cursor;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor !== null) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.computeBoundingSphere();
  }

  setTime(seconds: number): void {
    this.material.setTime(seconds);
  }

  visibleShips(): number {
    return this.mesh.count;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.group.remove(this.mesh);
  }
}
