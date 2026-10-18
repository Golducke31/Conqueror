/**
 * Paleta del juego.
 *
 * Los valores tienen que coincidir con los tokens de `styles/main.css`; aca se
 * repiten en TypeScript porque WebGL no lee variables CSS.
 */

import { Color } from 'three';
import type { PlayerColorId } from '@conqueror/shared';

/** Color de cada jugador, en orden de turno. */
export const PLAYER_COLORS: Readonly<Record<PlayerColorId, string>> = {
  rojo: '#c0392b',
  azul: '#2f6fb5',
  amarillo: '#e2a72e',
  verde: '#2f6b4f',
  negro: '#2e3440',
  magenta: '#a03a8c',
};

/** Oceano: un tono por encima del fondo, para que se lea el borde del tablero. */
export const OCEAN_COLOR = new Color('#121c36');
/** Territorio sin dueno. */
export const NEUTRAL_COLOR = new Color('#28335c');
/** Lineas de frontera y costa. */
export const BORDER_COLOR = new Color('#8fa0c8');
/** Rutas maritimas. */
export const SEA_ROUTE_COLOR = new Color('#e2a72e');
/** Resaltado al pasar el puntero. */
export const HOVER_COLOR = new Color('#efe4cc');
/** Resaltado del territorio seleccionado (origen de la accion). */
export const SELECT_COLOR = new Color('#e2a72e');
/**
 * Resaltado del destino de ataque. Rojo mas luminoso que `grana` porque aca se
 * mezcla con el color del territorio enemigo y tiene que distinguirse de el.
 */
export const TARGET_COLOR = new Color('#d8414f');
/** Color de las etiquetas numericas sin dueno. */
export const LABEL_NEUTRAL_COLOR = new Color('#c9d3ea');
/** Color del nombre del territorio impreso sobre el mapa. */
export const LABEL_COLOR = new Color('#dfe7f7');
/** Color del nombre resaltado (territorio apuntado, origen o destino). */
export const LABEL_EMPHASIS_COLOR = new Color('#ffe6a8');

const cache = new Map<string, Color>();

/** Color de un jugador, cacheado para no crear objetos por frame. */
export function playerColor(color: PlayerColorId): Color {
  const hex = PLAYER_COLORS[color];
  const existing = cache.get(hex);
  if (existing !== undefined) return existing;
  const created = new Color(hex);
  cache.set(hex, created);
  return created;
}
