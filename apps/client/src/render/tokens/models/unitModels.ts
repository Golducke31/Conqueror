/**
 * Modelos de unidad: carga diferida y suscripcion.
 *
 * La partida pide los modelos UNA sola vez y sigue con las primitivas mientras
 * llegan; quien los use se suscribe y cambia sus geometrias cuando estan
 * listos (ADR 0012). El cargador de glTF entra con `import()` dinamico, asi que
 * el paquete inicial no paga ni three ni el decodificador.
 */

import type { WebGLRenderer } from 'three';

import {
  loadUnitModels,
  type ModelReport,
  type UnitModelFetcher,
  type UnitModelSet,
} from './modelLoader.js';

/** Todo lo que se sabe de los modelos: lo cargado y como salio cada tipo. */
export interface UnitModelsState {
  readonly models: UnitModelSet;
  readonly reports: readonly ModelReport[];
  readonly manifestErrors: readonly string[];
}

export interface UnitModelsOptions {
  /** Ruta del manifiesto. Por defecto `/models/combat/manifest.json`. */
  readonly manifestUrl?: string;
  /** Renderer, para que KTX2 detecte el soporte de texturas comprimidas. */
  readonly renderer?: WebGLRenderer;
  /** Ruta del transcoder KTX2 servido. Si falta, se usa el de three. */
  readonly transcoderPath?: string;
  /** fetch inyectable (pruebas). */
  readonly fetchImpl?: (url: string) => Promise<Response>;
  /** Cargador inyectable (pruebas). Si falta, se usa el de glTF. */
  readonly loadModel?: UnitModelFetcher;
  /** Avisos por consola. */
  readonly debug?: boolean;
}

export interface UnitModels {
  /** Dispara la carga una sola vez. Idempotente. */
  load(): Promise<UnitModelsState>;
  /** Lo que se sabe ahora mismo (vacio hasta que termine la carga). */
  state(): UnitModelsState;
  /** Avisa cuando termina la carga. Devuelve la baja de la suscripcion. */
  subscribe(listener: (state: UnitModelsState) => void): () => void;
  /** Libera las geometrias cargadas. La escena no las usa mas despues. */
  dispose(): void;
}

/** Estado inicial: sin modelos, todas las primitivas. */
const VACIO: UnitModelsState = { models: {}, reports: [], manifestErrors: [] };

export function createUnitModels(options: UnitModelsOptions = {}): UnitModels {
  let promesa: Promise<UnitModelsState> | null = null;
  let estado: UnitModelsState = VACIO;
  const oyentes = new Set<(state: UnitModelsState) => void>();

  const load = (): Promise<UnitModelsState> => {
    if (promesa !== null) return promesa;

    promesa = (async (): Promise<UnitModelsState> => {
      // El cargador de glTF entra con `import()` dinamico: three y el
      // decodificador no tienen por que estar en el paquete inicial.
      const loadModel =
        options.loadModel ??
        (await (async () => {
          const { createGltfModelFetcher } = await import('./gltfModels.js');
          return createGltfModelFetcher({
            ...(options.renderer === undefined ? {} : { renderer: options.renderer }),
            ...(options.transcoderPath === undefined
              ? {}
              : { transcoderPath: options.transcoderPath }),
          });
        })());

      const resultado = await loadUnitModels({
        loadModel,
        ...(options.manifestUrl === undefined ? {} : { manifestUrl: options.manifestUrl }),
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        ...(options.debug === undefined ? {} : { debug: options.debug }),
      });

      estado = resultado;
      for (const oyente of oyentes) oyente(estado);
      return estado;
    })();

    // La carga nunca tiene que tirar abajo la partida: si algo sale mal, se
    // sigue con las primitivas y queda el aviso por consola.
    promesa = promesa.catch((error: unknown) => {
      if (options.debug === true) console.debug('models: no se pudieron cargar: primitivas', error);
      return estado;
    });

    return promesa;
  };

  return {
    load,
    state: () => estado,
    subscribe(listener: (state: UnitModelsState) => void): () => void {
      oyentes.add(listener);
      return () => {
        oyentes.delete(listener);
      };
    },
    dispose(): void {
      for (const skin of Object.values(estado.models)) skin.geometry.dispose();
      estado = VACIO;
      oyentes.clear();
    },
  };
}
