/**
 * Matriz de adyacencia del tablero clasico de 50 territorios.
 *
 * PROCEDENCIA (datos de reglas, no expresion de terceros):
 * Esta lista fue triangulada contra tres fuentes independientes y coincide al
 * 100 % entre ellas:
 *   1. La matriz de adyacencia de una implementacion libre del servidor del
 *      tablero clasico (fuente autoritativa). Los nombres de los repositorios
 *      de referencia quedan fuera del codigo a proposito: ver
 *      docs/adr/0002-nombre-y-propiedad-intelectual.md.
 *   2. La lista explicita de territorios limitrofes de un segundo proyecto
 *      libre del mismo tablero.
 *   3. Verificacion geometrica por solapamiento de las imagenes del tablero
 *      fisico.
 *
 * Rarezas que son REALES en el tablero y por eso estan aca:
 *   chile-australia, egipto-polonia, oregon-alaska, iran-mongolia,
 *   gran_bretana-alemania, gran_bretana-espana, nueva_york-groenlandia.
 *
 * Uso: `adjacency.json` se DERIVA de la geometria + `seaLinks` del config y
 * `validate-map.ts` falla el build si el resultado no es exactamente esta
 * matriz. Asi el tablero renderizado y el grafo de reglas no pueden divergir.
 */

import type { ContinentId, TerritoryId } from '@conqueror/shared';

/** Vecinos declarados por territorio. El build simetriza y normaliza. */
export const CLASSIC_BOARD_NEIGHBORS: Readonly<Record<TerritoryId, readonly TerritoryId[]>> = {
  // ---- America del Sur ----
  argentina: ['brasil', 'chile', 'peru', 'uruguay'],
  brasil: ['argentina', 'colombia', 'peru', 'uruguay', 'sahara'],
  chile: ['argentina', 'peru', 'australia'],
  colombia: ['brasil', 'mexico', 'peru'],
  peru: ['argentina', 'brasil', 'chile', 'colombia'],
  uruguay: ['argentina', 'brasil'],

  // ---- America del Norte ----
  alaska: ['kamchatka', 'yukon', 'oregon'],
  canada: ['oregon', 'yukon', 'terranova', 'nueva_york'],
  california: ['oregon', 'nueva_york', 'mexico'],
  groenlandia: ['nueva_york', 'labrador', 'islandia'],
  labrador: ['terranova', 'groenlandia'],
  mexico: ['california', 'colombia'],
  nueva_york: ['oregon', 'canada', 'terranova', 'groenlandia', 'california'],
  oregon: ['alaska', 'yukon', 'canada', 'nueva_york', 'california'],
  terranova: ['canada', 'labrador', 'nueva_york'],
  yukon: ['alaska', 'canada', 'oregon'],

  // ---- Europa ----
  alemania: ['gran_bretana', 'polonia', 'italia', 'francia'],
  espana: ['gran_bretana', 'francia', 'sahara'],
  francia: ['espana', 'alemania', 'italia'],
  gran_bretana: ['islandia', 'alemania', 'espana'],
  islandia: ['groenlandia', 'suecia', 'gran_bretana'],
  italia: ['francia', 'alemania'],
  polonia: ['egipto', 'alemania', 'rusia', 'turquia'],
  rusia: ['turquia', 'polonia', 'suecia', 'aral', 'iran'],
  suecia: ['islandia', 'rusia'],

  // ---- Asia ----
  arabia: ['israel', 'turquia'],
  aral: ['iran', 'rusia', 'tartaria', 'siberia', 'mongolia'],
  china: ['iran', 'gobi', 'mongolia', 'siberia', 'kamchatka', 'japon', 'malasia', 'india'],
  gobi: ['iran', 'mongolia', 'china'],
  india: ['iran', 'china', 'malasia', 'sumatra'],
  iran: ['turquia', 'rusia', 'aral', 'mongolia', 'gobi', 'china', 'india'],
  israel: ['arabia', 'turquia', 'egipto'],
  japon: ['china', 'kamchatka'],
  kamchatka: ['china', 'siberia', 'alaska', 'japon'],
  malasia: ['india', 'china', 'borneo'],
  mongolia: ['iran', 'aral', 'siberia', 'china', 'gobi'],
  siberia: ['china', 'mongolia', 'aral', 'tartaria', 'taimir', 'kamchatka'],
  taimir: ['tartaria', 'siberia'],
  tartaria: ['aral', 'taimir', 'siberia'],
  turquia: ['arabia', 'israel', 'egipto', 'polonia', 'rusia', 'iran'],

  // ---- Africa ----
  egipto: ['israel', 'madagascar', 'etiopia', 'sahara', 'polonia', 'turquia'],
  etiopia: ['sahara', 'egipto', 'sudafrica', 'zaire'],
  madagascar: ['egipto', 'zaire'],
  sahara: ['espana', 'egipto', 'etiopia', 'zaire', 'brasil'],
  sudafrica: ['zaire', 'etiopia'],
  zaire: ['sahara', 'etiopia', 'sudafrica', 'madagascar'],

  // ---- Oceania ----
  australia: ['chile', 'sumatra', 'borneo', 'java'],
  borneo: ['malasia', 'australia'],
  java: ['australia'],
  sumatra: ['india', 'australia'],
};

/** Orden canonico de los continentes. */
export const CONTINENT_ORDER = [
  'america_del_sur',
  'america_del_norte',
  'europa',
  'asia',
  'africa',
  'oceania',
] as const;

/**
 * Continente de cada territorio.
 *
 * Es la misma agrupacion que `territories.config.json` (la fuente del mapa) y
 * los tests lo verifican: si alguien mueve un territorio de continente en un
 * lado y no en el otro, falla. El motor de reglas lo necesita para los bonos de
 * continente y para las misiones secretas, sin cargar los datos generados.
 */
export const CLASSIC_BOARD_CONTINENTS: Readonly<Record<TerritoryId, ContinentId>> = {
  // ---- America del Sur ----
  argentina: 'america_del_sur',
  brasil: 'america_del_sur',
  chile: 'america_del_sur',
  colombia: 'america_del_sur',
  peru: 'america_del_sur',
  uruguay: 'america_del_sur',

  // ---- America del Norte ----
  alaska: 'america_del_norte',
  canada: 'america_del_norte',
  california: 'america_del_norte',
  groenlandia: 'america_del_norte',
  labrador: 'america_del_norte',
  mexico: 'america_del_norte',
  nueva_york: 'america_del_norte',
  oregon: 'america_del_norte',
  terranova: 'america_del_norte',
  yukon: 'america_del_norte',

  // ---- Europa ----
  alemania: 'europa',
  espana: 'europa',
  francia: 'europa',
  gran_bretana: 'europa',
  islandia: 'europa',
  italia: 'europa',
  polonia: 'europa',
  rusia: 'europa',
  suecia: 'europa',

  // ---- Asia ----
  arabia: 'asia',
  aral: 'asia',
  china: 'asia',
  gobi: 'asia',
  india: 'asia',
  iran: 'asia',
  israel: 'asia',
  japon: 'asia',
  kamchatka: 'asia',
  malasia: 'asia',
  mongolia: 'asia',
  siberia: 'asia',
  taimir: 'asia',
  tartaria: 'asia',
  turquia: 'asia',

  // ---- Africa ----
  egipto: 'africa',
  etiopia: 'africa',
  madagascar: 'africa',
  sahara: 'africa',
  sudafrica: 'africa',
  zaire: 'africa',

  // ---- Oceania ----
  australia: 'oceania',
  borneo: 'oceania',
  java: 'oceania',
  sumatra: 'oceania',
};

/** Ids de los 50 territorios, en orden de tablero. */
export const TERRITORY_IDS: readonly TerritoryId[] = Object.keys(CLASSIC_BOARD_NEIGHBORS);

/** Territorios de cada continente, derivados de `CLASSIC_BOARD_CONTINENTS`. */
export const CLASSIC_BOARD_TERRITORIES_BY_CONTINENT: Readonly<
  Record<ContinentId, readonly TerritoryId[]>
> = Object.fromEntries(
  CONTINENT_ORDER.map((continent) => [
    continent,
    TERRITORY_IDS.filter((territory) => CLASSIC_BOARD_CONTINENTS[territory] === continent),
  ]),
);

/** Normaliza un par como `[menor, mayor]`. */
export function normalizePair(a: TerritoryId, b: TerritoryId): readonly [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** Clave estable para un par no ordenado. */
export function pairKey(a: TerritoryId, b: TerritoryId): string {
  const [x, y] = normalizePair(a, b);
  return `${x}|${y}`;
}

/** Aristas unicas del tablero clasico, normalizadas y ordenadas. */
export function classicBoardEdges(): readonly (readonly [string, string])[] {
  const seen = new Set<string>();
  const edges: [string, string][] = [];
  for (const [from, neighbors] of Object.entries(CLASSIC_BOARD_NEIGHBORS)) {
    for (const to of neighbors) {
      const key = pairKey(from, to);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([...normalizePair(from, to)]);
    }
  }
  return edges.sort((a, b) =>
    a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]),
  );
}

/** Convierte una lista de aristas en un mapa de vecinos ordenado. */
export function edgesToNeighbors(
  edges: readonly (readonly [TerritoryId, TerritoryId])[],
): Record<TerritoryId, TerritoryId[]> {
  const out: Record<TerritoryId, TerritoryId[]> = {};
  for (const id of TERRITORY_IDS) out[id] = [];
  for (const [a, b] of edges) {
    out[a]?.push(b);
    out[b]?.push(a);
  }
  for (const id of Object.keys(out)) out[id]?.sort((x, y) => x.localeCompare(y));
  return out;
}
