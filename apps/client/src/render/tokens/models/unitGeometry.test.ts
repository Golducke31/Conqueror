import { BoxGeometry, Float32BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';

import { DEFAULT_MODEL_SLOT, TRIANGLE_BUDGET, type ModelSlot } from './manifest.js';
import { normalizeUnitGeometry, triangleCount, withinBudget } from './unitGeometry.js';

/** Un slot con los valores por defecto y el archivo que se quiera. */
function slot(overrides: Partial<ModelSlot> = {}): ModelSlot {
  return { file: 'infantry.glb', ...DEFAULT_MODEL_SLOT, ...overrides };
}

/** Caja con color y mascara por vertice: el caso ideal del contrato. */
function cajaConColor(mask = 1): BoxGeometry {
  const geometry = new BoxGeometry(2, 2, 2);
  const count = geometry.getAttribute('position').count;
  const color = new Float32Array(count * 3);
  const mascara = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    color[index * 3] = 0.5;
    color[index * 3 + 1] = 0.25;
    color[index * 3 + 2] = 0.125;
    mascara[index] = mask;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(color, 3));
  geometry.setAttribute('_MASK', new Float32BufferAttribute(mascara, 1));
  return geometry;
}

describe('unitGeometry', () => {
  describe('triangleCount', () => {
    it('cuenta los triangulos de una geometria indexada', () => {
      expect(triangleCount(new BoxGeometry(1, 1, 1))).toBe(12);
    });

    it('cuenta los triangulos de una geometria sin indice', () => {
      const geometry = new BoxGeometry(1, 1, 1).toNonIndexed();
      expect(triangleCount(geometry)).toBe(12);
    });
  });

  describe('withinBudget', () => {
    it('compara contra el presupuesto del tipo', () => {
      expect(withinBudget('infantry', TRIANGLE_BUDGET.infantry)).toBe(true);
      expect(withinBudget('infantry', TRIANGLE_BUDGET.infantry + 1)).toBe(false);
      expect(withinBudget('ship', TRIANGLE_BUDGET.ship)).toBe(true);
    });
  });

  describe('normalizeUnitGeometry', () => {
    it('copia el color por vertice al atributo aColor', () => {
      const result = normalizeUnitGeometry(cajaConColor(), slot());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const color = result.value.getAttribute('aColor');
      expect(color.count).toBe(24);
      expect(color.getX(0)).toBeCloseTo(0.5, 5);
      expect(color.getY(0)).toBeCloseTo(0.25, 5);
      expect(color.getZ(0)).toBeCloseTo(0.125, 5);
    });

    it('copia la mascara por vertice al atributo aMask', () => {
      const result = normalizeUnitGeometry(cajaConColor(0.75), slot());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const mascara = result.value.getAttribute('aMask');
      expect(mascara.itemSize).toBe(1);
      expect(mascara.getX(3)).toBeCloseTo(0.75, 5);
    });

    it('usa el color plano del manifiesto si el modelo no trae color', () => {
      const result = normalizeUnitGeometry(
        new BoxGeometry(1, 1, 1),
        slot({ baseColor: '#ff0000' }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const color = result.value.getAttribute('aColor');
      expect(color.getX(0)).toBeCloseTo(1, 5);
      expect(color.getY(0)).toBeCloseTo(0, 5);
      expect(color.getZ(0)).toBeCloseTo(0, 5);
    });

    it('usa la mascara del manifiesto si el modelo no trae el atributo', () => {
      const result = normalizeUnitGeometry(new BoxGeometry(1, 1, 1), slot({ maskValue: 1 }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.getAttribute('aMask').getX(0)).toBeCloseTo(1, 5);
    });

    it('recorta la mascara al rango 0..1', () => {
      const geometry = new BoxGeometry(1, 1, 1);
      const count = geometry.getAttribute('position').count;
      const mascara = new Float32Array(count);
      mascara[0] = 4;
      mascara[1] = -3;
      geometry.setAttribute('_MASK', new Float32BufferAttribute(mascara, 1));

      const result = normalizeUnitGeometry(geometry, slot());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const atributo = result.value.getAttribute('aMask');
      expect(atributo.getX(0)).toBe(1);
      expect(atributo.getX(1)).toBe(0);
    });

    it('aplica la escala y el desplazamiento vertical del manifiesto', () => {
      const result = normalizeUnitGeometry(
        new BoxGeometry(2, 2, 2),
        slot({ scale: 0.5, yOffset: 3 }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const position = result.value.getAttribute('position');
      // La caja va de -1 a 1: con escala 0.5 queda de -0.5 a 0.5, mas el alza.
      expect(position.getY(0)).toBeGreaterThanOrEqual(2.5);
      expect(position.getY(0)).toBeLessThanOrEqual(3.5);
      expect(position.getX(0)).toBeGreaterThanOrEqual(-0.5);
      expect(position.getX(0)).toBeLessThanOrEqual(0.5);
    });

    it('recalcula los volumenes despues de transformar', () => {
      const result = normalizeUnitGeometry(new BoxGeometry(2, 2, 2), slot({ scale: 4 }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const radio = result.value.boundingSphere?.radius ?? 0;
      expect(radio).toBeGreaterThan(3);
    });

    it('calcula normales si el modelo no las trae', () => {
      const geometry = new BoxGeometry(1, 1, 1);
      geometry.deleteAttribute('normal');
      const result = normalizeUnitGeometry(geometry, slot());
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.getAttribute('normal')).toBeDefined();
    });

    it('no toca la geometria de entrada', () => {
      const original = cajaConColor();
      const antes = original.getAttribute('position').getX(0);

      const result = normalizeUnitGeometry(original, slot({ scale: 3 }));

      expect(result.ok).toBe(true);
      expect(original.getAttribute('aColor')).toBeUndefined();
      expect(original.getAttribute('position').getX(0)).toBeCloseTo(antes, 5);
    });

    it('rechaza un modelo sin vertices', () => {
      const vacia = new BoxGeometry(1, 1, 1);
      vacia.deleteAttribute('position');
      const falla = normalizeUnitGeometry(vacia, slot());
      expect(falla.ok).toBe(false);
      if (!falla.ok) expect(falla.error).toContain('vertices');
    });

    it('cae al color plano si el atributo de color es inservible', () => {
      // Un exportador que saca COLOR_0 con dos componentes no tiene que tirar
      // abajo el modelo: se usa el color plano del manifiesto.
      const geometry = new BoxGeometry(1, 1, 1);
      const count = geometry.getAttribute('position').count;
      geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(count * 2), 2));

      const result = normalizeUnitGeometry(geometry, slot({ baseColor: '#00ff00' }));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const color = result.value.getAttribute('aColor');
      expect(color.getX(0)).toBeCloseTo(0, 5);
      expect(color.getY(0)).toBeCloseTo(1, 5);
    });

    it('respeta nombres de atributo propios del artista', () => {
      const geometry = new BoxGeometry(1, 1, 1);
      const count = geometry.getAttribute('position').count;
      geometry.setAttribute(
        'uniforme',
        new Float32BufferAttribute(new Float32Array(count).fill(1), 1),
      );
      const result = normalizeUnitGeometry(
        geometry,
        slot({ maskAttribute: 'uniforme', colorAttribute: 'color' }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.getAttribute('aMask').getX(0)).toBe(1);
    });
  });
});
