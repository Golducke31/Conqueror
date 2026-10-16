/**
 * Carga y validacion del `territories.config.json`.
 *
 * Solo se usa desde scripts de Node (`@conqueror/map-data/node`). El cliente no
 * importa este modulo, por eso vive fuera del entrypoint principal.
 */

import { readFileSync } from 'node:fs';
import { mapConfigSchema } from './config-schema.js';
import type { MapConfig } from './types.js';

/** Valida un objeto ya parseado y lo devuelve tipado. */
export function parseMapConfig(raw: unknown): MapConfig {
  const parsed = mapConfigSchema.parse(raw);
  return parsed as MapConfig;
}

/** Lee y valida la config desde disco. */
export function loadMapConfig(filePath: string): MapConfig {
  const text = readFileSync(filePath, 'utf8');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`No se pudo parsear ${filePath} como JSON`, { cause: error });
  }
  return parseMapConfig(raw);
}
