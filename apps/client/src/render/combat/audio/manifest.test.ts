import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SOUND_SLOT,
  expectedFileName,
  normalizeSlot,
  validateManifest,
} from './manifest.js';

describe('manifest', () => {
  describe('validateManifest', () => {
    it('acepta un manifiesto vacio (silencio total)', () => {
      const result = validateManifest({});
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual({});
    });

    it('aplica los valores por defecto a un slot minimo', () => {
      const result = validateManifest({ 'cannon.fire': { files: [] } });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value['cannon.fire']).toEqual({ ...DEFAULT_SOUND_SLOT, files: [] });
    });

    it('acepta slots de ambiente en el bus de ambiente', () => {
      const result = validateManifest({
        'battle.ambience.low': { files: ['amb_low.mp3'], bus: 'ambience', volume: 0.6 },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const slot = result.value['battle.ambience.low'];
      expect(slot?.bus).toBe('ambience');
      expect(slot?.volume).toBeCloseTo(0.6, 10);
    });

    it('rechaza lo que no es un objeto', () => {
      for (const valor of [null, 42, 'manifiesto', []]) {
        const result = validateManifest(valor);
        expect(result.ok).toBe(false);
      }
    });

    it('rechaza nombres de slot que no son grupo.nombre', () => {
      const result = validateManifest({ cannonfire: { files: [] } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.join(' ')).toContain('grupo.nombre');
    });

    it('rechaza campos desconocidos (erratas del usuario)', () => {
      const result = validateManifest({ 'cannon.fire': { file: ['a.mp3'] } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.join(' ')).toContain('desconocido');
    });

    it('rechaza rutas que escapan del directorio del manifiesto', () => {
      for (const ruta of ['/etc/passwd', '../../secreto.mp3', 'C:\\audio.mp3']) {
        const result = validateManifest({ 'cannon.fire': { files: [ruta] } });
        expect(result.ok).toBe(false);
      }
    });

    it('rechaza valores fuera de rango', () => {
      const casos: readonly unknown[] = [
        { 'cannon.fire': { files: [], volume: 2 } },
        { 'cannon.fire': { files: [], volume: -0.1 } },
        { 'cannon.fire': { files: [], pitchVariance: 0.9 } },
        { 'cannon.fire': { files: [], maxVoices: 0 } },
        { 'cannon.fire': { files: [], maxVoices: 1.5 } },
        { 'cannon.fire': { files: [], cooldownMs: -5 } },
        { 'cannon.fire': { files: [], bus: 'musica' } },
      ];
      for (const caso of casos) {
        const result = validateManifest(caso);
        expect(result.ok, JSON.stringify(caso)).toBe(false);
      }
    });

    it('acumula todos los errores, no solo el primero', () => {
      const result = validateManifest({
        cannonfire: { files: [] },
        'cannon.fire': { files: ['../x.mp3'] },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.length).toBe(2);
    });

    it('normaliza un slot de forma aislada', () => {
      const result = normalizeSlot('dice.roll', {
        files: ['dice_roll_1.mp3', 'dice_roll_2.mp3'],
        volume: 0.8,
        pitchVariance: 0.06,
        maxVoices: 3,
        cooldownMs: 120,
        bus: 'effects',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({
        files: ['dice_roll_1.mp3', 'dice_roll_2.mp3'],
        volume: 0.8,
        pitchVariance: 0.06,
        maxVoices: 3,
        cooldownMs: 120,
        bus: 'effects',
      });
    });
  });

  describe('expectedFileName', () => {
    it('sigue la convencion del plan', () => {
      expect(expectedFileName('cannon.fire', 1)).toBe('cannon_fire_1.mp3');
      expect(expectedFileName('battle.ambience.low', 2)).toBe('battle_ambience_low_2.mp3');
      expect(expectedFileName('dice.roll', 3)).toBe('dice_roll_3.mp3');
    });
  });
});
