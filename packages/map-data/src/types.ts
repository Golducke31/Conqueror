/**
 * Tipos del tablero: configuracion de entrada y artefactos generados.
 */

import type { ContinentId, LocalizedNames, TerritoryId } from '@conqueror/shared';

/** Origen Natural Earth de un territorio. */
export interface TerritorySource {
  /**
   * Paises que forman el territorio ENTEROS, por codigo ISO_A3 de
   * `admin_0_countries` (ej: 'ARG').
   */
  readonly countries?: readonly string[];
  /**
   * Subdivisiones de primer nivel (`admin_1_states_provinces`), por pais:
   * `{ "USA": ["Alaska"] }`. El resto del pais queda disponible para otro
   * territorio o para absorcion automatica.
   */
  readonly subdivisions?: Readonly<Record<string, readonly string[]>>;
}

/** Un territorio jugable declarado a mano. */
export interface TerritoryConfigEntry {
  readonly id: TerritoryId;
  readonly names: LocalizedNames;
  readonly continent: ContinentId;
  readonly source: TerritorySource;
  /**
   * Enlaces no terrestres del tablero: rutas maritimas, estrechos y corredores
   * estilizados que el juego clasico considera adyacentes aunque la geometria
   * no comparta frontera. Debe declararse en un solo sentido; el build lo
   * simetriza.
   */
  readonly seaLinks?: readonly TerritoryId[];
  /**
   * Fronteras terrestres reales que el tablero NO considera adyacentes. Se
   * declaran aca para reconciliar la geometria real con el grafo de reglas.
   */
  readonly ignoreLandBorders?: readonly TerritoryId[];
}

/** Un continente con su nombre en cada idioma. */
export interface ContinentConfigEntry {
  readonly id: ContinentId;
  readonly names: LocalizedNames;
}

/** Configuracion completa del tablero. */
export interface MapConfig {
  readonly version: number;
  readonly dataset: {
    /** Ruta relativa a la raiz del repo donde `pnpm map:fetch` deja los datos. */
    readonly dir: string;
    readonly admin0: string;
    readonly admin1: string;
    readonly scale: string;
  };
  readonly build: {
    /** Tolerancia de simplificacion en grados (topojson-simplify). */
    readonly simplificationTolerance: number;
    /** Cuantizacion del TopoJSON de salida. */
    readonly quantization: number;
    /** Area minima en km2 para conservar una isla suelta. */
    readonly minIslandAreaKm2: number;
    /**
     * Absorber los paises sin asignar al territorio con el que comparten mas
     * frontera, para que el mapa no quede con huecos.
     */
    readonly absorbUnassigned: boolean;
  };
  readonly continents: readonly ContinentConfigEntry[];
  readonly territories: readonly TerritoryConfigEntry[];
}

/** Geometria resumida de un territorio, para render, picking y etiquetas. */
export interface TerritoryGeometry {
  readonly id: TerritoryId;
  readonly names: LocalizedNames;
  readonly continent: ContinentId;
  /** Cantidad de anillos exteriores que componen el territorio. */
  readonly polygonCount: number;
  /** Centroide geodesico `[lon, lat]`. */
  readonly centroid: readonly [number, number];
  /** Punto recomendado para etiquetas y fichas, `[lon, lat]`. */
  readonly labelAnchor: readonly [number, number];
  /**
   * Caja envolvente `[minLon, minLat, maxLon, maxLat]` en longitud DESENROLLADA:
   * si el territorio cruza el antimeridiano (Chukotka, Fiyi), `maxLon` puede
   * superar 180 o `minLon` bajar de -180, para que el rectangulo siga siendo
   * valido y util para encuadres de camara.
   */
  readonly bbox: readonly [number, number, number, number];
  /** `true` si el territorio cruza el antimeridiano. */
  readonly crossesAntimeridian: boolean;
  /** Superficie aproximada en km2. */
  readonly areaKm2: number;
  /** Grados de libertad del grafo de adyacencia. */
  readonly degree: number;
}

/** `territories.json` */
export interface TerritoriesFile {
  readonly version: number;
  readonly generatedAt: string;
  readonly generator: string;
  readonly dataset: string;
  readonly projectionNote: string;
  readonly territories: readonly TerritoryGeometry[];
}

/** Par no ordenado de territorios. */
export type TerritoryPair = readonly [TerritoryId, TerritoryId];

/** `adjacency.json` */
export interface AdjacencyFile {
  readonly version: number;
  readonly generatedAt: string;
  readonly generator: string;
  /** Aristas del grafo de reglas, normalizadas como `[menor, mayor]`. */
  readonly edges: readonly TerritoryPair[];
  /** Lista de vecinos por territorio, ordenada alfabeticamente. */
  readonly byTerritory: Readonly<Record<TerritoryId, readonly TerritoryId[]>>;
  /** Subconjunto de aristas que son enlaces no terrestres. */
  readonly links: readonly TerritoryPair[];
  /** Subconjunto de aristas que son frontera terrestre real. */
  readonly landBorders: readonly TerritoryPair[];
  /**
   * Aristas que existen en la geometria pero fueron excluidas del grafo por
   * `ignoreLandBorders`.
   */
  readonly ignoredLandBorders: readonly TerritoryPair[];
}

/** Resultado del informe de balance. */
export interface ContinentBalance {
  readonly continent: ContinentId;
  readonly names: LocalizedNames;
  readonly territories: number;
  readonly internalBorders: number;
  readonly externalBorders: number;
  readonly averageDegree: number;
  /** Territorios externos con los que limita el continente. */
  readonly externalNeighbours: readonly TerritoryId[];
}

/** Tipo de enlace entre dos territorios. */
export type FrontKind = 'land' | 'sea';

/**
 * Ancla de frente: donde se ubica el campo de batalla entre dos territorios.
 *
 * No se pelea en los centroides sino en el borde: `point` cae sobre la frontera
 * compartida (o sobre el corredor maritimo) y `normal` apunta de `a` hacia `b`,
 * que es lo que la camara necesita para encuadrar la escena mirando al defensor.
 */
export interface FrontAnchor {
  readonly a: TerritoryId;
  readonly b: TerritoryId;
  readonly kind: FrontKind;
  /** Punto medio del tramo mas largo de frontera compartida, `[lon, lat]`. */
  readonly point: readonly [number, number];
  /** Direccion unitaria de `a` hacia `b`, en el plano lon/lat. */
  readonly normal: readonly [number, number];
  /** Longitud del tramo de frontera (o de la travesia), en km. */
  readonly lengthKm: number;
  /** Extremo costero del lado `a`; `null` en fronteras terrestres. */
  readonly coastA: readonly [number, number] | null;
  /** Extremo costero del lado `b`; `null` en fronteras terrestres. */
  readonly coastB: readonly [number, number] | null;
}

/** `fronts.json` */
export interface FrontsFile {
  readonly version: number;
  readonly generatedAt: string;
  readonly generator: string;
  readonly fronts: readonly FrontAnchor[];
}
