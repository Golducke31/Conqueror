/**
 * Estandarte de conquista.
 *
 * Malla unica (poste + bandera + emblema) que se planta en el ancla del
 * territorio conquistado. La bandera ondea en el vertex shader a partir de
 * `uTime`: la amplitud crece con la distancia al mastil (se calcula sobre la
 * posicion local en X, no sobre uv, para que el emblema —que es geometria
 * fusionada a la bandera— tambien participe del ondeo).
 *
 * Reglas del proyecto:
 *   - El color del jugador se aplica SOLO a la bandera (mascara por vertice);
 *     el poste y el emblema quedan en tonos neutros.
 *   - El emblema es geometrico y generico (una estrella), nunca una bandera o
 *     un simbolo de un pais o ideologia real.
 *
 * El "pop" al plantar (escala) lo anima la escena de batalla con GSAP: aca
 * solo se expone el grupo.
 */

import type { BufferGeometry } from 'three';
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Alto del poste, en unidades de mundo. */
const POLE_HEIGHT = 17;
/** Ancho y alto de la bandera. */
const FLAG_WIDTH = 11;
const FLAG_HEIGHT = 6.5;
/** Radio del emblema. */
const EMBLEM_RADIUS = 1.9;

const CREMA = new Color('#efe4cc');
const METAL = new Color('#8d9199');
const BLANCO = new Color('#ffffff');

/** Estrella de cinco puntas, generica. */
function starPath(radius: number, points = 5): Shape {
  const shape = new Shape();
  const inner = radius * 0.42;
  for (let index = 0; index < points * 2; index += 1) {
    const r = index % 2 === 0 ? radius : inner;
    const angle = (index / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

interface BannerPart {
  readonly geometry: BufferGeometry;
  readonly color: Color;
  /** 1 = se tine con el color del jugador. */
  readonly mask: number;
}

function part(geometry: BufferGeometry, color: Color, mask: number): BannerPart {
  return { geometry, color, mask };
}

/** Fusiona las piezas y les hornea color y mascara por vertice. */
function mergeBannerParts(parts: readonly BannerPart[]): BufferGeometry {
  const prepared = parts.map((entry) => {
    const count = entry.geometry.getAttribute('position').count;
    const color = new Float32Array(count * 3);
    const mask = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      color[index * 3] = entry.color.r;
      color[index * 3 + 1] = entry.color.g;
      color[index * 3 + 2] = entry.color.b;
      mask[index] = entry.mask;
    }
    entry.geometry.setAttribute('aColor', new Float32BufferAttribute(color, 3));
    entry.geometry.setAttribute('aMask', new Float32BufferAttribute(mask, 1));
    return entry.geometry;
  });
  const merged = mergeGeometries(prepared, false);
  if (merged === null) throw new Error('No se pudo fusionar la bandera del estandarte');
  for (const geometry of prepared) geometry.dispose();
  return merged;
}

const BANNER_VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute float aMask;
  uniform float uTime;
  varying vec3 vColor;
  varying float vMask;
  varying float vWaveX;
  void main() {
    vColor = aColor;
    vMask = aMask;
    vWaveX = position.x;
    vec3 transformed = position;
    // Ondeo: la amplitud crece con el cuadrado de la distancia al mastil.
    float wave = sin(uTime * 2.4 - position.x * 0.5) * position.x * position.x * 0.018;
    wave += sin(uTime * 3.9 - position.x * 0.9) * position.x * position.x * 0.008;
    transformed.z += wave;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
  }
`;

const BANNER_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying vec3 vColor;
  varying float vMask;
  varying float vWaveX;
  void main() {
    // Brillito de tela: da volumen sin recalcular normales.
    float shimmer = 0.86 + 0.14 * cos(2.4 - vWaveX * 0.5);
    vec3 tinted = mix(vColor, vColor * uColor, vMask);
    gl_FragColor = vec4(tinted * shimmer, 1.0);
  }
`;

export interface BannerLayerOptions {
  /** Altura del suelo del tablero, donde se apoya el poste. */
  readonly baseY: number;
}

export interface BannerLayer {
  readonly group: Group;
  /** Planta el estandarte en una posicion del mundo. */
  plant(options: {
    readonly x: number;
    readonly z: number;
    readonly color: Color;
    /** Giro del grupo, para orientar la bandera hacia la camara. */
    readonly rotationY?: number;
  }): void;
  /** Esconde el estandarte de inmediato. */
  remove(): void;
  setTime(seconds: number): void;
  dispose(): void;
}

/** Construye la bandera con el emblema fusionado (todo participa del ondeo). */
function buildFlagGeometry(): BufferGeometry {
  // El plano se desplaza para que su borde izquierdo (x = 0) quede en el
  // mastil: ahi la amplitud del ondeo es cero.
  const plane = new PlaneGeometry(FLAG_WIDTH, FLAG_HEIGHT);
  plane.translate(FLAG_WIDTH / 2, 0, 0);

  const star = new ShapeGeometry(starPath(EMBLEM_RADIUS));
  // El emblema va en la bandera, cerca del mastil.
  star.translate(FLAG_WIDTH * 0.3, 0, 0.12);

  return mergeBannerParts([part(plane, BLANCO, 1), part(star, CREMA, 0)]);
}

export function createBannerLayer(options: BannerLayerOptions): BannerLayer {
  const group = new Group();
  group.visible = false;

  const pole = new Mesh(
    new CylinderGeometry(0.35, 0.5, POLE_HEIGHT, 8),
    new MeshBasicMaterial({ color: METAL }),
  );
  pole.position.y = POLE_HEIGHT / 2;

  const finial = new Mesh(new ConeGeometry(0.7, 1.7, 8), new MeshBasicMaterial({ color: METAL }));
  finial.position.y = POLE_HEIGHT + 0.85;

  const flagGeometry = buildFlagGeometry();
  const flagMaterial = new ShaderMaterial({
    side: DoubleSide,
    vertexColors: false,
    vertexShader: BANNER_VERTEX,
    fragmentShader: BANNER_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new Vector3(1, 1, 1) },
    },
  });
  const flag = new Mesh(flagGeometry, flagMaterial);
  flag.position.y = POLE_HEIGHT - FLAG_HEIGHT / 2 - 0.8;

  group.add(pole, finial, flag);
  group.position.y = options.baseY;

  return {
    group,

    plant(plantOptions): void {
      group.position.x = plantOptions.x;
      group.position.z = plantOptions.z;
      group.position.y = options.baseY;
      group.rotation.y = plantOptions.rotationY ?? 0;
      flagMaterial.uniforms['uColor']!.value.set(
        plantOptions.color.r,
        plantOptions.color.g,
        plantOptions.color.b,
      );
      group.visible = true;
    },

    remove(): void {
      group.visible = false;
    },

    setTime(seconds: number): void {
      flagMaterial.uniforms['uTime']!.value = seconds;
    },

    dispose(): void {
      pole.geometry.dispose();
      (pole.material as MeshBasicMaterial).dispose();
      finial.geometry.dispose();
      (finial.material as MeshBasicMaterial).dispose();
      flagGeometry.dispose();
      flagMaterial.dispose();
    },
  };
}
