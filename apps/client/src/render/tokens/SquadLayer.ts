/**
 * Capa de fichas del mapa.
 *
 * Calcula la formacion de cada territorio con `composeSquad` (la misma funcion
 * pura que usa la batalla) y se la pasa a un `UnitBatch`, que es quien tiene el
 * instancing. Asi las 50 fichas cuestan tres draw calls.
 *
 * Decision de producto documentada en el ADR 0005: en el MAPA se usa un tope de
 * unidades mas chico que en la batalla (5 en escritorio, 3 en movil). Con 16
 * unidades por ficha el tablero se vuelve ilegible, y el numero exacto de
 * ejercitos igual se muestra al lado.
 */

import type { Color, Group } from 'three';
import { composeSquad, type UnitType } from '@conqueror/rules';
import type { TerritoryId } from '@conqueror/shared';
import { UNIT_ORDER, UnitBatch, type UnitInstance } from './UnitBatch.js';

/** Orden de formacion, de la fila de atras hacia adelante. */
const FORMATION_ORDER: readonly UnitType[] = ['artillery', 'cavalry', 'infantry'];

export interface SquadPlacement {
  readonly territory: TerritoryId;
  readonly x: number;
  readonly z: number;
  readonly armies: number;
  readonly color: Color;
}

export interface SquadLayoutInfo {
  readonly x: number;
  readonly z: number;
  /** Radio aproximado ocupado, para que las etiquetas no pisen las unidades. */
  readonly radius: number;
}

export interface SquadLayerOptions {
  /** Tope de unidades por ficha. */
  readonly maxUnits: number;
  /** Escala de las unidades en el tablero. */
  readonly unitScale: number;
  /** Altura a la que apoyan las unidades (la cara superior del relieve). */
  readonly baseY: number;
}

export class SquadLayer {
  readonly group: Group;

  private readonly batch: UnitBatch;
  private readonly options: SquadLayerOptions;
  private readonly layout = new Map<TerritoryId, SquadLayoutInfo>();
  private readonly instances: UnitInstance[] = [];

  constructor(options: SquadLayerOptions) {
    this.options = options;
    this.batch = new UnitBatch({ capacity: 600 });
    this.group = this.batch.group;
  }

  /** Recompone todas las fichas. Se llama al cambiar el estado, no por frame. */
  update(placements: readonly SquadPlacement[]): void {
    this.instances.length = 0;
    this.layout.clear();

    for (const placement of placements) {
      const composition = composeSquad(placement.armies, { maxUnits: this.options.maxUnits });
      if (composition.units.length === 0) {
        this.layout.set(placement.territory, { x: placement.x, z: placement.z, radius: 0 });
        continue;
      }

      const total = composition.units.reduce((sum, unit) => sum + unit.count, 0);
      const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(total))));
      const spacing = 7 * this.options.unitScale;

      const queue: UnitType[] = [];
      for (const type of FORMATION_ORDER) {
        const unit = composition.units.find((candidate) => candidate.type === type);
        if (unit === undefined) continue;
        for (let index = 0; index < unit.count; index += 1) queue.push(type);
      }

      const rows = Math.ceil(queue.length / columns);
      const zSpan = (rows - 1) * spacing * 0.85;
      let maxRadius = 0;

      queue.forEach((type, index) => {
        const row = Math.floor(index / columns);
        const column = index % columns;
        const inRow = Math.min(columns, queue.length - row * columns);
        const xOffset = (column - (inRow - 1) / 2) * spacing;
        const zOffset = row * spacing * 0.85 - zSpan / 2;

        this.instances.push({
          type,
          x: placement.x + xOffset,
          y: this.options.baseY,
          z: placement.z + zOffset,
          rotationY: 0,
          scale: this.options.unitScale,
          color: placement.color,
        });

        maxRadius = Math.max(maxRadius, Math.abs(xOffset), Math.abs(zOffset));
      });

      this.layout.set(placement.territory, {
        x: placement.x,
        z: placement.z,
        radius: maxRadius + spacing * 0.6,
      });
    }

    this.batch.setInstances(this.instances);
  }

  /** Posicion y radio del bloque de fichas de un territorio. */
  layoutOf(territory: TerritoryId): SquadLayoutInfo | undefined {
    return this.layout.get(territory);
  }

  setTime(seconds: number): void {
    this.batch.setTime(seconds);
  }

  setDim(value: number): void {
    this.batch.setDim(value);
  }

  /** Cantidad total de unidades visibles, para el overlay de depuracion. */
  visibleUnits(): number {
    return this.batch.visibleUnits();
  }

  /** Tipos en orden de formacion, para quien necesite iterarlos. */
  static get order(): readonly UnitType[] {
    return UNIT_ORDER;
  }

  dispose(): void {
    this.batch.dispose();
  }
}
