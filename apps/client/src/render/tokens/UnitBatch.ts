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
import type { UnitSkin } from './models/modelLoader.js';

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
  private readonly materials: Record<UnitType, UnitMaterialHandle>;
  private readonly scratch = new Object3D();
  private readonly counts: Record<UnitType, number> = { artillery: 0, cavalry: 0, infantry: 0 };
  /** Si la geometria de cada malla es propia (primitiva) y hay que disponerla. */
  private readonly owned: Record<UnitType, boolean> = {
    artillery: true,
    cavalry: true,
    infantry: true,
  };

  constructor(options: UnitBatchOptions) {
    const geometries = createUnitGeometries();
    // Orden YXZ: primero se inclina (caida) y despues se orienta (formacion).
    this.scratch.rotation.order = 'YXZ';

    // Un material por tipo: el shader es el mismo (three comparte el programa),
    // pero asi cada tipo puede llevar su propia textura.
    this.materials = {
      artillery: createUnitMaterial(),
      cavalry: createUnitMaterial(),
      infantry: createUnitMaterial(),
    };

    this.meshes = {
      artillery: new InstancedMesh(
        geometries.artillery,
        this.materials.artillery.material,
        options.capacity,
      ),
      cavalry: new InstancedMesh(
        geometries.cavalry,
        this.materials.cavalry.material,
        options.capacity,
      ),
      infantry: new InstancedMesh(
        geometries.infantry,
        this.materials.infantry.material,
        options.capacity,
      ),
    };

    for (const type of UNIT_ORDER) {
      const mesh = this.meshes[type];
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
    }
  }

  /**
   * Cambia las geometrias por los modelos finales, cargados en diferido. Los
   * tipos que no vengan siguen con su primitiva.
   *
   * Las geometrias inyectadas NO se disponen: las comparten otras capas (el
   * mapa y la batalla). Solo se disponen las primitivas que creo este lote.
   */
  setGeometries(models: Readonly<Partial<Record<UnitType, UnitSkin>>>): void {
    for (const type of UNIT_ORDER) {
      const skin = models[type];
      this.materials[type].setMap(skin?.map ?? null, skin?.maskChannel ?? 'none');
      if (skin === undefined) continue;

      const mesh = this.meshes[type];
      const anterior = mesh.geometry;
      mesh.geometry = skin.geometry;
      if (this.owned[type]) anterior.dispose();
      this.owned[type] = false;
      mesh.computeBoundingSphere();
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
    for (const type of UNIT_ORDER) this.materials[type].setTime(seconds);
  }

  setDim(value: number): void {
    for (const type of UNIT_ORDER) this.materials[type].setDim(value);
  }

  setOpacity(value: number): void {
    for (const type of UNIT_ORDER) this.materials[type].setOpacity(value);
  }

  visibleUnits(): number {
    return UNIT_ORDER.reduce((total, type) => total + this.counts[type], 0);
  }

  dispose(): void {
    for (const type of UNIT_ORDER) {
      const mesh = this.meshes[type];
      // Solo se dispone lo propio: los modelos cargados los comparten otras capas.
      if (this.owned[type]) mesh.geometry.dispose();
      this.group.remove(mesh);
      this.materials[type].dispose();
    }
  }
}
