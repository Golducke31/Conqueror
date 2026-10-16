/**
 * Manifiesto de sonidos: esquema y validacion.
 *
 * Funcion PURA: no toca el DOM ni Web Audio. Convierte el JSON que edita el
 * usuario (`public/audio/combat/manifest.json`) en definiciones tipadas, o
 * explica por que no se puede. El `AudioManager` es el unico que sabe usar el
 * resultado (ADR 0011).
 *
 * Convenciones:
 *   - El nombre de cada slot es `grupo.nombre` (al menos dos segmentos),
 *     por ejemplo `cannon.fire` o `battle.ambience.low`.
 *   - Las rutas de `files` son relativas al manifiesto (o sea, a
 *     `audio/combat/`); la convencion de nombres del plan es
 *     `public/audio/combat/<slot_con_guion_bajo>_<n>.mp3`.
 *   - Un slot con `files: []` es valido: es un sonido que todavia no existe
 *     y el juego corre en silencio sin errores.
 */

import type { Result } from '@conqueror/rules';

/** Bus de mezcla al que pertenece un slot. */
export type AudioBus = 'effects' | 'ambience';

/** Definicion de un slot de sonido. */
export interface SoundSlot {
  /** Rutas de los archivos, relativas al manifiesto. Vacias = sin sonido. */
  readonly files: readonly string[];
  /** Volumen propio del slot (0 a 1). */
  readonly volume: number;
  /** Variacion de tono (±fraccion de `playbackRate`). */
  readonly pitchVariance: number;
  /** Voces simultaneas maximas del slot. */
  readonly maxVoices: number;
  /** Milisegundos minimos entre dos senales del mismo slot. */
  readonly cooldownMs: number;
  /** Bus de mezcla. */
  readonly bus: AudioBus;
}

/** Manifiesto completo: nombre de slot → definicion. */
export type SoundManifest = Readonly<Record<string, SoundSlot>>;

/** Valores por defecto de un slot cuando el usuario omite campos. */
export const DEFAULT_SOUND_SLOT: Omit<SoundSlot, 'files'> = {
  volume: 1,
  pitchVariance: 0,
  maxVoices: 2,
  cooldownMs: 60,
  bus: 'effects',
};

/** Nombres de los tres ambientes que cruza el calor de batalla. */
export const AMBIENCE_SLOTS = {
  low: 'battle.ambience.low',
  mid: 'battle.ambience.mid',
  high: 'battle.ambience.high',
} as const;

/** Al menos dos segmentos `grupo.nombre`, cada uno en camelCase o lowerCamel. */
const SLOT_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

/** Campos reconocidos de un slot: cualquier otro es una errata del usuario. */
const KNOWN_FIELDS: readonly string[] = [
  'files',
  'volume',
  'pitchVariance',
  'maxVoices',
  'cooldownMs',
  'bus',
];

const BUSES: readonly AudioBus[] = ['effects', 'ambience'];

function esNumero(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Una ruta de archivo: relativa, sin escapar del directorio del manifiesto. */
function esRutaValida(path: string): boolean {
  if (path === '') return false;
  // Ni absoluta ni con separadores de Windows: el manifiesto vive servido.
  if (path.includes('\\')) return false;
  if (path.startsWith('/')) return false;
  // Sin subir de directorio.
  for (const segmento of path.split('/')) {
    if (segmento === '..') return false;
  }
  return true;
}

/**
 * Valida UN slot a partir de su valor crudo del JSON.
 * Devuelve la definicion con los valores por defecto aplicados.
 */
export function normalizeSlot(name: string, raw: unknown): Result<SoundSlot, string> {
  if (!SLOT_NAME_PATTERN.test(name)) {
    return {
      ok: false,
      error: `el nombre de slot «${name}» debe ser grupo.nombre (por ejemplo cannon.fire)`,
    };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: `el slot «${name}» debe ser un objeto` };
  }

  const slot = raw as Record<string, unknown>;
  for (const key of Object.keys(slot)) {
    if (!KNOWN_FIELDS.includes(key)) {
      return { ok: false, error: `el slot «${name}» tiene el campo desconocido «${key}»` };
    }
  }

  let files: readonly string[] = [];
  if (slot.files !== undefined) {
    if (!Array.isArray(slot.files)) {
      return { ok: false, error: `el slot «${name}»: «files» debe ser una lista` };
    }
    const rutas: string[] = [];
    for (const file of slot.files as unknown[]) {
      if (typeof file !== 'string' || !esRutaValida(file)) {
        return {
          ok: false,
          error: `el slot «${name}»: «${String(file)}» no es una ruta relativa valida`,
        };
      }
      rutas.push(file);
    }
    files = rutas;
  }

  let volume = DEFAULT_SOUND_SLOT.volume;
  if (slot.volume !== undefined) {
    if (!esNumero(slot.volume) || slot.volume < 0 || slot.volume > 1) {
      return { ok: false, error: `el slot «${name}»: «volume» debe estar entre 0 y 1` };
    }
    volume = slot.volume;
  }

  let pitchVariance = DEFAULT_SOUND_SLOT.pitchVariance;
  if (slot.pitchVariance !== undefined) {
    if (!esNumero(slot.pitchVariance) || slot.pitchVariance < 0 || slot.pitchVariance > 0.5) {
      return {
        ok: false,
        error: `el slot «${name}»: «pitchVariance» debe estar entre 0 y 0.5`,
      };
    }
    pitchVariance = slot.pitchVariance;
  }

  let maxVoices = DEFAULT_SOUND_SLOT.maxVoices;
  if (slot.maxVoices !== undefined) {
    if (!Number.isInteger(slot.maxVoices) || (slot.maxVoices as number) < 1) {
      return { ok: false, error: `el slot «${name}»: «maxVoices» debe ser un entero ≥ 1` };
    }
    maxVoices = slot.maxVoices as number;
  }

  let cooldownMs = DEFAULT_SOUND_SLOT.cooldownMs;
  if (slot.cooldownMs !== undefined) {
    if (!esNumero(slot.cooldownMs) || slot.cooldownMs < 0) {
      return { ok: false, error: `el slot «${name}»: «cooldownMs» debe ser ≥ 0` };
    }
    cooldownMs = slot.cooldownMs;
  }

  let bus = DEFAULT_SOUND_SLOT.bus;
  if (slot.bus !== undefined) {
    if (!BUSES.includes(slot.bus as AudioBus)) {
      return {
        ok: false,
        error: `el slot «${name}»: «bus» debe ser ${BUSES.join(' o ')}`,
      };
    }
    bus = slot.bus as AudioBus;
  }

  return { ok: true, value: { files, volume, pitchVariance, maxVoices, cooldownMs, bus } };
}

/**
 * Valida el manifiesto completo. Un manifiesto invalido se rechaza ENTERO
 * (silencio) y se explican todos los problemas encontrados.
 */
export function validateManifest(data: unknown): Result<SoundManifest, readonly string[]> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: ['el manifiesto debe ser un objeto de slots'] };
  }

  const entries = Object.entries(data as Record<string, unknown>);
  const manifest: Record<string, SoundSlot> = {};
  const errores: string[] = [];

  for (const [name, raw] of entries) {
    const resultado = normalizeSlot(name, raw);
    if (resultado.ok) manifest[name] = resultado.value;
    else errores.push(resultado.error);
  }

  if (errores.length > 0) return { ok: false, error: errores };
  return { ok: true, value: manifest };
}

/**
 * Nombre de archivo esperado para la variacion `n` de un slot, segun la
 * convencion del plan (`<slot_con_guion_bajo>_<n>.mp3`). Lo usa la pagina
 * `/debug/sounds` para mostrar que falta.
 */
export function expectedFileName(slot: string, variation: number): string {
  return `${slot.replace(/\./g, '_')}_${variation}.mp3`;
}
