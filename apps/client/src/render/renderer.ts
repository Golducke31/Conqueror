/**
 * Renderer Three.js con dibujo BAJO DEMANDA.
 *
 * Decision (plan, seccion 8): el bucle no dibuja de forma continua. Solo se
 * dibuja cuando alguien llama a `requestRender()` o hay una animacion activa.
 * Esto cuida la bateria en movil y es la base sobre la que el Hito 2 monta el
 * tablero.
 */

import * as THREE from 'three';

export interface RenderStats {
  readonly fps: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly frames: number;
}

export interface RendererHandle {
  /** Marca la escena como sucia: se dibuja en el proximo frame. */
  requestRender(): void;
  /** Activa o desactiva el dibujo continuo (animaciones, transiciones). */
  setContinuous(continuous: boolean): void;
  /**
   * Registra un callback que corre en cada frame, se dibuje o no.
   * La logica barata (animaciones de shader, camara) va aca; el dibujo sigue
   * siendo bajo demanda.
   */
  onFrame(callback: (deltaSeconds: number) => void): void;
  stats(): RenderStats;
  dispose(): void;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
}

const COLOR_OCEANO = 0x0b1022;

function readCssColor(name: string, fallback: number): number {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) return fallback;
  const parsed = new THREE.Color(value);
  return parsed.getHex();
}

/** Crea el renderer y arranca el bucle de dibujo bajo demanda. */
export function createRenderer(canvas: HTMLCanvasElement): RendererHandle {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(readCssColor('--oceano', COLOR_OCEANO), 1);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 4000);
  camera.position.set(0, 120, 160);
  camera.lookAt(0, 0, 0);

  let dirty = true;
  let continuous = false;
  let disposed = false;
  let frames = 0;
  let fps = 0;
  let lastFpsSample = performance.now();
  let framesSinceSample = 0;
  let rafId = 0;
  let lastFrameTime = performance.now();
  const frameListeners = new Set<(deltaSeconds: number) => void>();

  const onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    dirty = true;
  };

  const loop = (): void => {
    if (disposed) return;
    rafId = requestAnimationFrame(loop);

    const now = performance.now();
    const delta = Math.min(0.1, (now - lastFrameTime) / 1000);
    lastFrameTime = now;
    for (const listener of frameListeners) listener(delta);

    if (!dirty && !continuous) return;

    dirty = false;
    renderer.render(scene, camera);
    frames += 1;
    framesSinceSample += 1;

    const elapsed = now - lastFpsSample;
    if (elapsed >= 500) {
      fps = Math.round((framesSinceSample * 1000) / elapsed);
      framesSinceSample = 0;
      lastFpsSample = now;
    }
  };

  window.addEventListener('resize', onResize);
  rafId = requestAnimationFrame(loop);

  return {
    requestRender(): void {
      dirty = true;
    },
    setContinuous(value: boolean): void {
      continuous = value;
      if (value) dirty = true;
    },
    onFrame(callback: (deltaSeconds: number) => void): void {
      frameListeners.add(callback);
    },
    stats(): RenderStats {
      return {
        fps,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        frames,
      };
    },
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      frameListeners.clear();
      renderer.dispose();
    },
    scene,
    camera,
    renderer,
  };
}
