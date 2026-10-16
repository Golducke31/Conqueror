/**
 * Identificadores del dominio.
 *
 * Decision de diseno: son alias de `string`, no tipos con marca (branded).
 * Motivo: el estado del juego viaja serializado (JSON, Colyseus Schema, guardado
 * local) y con tipos con marca cada deserializacion necesitaria un cast, lo que
 * agrega ruido sin seguridad real. La integridad se valida en los bordes con zod
 * (`packages/shared/src/protocol.ts`) y en los tests del motor.
 * Ver docs/adr/0003-motor-de-reglas-puro-y-determinista.md
 */

/** Identificador de un territorio jugable (ej: 'brasil'). */
export type TerritoryId = string;

/** Identificador de un continente (ej: 'america_del_sur'). */
export type ContinentId = string;

/** Identificador de un jugador dentro de una partida. */
export type PlayerId = string;

/** Identificador de una tarjeta del mazo. */
export type CardId = string;

/** Simbolo de tarjeta. */
export type CardSymbol = 'barco' | 'canion' | 'globo';

/** Color asignado a un jugador, en orden de turno. */
export type PlayerColorId = 'rojo' | 'azul' | 'amarillo' | 'verde' | 'negro' | 'magenta';

/** Orden canonico de los colores de jugador. */
export const PLAYER_COLOR_ORDER: readonly PlayerColorId[] = [
  'rojo',
  'azul',
  'amarillo',
  'verde',
  'negro',
  'magenta',
];

/** Idiomas soportados. `es-AR` es el principal; `en` el secundario. */
export type Locale = 'es-AR' | 'en';

/** Idiomas soportados, en orden de preferencia. */
export const LOCALES: readonly Locale[] = ['es-AR', 'en'];

/** Idioma por defecto. */
export const DEFAULT_LOCALE: Locale = 'es-AR';

/** Nombres de un elemento en cada idioma soportado. */
export type LocalizedNames = Readonly<Record<Locale, string>>;
