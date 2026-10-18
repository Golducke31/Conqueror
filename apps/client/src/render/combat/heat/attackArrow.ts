/**
 * Flecha de avance (mapa vivo, fuera de combate).
 *
 * Cuando el jugador tiene un territorio propio seleccionado y apunta (o elige)
 * un vecino enemigo, aparece una flecha animada sobre la frontera que indica el
 * ataque inminente (plan de combate, seccion 10). Es pura presentacion: el
 * ataque real lo dispara el jugador, la flecha no decide nada.
 *
 * La flecha es un arco entre las anclas de los dos territorios: un cilindro
 * como astil, un cono como punta y una esfera pulso que viaja del origen al
 * destino. Con `prefers-reduced-motion` se muestra quieta, sin pulso.
 *
 * ESCALA: la camara del mapa estrategico esta mucho mas lejos que la del
 * sandbox de combate, asi que la flecha acepta una escala. Se aplica al GROSOR
 * y a la altura del arco, nunca a la posicion: los vertices ya estan en
 * coordenadas de mundo, y escalar el grupo desplazaria la flecha fuera del
 * tablero (multiplicaria tambien las posiciones).
 */

import gsap from 'gsap';
import type { Color } from 'three';
import {
  AdditiveBlending,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';

import type { RendererHandle } from '../../renderer.js';

/** Altura del arco sobre los anclas de los territorios. */
const ARC_LIFT = 26;

/** Altura del astil sobre el relieve. */
const ARROW_BASE_LIFT = 3;

/** Radio del astil. */
const SHAFT_RADIUS = 2.2;

/** Tamano de la punta. */
const HEAD_RADIUS = 3.4;
const HEAD_HEIGHT = 9;

/** Radio del pulso viajero. */
const PULSE_RADIUS = 1.8;

export interface AttackArrowOptions {
  readonly renderer: RendererHandle;
  /** Con movimiento reducido la flecha se muestra quieta. */
  readonly reducedMotion: boolean;
}

export interface ArrowTarget {
  /** Ancla del territorio de origen, en coordenadas de mundo. */
  readonly fromX: number;
  readonly fromZ: number;
  /** Ancla del territorio destino. */
  readonly toX: number;
  readonly toZ: number;
  /** Altura de la superficie (relieve del tablero). */
  readonly baseY: number;
  /** Color del atacante. */
  readonly color: Color;
  /**
   * Escala de la flecha. En el mapa estrategico la camara esta lejos y una
   * flecha de tamaño fijo quedaria de un pixel: la escena la agranda con la
   * distancia para que se lea igual que en el sandbox.
   */
  readonly scale?: number;
}

export interface AttackArrow {
  readonly group: Group;
  /** Muestra la flecha apuntando de un territorio a otro. */
  show(target: ArrowTarget): void;
  /** Cambia la escala en caliente (la camara se alejo o acerco). */
  setScale(value: number): void;
  /** Esconde la flecha (con fundido, salvo movimiento reducido). */
  hide(): void;
  /** True si hay una flecha visible. */
  isVisible(): boolean;
  dispose(): void;
}

/** Punto del arco en `t` (0..1): bezier cuadratica con el control en el alto. */
function arcPoint(target: ArrowTarget, t: number, scale: number): Vector3 {
  const { fromX, fromZ, toX, toZ, baseY } = target;
  const controlY = baseY + ARC_LIFT * 1.6 * scale;
  const endY = baseY + ARROW_BASE_LIFT * scale;
  const u = 1 - t;
  return new Vector3(
    u * u * fromX + 2 * u * t * ((fromX + toX) / 2) + t * t * toX,
    u * u * endY + 2 * u * t * controlY + t * t * endY,
    u * u * fromZ + 2 * u * t * ((fromZ + toZ) / 2) + t * t * toZ,
  );
}

export function createAttackArrow(options: AttackArrowOptions): AttackArrow {
  const group = new Group();
  group.visible = false;

  const material = new MeshBasicMaterial({
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  const shaftMesh = new Mesh(new CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, 1, 8), material);
  const headMesh = new Mesh(new ConeGeometry(HEAD_RADIUS, HEAD_HEIGHT, 10), material);
  const pulseMesh = new Mesh(new SphereGeometry(PULSE_RADIUS, 10, 8), material);
  group.add(shaftMesh, headMesh, pulseMesh);

  let visible = false;
  let pulseTimeline: gsap.core.Timeline | null = null;
  let current: ArrowTarget | null = null;
  /** Escala base vigente (sin contar el rebote de entrada). */
  let baseScale = 1;
  /** Factor del rebote de entrada, 0.4 -> 1. */
  let pop = 1;

  const stopPulse = (): void => {
    pulseTimeline?.kill();
    pulseTimeline = null;
  };

  /** Coloca astil y punta segun el arco actual, con la escala vigente. */
  const placeArrow = (target: ArrowTarget): void => {
    const scale = Math.max(0.2, baseScale * pop);
    const start = arcPoint(target, 0.12, scale);
    const end = arcPoint(target, 0.94, scale);
    const dir = end.clone().sub(start);
    const length = dir.length();
    if (length < 1e-3) return;
    dir.normalize();

    const up = new Vector3(0, 1, 0);
    const quaternion = new Quaternion().setFromUnitVectors(up, dir);

    shaftMesh.position.copy(start).addScaledVector(dir, length / 2);
    shaftMesh.quaternion.copy(quaternion);
    // El cilindro mide 1 de alto: se estira al largo del arco y se engrosa con
    // la escala (nunca se escala la posicion).
    shaftMesh.scale.set(scale, length, scale);

    headMesh.position.copy(end);
    headMesh.quaternion.copy(quaternion);
    headMesh.scale.setScalar(scale);

    pulseMesh.position.copy(start);
    pulseMesh.scale.setScalar(scale);
  };

  const startPulse = (): void => {
    stopPulse();
    if (options.reducedMotion) {
      pulseMesh.visible = false;
      return;
    }
    pulseMesh.visible = true;
    const state = { t: 0 };
    pulseTimeline = gsap.timeline({ repeat: -1 });
    pulseTimeline.to(state, {
      t: 1,
      duration: 0.85,
      ease: 'none',
      onUpdate: () => {
        if (current === null) return;
        pulseMesh.position.copy(arcPoint(current, state.t, baseScale));
        // El pulso se enciende al salir y se apaga al llegar.
        const fade = Math.sin(Math.PI * state.t);
        pulseMesh.scale.setScalar((0.6 + 0.4 * fade) * baseScale);
        options.renderer.requestRender();
      },
    });
  };

  return {
    group,

    show(target: ArrowTarget): void {
      current = target;
      visible = true;
      group.visible = true;
      material.color.copy(target.color);
      material.opacity = 0.9;
      baseScale = Math.max(0.2, target.scale ?? 1);
      pop = 1;
      placeArrow(target);
      startPulse();

      if (options.reducedMotion) {
        options.renderer.requestRender();
        return;
      }
      // Entrada con un pequeño rebote de grosor (no de posicion).
      const anim = { v: 0.4 };
      gsap.to(anim, {
        v: 1,
        duration: 0.28,
        ease: 'back.out(2.4)',
        onUpdate: () => {
          pop = anim.v;
          if (current !== null) placeArrow(current);
          options.renderer.requestRender();
        },
        onComplete: () => {
          pop = 1;
          if (current !== null) placeArrow(current);
        },
      });
    },

    setScale(value: number): void {
      const next = Math.max(0.2, value);
      if (Math.abs(next - baseScale) < 0.02) return;
      baseScale = next;
      if (!visible || current === null) return;
      placeArrow(current);
      options.renderer.requestRender();
    },

    hide(): void {
      if (!visible) return;
      visible = false;
      current = null;
      stopPulse();
      const finish = (): void => {
        group.visible = false;
        options.renderer.requestRender();
      };
      if (options.reducedMotion) {
        finish();
        return;
      }
      const fade = { v: material.opacity };
      gsap.to(fade, {
        v: 0,
        duration: 0.16,
        ease: 'power2.in',
        onUpdate: () => {
          material.opacity = fade.v;
          options.renderer.requestRender();
        },
        onComplete: () => {
          material.opacity = 0.9;
          finish();
        },
      });
    },

    isVisible(): boolean {
      return visible;
    },

    dispose(): void {
      stopPulse();
      shaftMesh.geometry.dispose();
      headMesh.geometry.dispose();
      pulseMesh.geometry.dispose();
      material.dispose();
    },
  };
}
