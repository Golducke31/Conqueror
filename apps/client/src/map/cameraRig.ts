/**
 * Camara del tablero.
 *
 * `MapControls` de three: arrastre con el boton izquierdo para desplazar, rueda
 * y pinch para acercar, y soporte tactil de fabrica. Se le agregan:
 *
 *   - limites de desplazamiento sobre el tablero
 *   - limites de inclinacion (entre 30 y 78 grados) para no perder la lectura
 *   - inercia suave
 *   - `focusOn`, que encuadra un punto (un territorio o el frente de batalla)
 */

import gsap from 'gsap';
import type { PerspectiveCamera } from 'three';
import { Spherical, Vector3 } from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';

export interface FocusOptions {
  /** Distancia final de la camara al punto. */
  readonly distance?: number;
  /** Inclinacion final en grados respecto del cenit (0 = picado total). */
  readonly polarDeg?: number;
  /** Duracion de la transicion en segundos. */
  readonly duration?: number;
  /** Si es `true`, no anima: salta al encuadre final. */
  readonly instant?: boolean;
}

export interface CameraRigOptions {
  readonly camera: PerspectiveCamera;
  readonly domElement: HTMLElement;
  /** Semiancho del tablero, para limitar el desplazamiento. */
  readonly boardWidth: number;
  /** Semialto del tablero. */
  readonly boardHeight: number;
  readonly minDistance: number;
  readonly maxDistance: number;
}

export interface CameraRig {
  readonly controls: MapControls;
  readonly camera: PerspectiveCamera;
  update(deltaSeconds?: number): void;
  focusOn(x: number, z: number, options?: FocusOptions): gsap.core.Timeline;
  distanceTo(x: number, z: number): number;
  /** Sacudon corto de camara, para el impacto de una baja. */
  shake(intensity: number, duration: number): void;
  setEnabled(value: boolean): void;
  dispose(): void;
}

const POLAR_MIN = (Math.PI * 18) / 180;
const POLAR_MAX = (Math.PI * 72) / 180;

export interface BoardFitOptions {
  readonly boardWidth: number;
  readonly boardHeight: number;
  readonly fovDeg: number;
  /** Relacion de aspecto del lienzo (ancho / alto). */
  readonly aspect: number;
  /** Inclinacion respecto del cenit, en grados. */
  readonly polarDeg?: number;
  /** Aire alrededor del tablero (1 = justo al borde). */
  readonly margin?: number;
}

/**
 * Distancia de camara con la que entra el tablero completo.
 *
 * Hace falta calcularla en vez de usar una constante: en un telefono en
 * vertical el ancho visible es una fraccion del de un monitor, y una distancia
 * fija deja medio mapa fuera de cuadro. El tablero esta en el plano XZ, asi que
 * con la camara inclinada su profundidad se comprime en pantalla por
 * `cos(polar)`.
 */
export function boardFitDistance(options: BoardFitOptions): number {
  const polar = ((options.polarDeg ?? 42) * Math.PI) / 180;
  const margin = options.margin ?? 1.12;
  const tanHalf = Math.tan((options.fovDeg * Math.PI) / 360);
  const aspect = Math.max(0.2, options.aspect);
  const porAncho = (options.boardWidth * margin) / (2 * tanHalf * aspect);
  const porAlto = (options.boardHeight * margin * Math.cos(polar)) / (2 * tanHalf);
  return Math.max(porAncho, porAlto);
}

export function createCameraRig(options: CameraRigOptions): CameraRig {
  const controls = new MapControls(options.camera, options.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.screenSpacePanning = false;
  controls.zoomSpeed = 0.9;
  controls.rotateSpeed = 0.45;
  controls.minDistance = options.minDistance;
  controls.maxDistance = options.maxDistance;
  controls.minPolarAngle = POLAR_MIN;
  controls.maxPolarAngle = POLAR_MAX;
  controls.enableRotate = true;
  controls.zoomToCursor = false;

  controls.target.set(0, 0, 0);

  const limitX = options.boardWidth * 0.62;
  const limitZ = options.boardHeight * 0.62;

  const spherical = new Spherical();
  const offset = new Vector3();

  // Sacudon: se guarda el desplazamiento aplicado para poder sacarlo antes de
  // que los controles recalculen la pose. Si no, se acumularia frame a frame.
  const shakeOffset = new Vector3();
  let shakeIntensity = 0;
  let shakeRemaining = 0;
  let shakeDuration = 0;
  let shakeTime = 0;

  const clampTarget = (): void => {
    controls.target.x = Math.max(-limitX, Math.min(limitX, controls.target.x));
    controls.target.z = Math.max(-limitZ, Math.min(limitZ, controls.target.z));
  };

  const applyPose = (
    x: number,
    z: number,
    distance: number,
    polar: number,
    azimuth: number,
  ): void => {
    spherical.set(distance, polar, azimuth);
    offset.setFromSpherical(spherical);
    controls.target.set(x, 0, z);
    options.camera.position.copy(controls.target).add(offset);
    options.camera.lookAt(controls.target);
    // El encuadre manda: cualquier sacudon pendiente se descarta.
    shakeOffset.set(0, 0, 0);
    controls.update();
  };

  const currentPose = (): { polar: number; azimuth: number } => {
    const relative = new Vector3().subVectors(options.camera.position, controls.target);
    const current = new Spherical().setFromVector3(relative);
    return { polar: current.phi, azimuth: current.theta };
  };

  return {
    controls,
    camera: options.camera,

    update(deltaSeconds = 0.016): void {
      if (shakeOffset.lengthSq() > 0) {
        options.camera.position.sub(shakeOffset);
        shakeOffset.set(0, 0, 0);
      }

      controls.update();
      clampTarget();

      if (shakeRemaining > 0) {
        shakeTime += deltaSeconds;
        shakeRemaining = Math.max(0, shakeRemaining - deltaSeconds);
        const decay = shakeDuration > 0 ? shakeRemaining / shakeDuration : 0;
        const amount = shakeIntensity * decay * decay;
        // Osciladores deterministas: el sacudon no puede meter azar en el estado.
        shakeOffset.set(
          Math.sin(shakeTime * 47) * amount,
          Math.cos(shakeTime * 61) * amount * 0.6,
          Math.sin(shakeTime * 53 + 1.3) * amount,
        );
        options.camera.position.add(shakeOffset);
      }
    },

    shake(intensity: number, duration: number): void {
      shakeIntensity = intensity;
      shakeDuration = Math.max(0.01, duration);
      shakeRemaining = shakeDuration;
      shakeTime = 0;
    },

    distanceTo(x: number, z: number): number {
      return options.camera.position.distanceTo(new Vector3(x, 0, z));
    },

    focusOn(x: number, z: number, focusOptions: FocusOptions = {}): gsap.core.Timeline {
      const targetDistance = focusOptions.distance ?? 260;
      const targetPolar = ((focusOptions.polarDeg ?? 52) * Math.PI) / 180;
      const duration = focusOptions.duration ?? 0.85;
      const pose = currentPose();

      if (focusOptions.instant === true) {
        applyPose(x, z, targetDistance, targetPolar, pose.azimuth);
        return gsap.timeline();
      }

      const state = {
        x: controls.target.x,
        z: controls.target.z,
        distance: options.camera.position.distanceTo(controls.target),
        polar: pose.polar,
      };

      return gsap.timeline().to(state, {
        x,
        z,
        distance: targetDistance,
        polar: targetPolar,
        duration,
        ease: 'power2.inOut',
        onUpdate: () => applyPose(state.x, state.z, state.distance, state.polar, pose.azimuth),
      });
    },

    setEnabled(value: boolean): void {
      controls.enabled = value;
    },

    dispose(): void {
      controls.dispose();
    },
  };
}
