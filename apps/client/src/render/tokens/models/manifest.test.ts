import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MODEL_SLOT,
  expectedModelFileName,
  normalizeModelSlot,
  TRIANGLE_BUDGET,
  UNIT_MODEL_TYPES,
  validateModelManifest,
} from './manifest.js';

describe('model manifest', () => {
  describe('validateModelManifest', () => {
    it('acepta un manifiesto vacio (todas las primitivas)', () => {
      const result = validateModelManifest({});
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual({});
    });

    it('aplica los valores por defecto a un tipo minimo', () => {
      const result = validateModelManifest({ infantry: { file: 'infantry.glb' } });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.infantry).toEqual({ ...DEFAULT_MODEL_SLOT, file: 'infantry.glb' });
    });

    it('acepta solo algunos tipos: el resto queda con su primitiva', () => {
      const result = validateModelManifest({ ship: { file: 'naval/ship.glb', scale: 1.4 } });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(Object.keys(result.value)).toEqual(['ship']);
      expect(result.value.infantry).toBeUndefined();
      expect(result.value.ship?.scale).toBeCloseTo(1.4, 10);
    });

    it('ignora las claves de comentario (empiezan con guion bajo)', () => {
      const result = validateModelManifest({
        _comentario: 'los modelos van en public/models/combat/',
        infantry: { file: 'infantry.glb' },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(Object.keys(result.value)).toEqual(['infantry']);
    });

    it('rechaza lo que no es un objeto', () => {
      for (const valor of [null, 42, 'manifiesto', []]) {
        expect(validateModelManifest(valor).ok, String(valor)).toBe(false);
      }
    });

    it('rechaza tipos que no existen', () => {
      const result = validateModelManifest({ dragon: { file: 'dragon.glb' } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.join(' ')).toContain('no existe');
    });

    it('rechaza campos desconocidos (erratas del usuario)', () => {
      const result = validateModelManifest({ infantry: { file: 'a.glb', tint: true } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.join(' ')).toContain('desconocido');
    });

    it('rechaza archivos que no son glTF', () => {
      for (const file of ['infantry.fbx', 'infantry.obj', 'infantry']) {
        expect(validateModelManifest({ infantry: { file } }).ok, file).toBe(false);
      }
    });

    it('rechaza rutas que escapan del directorio del manifiesto', () => {
      for (const file of ['/etc/models.glb', '../../secreto.glb', 'C:\\modelo.glb']) {
        expect(validateModelManifest({ infantry: { file } }).ok, file).toBe(false);
      }
    });

    it('rechaza escalas, desplazamientos y mascaras fuera de rango', () => {
      const casos: readonly unknown[] = [
        { infantry: { file: 'a.glb', scale: 0 } },
        { infantry: { file: 'a.glb', scale: -1 } },
        { infantry: { file: 'a.glb', scale: Number.NaN } },
        { infantry: { file: 'a.glb', yOffset: 'arriba' } },
        { infantry: { file: 'a.glb', maskValue: 2 } },
        { infantry: { file: 'a.glb', maskValue: -0.5 } },
      ];
      for (const caso of casos) {
        expect(validateModelManifest(caso).ok, JSON.stringify(caso)).toBe(false);
      }
    });

    it('rechaza atributos invalidos o reservados', () => {
      const casos: readonly unknown[] = [
        { infantry: { file: 'a.glb', colorAttribute: '2color' } },
        { infantry: { file: 'a.glb', colorAttribute: 'a-color' } },
        { infantry: { file: 'a.glb', colorAttribute: 'position' } },
        { infantry: { file: 'a.glb', maskAttribute: 'normal' } },
        { infantry: { file: 'a.glb', maskAttribute: '' } },
      ];
      for (const caso of casos) {
        expect(validateModelManifest(caso).ok, JSON.stringify(caso)).toBe(false);
      }
    });

    it('rechaza colores planos y canales de mascara invalidos', () => {
      const casos: readonly unknown[] = [
        { infantry: { file: 'a.glb', baseColor: 'rojo' } },
        { infantry: { file: 'a.glb', baseColor: '#fff' } },
        { infantry: { file: 'a.glb', baseColor: 'ffffff' } },
        { infantry: { file: 'a.glb', maskChannel: 'azul' } },
      ];
      for (const caso of casos) {
        expect(validateModelManifest(caso).ok, JSON.stringify(caso)).toBe(false);
      }
    });

    it('acepta el color plano y el canal de mascara validos', () => {
      const result = validateModelManifest({
        infantry: { file: 'a.glb', baseColor: '#C9C2B4', maskChannel: 'a' },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.infantry?.baseColor).toBe('#c9c2b4');
      expect(result.value.infantry?.maskChannel).toBe('a');
    });

    it('acumula todos los errores, no solo el primero', () => {
      const result = validateModelManifest({
        dragon: { file: 'dragon.glb' },
        infantry: { file: '../infanteria.glb' },
        ship: { file: 'navio.glb', scale: -2 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.length).toBe(3);
    });

    it('normaliza un tipo de forma aislada', () => {
      const result = normalizeModelSlot('artillery', {
        file: 'artilleria/canon.glb',
        scale: 0.85,
        yOffset: 0.2,
        colorAttribute: 'color',
        maskAttribute: 'uniforme',
        maskValue: 1,
        baseColor: '#8d9199',
        maskChannel: 'g',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({
        file: 'artilleria/canon.glb',
        scale: 0.85,
        yOffset: 0.2,
        colorAttribute: 'color',
        maskAttribute: 'uniforme',
        maskValue: 1,
        baseColor: '#8d9199',
        maskChannel: 'g',
      });
    });
  });

  describe('presupuesto y convenciones', () => {
    it('el presupuesto cubre los cuatro tipos con los valores del plan', () => {
      expect(UNIT_MODEL_TYPES).toEqual(['infantry', 'cavalry', 'artillery', 'ship']);
      expect(TRIANGLE_BUDGET.infantry).toBe(500);
      expect(TRIANGLE_BUDGET.cavalry).toBe(500);
      expect(TRIANGLE_BUDGET.artillery).toBe(800);
      expect(TRIANGLE_BUDGET.ship).toBe(1200);
    });

    it('el nombre esperado sigue la convencion del plan', () => {
      expect(expectedModelFileName('infantry')).toBe('infantry.glb');
      expect(expectedModelFileName('ship')).toBe('ship.glb');
    });
  });
});
