/**
 * Cargador de modelos glTF reales.
 *
 * Este modulo es el UNICO que conoce `GLTFLoader`: se importa en diferido
 * (`await import('./gltfModels.js')`) cuando la partida abre, para que three y
 * el decodificador no entren en el paquete inicial (ADR 0012).
 *
 * Soporta glTF 2.0 y GLB, con compresion Meshopt (el decodificador viene con
 * three) y texturas KTX2 (el transcoder tambien: three lo trae y el empaquetador
 * lo deja como asset aparte, que solo se descarga si hay una textura KTX2). Si
 * el transcoder no esta, el modelo igual carga y el atlas se pierde: el color
 * plano del manifiesto lo cubre.
 */

import type { BufferGeometry, Mesh, Texture, WebGLRenderer } from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

import type { RawUnitModel, UnitModelFetcher } from './modelLoader.js';

export interface GltfModelFetcherOptions {
  /**
   * Ruta del transcoder KTX2 servido. Si falta, se usa el que trae three: sus
   * URLs son relativas al modulo y el empaquetador las reescribe, asi que no
   * hay que copiar nada a `public/`. Solo se pasa cuando se quiere servir el
   * transcoder aparte.
   */
  readonly transcoderPath?: string;
  /** Renderer, solo para que KTX2 detecte el soporte de texturas comprimidas. */
  readonly renderer?: WebGLRenderer;
}

/** Primera malla de la escena: los modelos de unidad son una sola malla. */
function primeraMalla(raiz: { traverse(callback: (object: unknown) => void): void }): Mesh | null {
  let encontrada: Mesh | null = null;
  raiz.traverse((object) => {
    if (encontrada !== null) return;
    const posible = object as Partial<Mesh>;
    if (posible.isMesh === true && posible.geometry !== undefined) {
      encontrada = object as Mesh;
    }
  });
  return encontrada;
}

/** Textura del material, si el modelo trae atlas. */
function texturaDe(mesh: Mesh): Texture | null {
  const materiales = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materiales) {
    const mapa = (material as { map?: Texture | null }).map;
    if (mapa !== undefined && mapa !== null) return mapa;
  }
  return null;
}

/**
 * Arma un cargador de modelos glTF. Devuelve `null` cuando el archivo no
 * existe, para que el llamador lo reporte como «sin archivo» en vez de error.
 */
export async function createGltfModelFetcher(
  options: GltfModelFetcherOptions = {},
): Promise<UnitModelFetcher> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  if (options.renderer !== undefined) {
    const ktx2 = new KTX2Loader();
    // Sin ruta explicita, three usa su propio transcoder (relativo al modulo).
    if (options.transcoderPath !== undefined) ktx2.setTranscoderPath(options.transcoderPath);
    ktx2.detectSupport(options.renderer);
    loader.setKTX2Loader(ktx2);
  }

  return async (url: string): Promise<RawUnitModel | null> => {
    try {
      const gltf = await loader.loadAsync(url);
      const mesh = primeraMalla(gltf.scene);
      if (mesh === null) throw new Error(`el modelo ${url} no tiene ninguna malla`);
      return { geometry: mesh.geometry as BufferGeometry, map: texturaDe(mesh) };
    } catch (error) {
      // GLTFLoader no distingue un 404 de un archivo roto: se mira el mensaje
      // para no reportar «sin archivo» cuando lo que hay es basura.
      const mensaje = error instanceof Error ? error.message : String(error);
      if (/404|not found|failed to fetch/i.test(mensaje)) return null;
      throw error;
    }
  };
}
