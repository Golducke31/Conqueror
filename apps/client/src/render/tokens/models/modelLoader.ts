/**
 * Carga diferida de los modelos finales.
 *
 * Misma idea que el audio (ADR 0011) y que la seccion 12 del plan: los modelos
 * se piden AL ABRIR la partida, nunca antes, y si algo falta el juego sigue
 * con las primitivas. Esta funcion NUNCA lanza: devuelve un reporte por tipo
 * para que la pagina `/debug/models` cuente que paso (ADR 0012).
 *
 * El cargador de archivos entra inyectado (`loadModel`), asi que aca no hay
 * three.js de por medio mas que los tipos: se puede probar sin red y sin DOM.
 */

import type { BufferGeometry, Texture } from 'three';

import {
  TRIANGLE_BUDGET,
  UNIT_MODEL_TYPES,
  validateModelManifest,
  type MaskChannel,
  type ModelSlot,
  type UnitModelType,
} from './manifest.js';
import { normalizeUnitGeometry, triangleCount, withinBudget } from './unitGeometry.js';

/**
 * Ruta del manifiesto por defecto. Va ABSOLUTA desde la raiz a proposito: una
 * ruta relativa se resolveria contra la pagina y en `/debug/models` (sin barra
 * final) `document.baseURI` es `/debug/models`, asi que `models/...` terminaria
 * pidiendo `/debug/models/...`. Las rutas DENTRO del manifiesto si son
 * relativas a el.
 */
export const MODEL_MANIFEST_URL = '/models/combat/manifest.json';

/** Modelo crudo tal como lo devuelve un cargador de glTF. */
export interface RawUnitModel {
  readonly geometry: BufferGeometry;
  /** Atlas de texturas del modelo, si trae uno. */
  readonly map: Texture | null;
}

/**
 * Cargador de un archivo de modelo. Devuelve `null` si el archivo no existe
 * (404); lanza si existe pero no se puede interpretar.
 */
export type UnitModelFetcher = (url: string, slot: ModelSlot) => Promise<RawUnitModel | null>;

/** Estado de un tipo despues de intentar cargar su modelo. */
export type ModelStatus = 'loaded' | 'absent' | 'missing' | 'invalid' | 'error';

/** Resultado del intento de carga de un tipo. */
export interface ModelReport {
  readonly type: UnitModelType;
  readonly status: ModelStatus;
  /** Ruta declarada en el manifiesto, o la esperada por convencion. */
  readonly file: string;
  readonly triangles: number;
  readonly budget: number;
  readonly withinBudget: boolean;
  /** Explicacion del estado, para el panel de depuracion. */
  readonly reason: string | null;
}

/** Todo lo que hace falta para dibujar un tipo con su modelo final. */
export interface UnitSkin {
  readonly geometry: BufferGeometry;
  /** Atlas de texturas del modelo, si trae uno. */
  readonly map: Texture | null;
  /** Canal del atlas que lleva la mascara, si esta pintada ahi. */
  readonly maskChannel: MaskChannel;
}

/** Modelos utilizables: los tipos que no aparezcan siguen con su primitiva. */
export type UnitModelSet = Readonly<Partial<Record<UnitModelType, UnitSkin>>>;

export interface UnitModelsResult {
  readonly models: UnitModelSet;
  readonly reports: readonly ModelReport[];
  /** Problemas del manifiesto: si hay alguno, no se cargo ningun modelo. */
  readonly manifestErrors: readonly string[];
}

export interface LoadUnitModelsOptions {
  /** Ruta del manifiesto. Por defecto `/models/combat/manifest.json`. */
  readonly manifestUrl?: string;
  /** fetch inyectable (pruebas). */
  readonly fetchImpl?: (url: string) => Promise<Response>;
  /** Cargador de archivos. En produccion es el de glTF; en pruebas, un falso. */
  readonly loadModel: UnitModelFetcher;
  /** Avisos por consola. */
  readonly debug?: boolean;
}

/** Resuelve las rutas del manifiesto contra su propia ubicacion. */
function crearResolver(manifestUrl: string): (file: string) => string {
  const base =
    typeof document !== 'undefined' && document.baseURI !== ''
      ? document.baseURI
      : 'http://localhost/';
  const manifiesto = new URL(manifestUrl, base);
  return (file: string) => new URL(file, manifiesto).toString();
}

/** Reporte de un tipo que no tiene modelo propio. */
function reporteSinModelo(type: UnitModelType, status: ModelStatus, reason: string): ModelReport {
  return {
    type,
    status,
    file: `${type}.glb`,
    triangles: 0,
    budget: TRIANGLE_BUDGET[type],
    withinBudget: true,
    reason,
  };
}

export async function loadUnitModels(options: LoadUnitModelsOptions): Promise<UnitModelsResult> {
  const manifestUrl = options.manifestUrl ?? MODEL_MANIFEST_URL;
  const fetchImpl = options.fetchImpl ?? ((url: string) => fetch(url));
  const loadModel = options.loadModel;
  const debug = options.debug === true;

  const resolver = crearResolver(manifestUrl);
  const models: Partial<Record<UnitModelType, UnitSkin>> = {};

  // --- Manifiesto ------------------------------------------------------------

  let datos: unknown;
  try {
    const respuesta = await fetchImpl(manifestUrl);
    if (!respuesta.ok) {
      if (debug) console.debug(`models: no hay manifiesto en ${manifestUrl}: primitivas`);
      return {
        models,
        reports: UNIT_MODEL_TYPES.map((type) =>
          reporteSinModelo(type, 'absent', 'no hay manifiesto de modelos'),
        ),
        manifestErrors: [],
      };
    }
    datos = await respuesta.json();
  } catch (error) {
    if (debug) console.debug('models: no se pudo leer el manifiesto: primitivas', error);
    return {
      models,
      reports: UNIT_MODEL_TYPES.map((type) =>
        reporteSinModelo(type, 'absent', 'no se pudo leer el manifiesto'),
      ),
      manifestErrors: [],
    };
  }

  const validado = validateModelManifest(datos);
  if (!validado.ok) {
    if (debug) console.debug('models: manifiesto invalido: primitivas', validado.error);
    return {
      models,
      reports: UNIT_MODEL_TYPES.map((type) =>
        reporteSinModelo(type, 'invalid', 'el manifiesto tiene problemas'),
      ),
      manifestErrors: validado.error,
    };
  }

  const manifest = validado.value;

  // --- Un modelo por tipo ----------------------------------------------------

  const reports: ModelReport[] = [];

  for (const type of UNIT_MODEL_TYPES) {
    const slot = manifest[type];
    if (slot === undefined) {
      reports.push(reporteSinModelo(type, 'absent', 'el manifiesto no declara este tipo'));
      continue;
    }

    const url = resolver(slot.file);
    let crudo: RawUnitModel | null;
    try {
      crudo = await loadModel(url, slot);
    } catch (error) {
      reports.push({
        type,
        status: 'error',
        file: slot.file,
        triangles: 0,
        budget: TRIANGLE_BUDGET[type],
        withinBudget: true,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (crudo === null) {
      reports.push({
        type,
        status: 'missing',
        file: slot.file,
        triangles: 0,
        budget: TRIANGLE_BUDGET[type],
        withinBudget: true,
        reason: `no se encontro ${slot.file}`,
      });
      continue;
    }

    const normalizado = normalizeUnitGeometry(crudo.geometry, slot);
    if (!normalizado.ok) {
      reports.push({
        type,
        status: 'invalid',
        file: slot.file,
        triangles: 0,
        budget: TRIANGLE_BUDGET[type],
        withinBudget: true,
        reason: normalizado.error,
      });
      continue;
    }

    models[type] = { geometry: normalizado.value, map: crudo.map, maskChannel: slot.maskChannel };
    const triangulos = triangleCount(normalizado.value);
    reports.push({
      type,
      status: 'loaded',
      file: slot.file,
      triangles: triangulos,
      budget: TRIANGLE_BUDGET[type],
      withinBudget: withinBudget(type, triangulos),
      reason: null,
    });
  }

  return { models, reports, manifestErrors: [] };
}
