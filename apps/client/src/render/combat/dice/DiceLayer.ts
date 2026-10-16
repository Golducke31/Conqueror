/**
 * Dados del combate.
 *
 * El resultado ya viene decidido por el motor: aca los dados SOLO se animan
 * hasta la cara que corresponde. Se dibujan planos sobre el campo, con un atlas
 * de pips, para que se lean desde la camara inclinada.
 *
 * Un unico `InstancedMesh`: todos los dados de la ronda cuestan una draw call.
 */

import {
  CanvasTexture,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import type { Color } from 'three';

/** Capacidad: 3 dados por bando, con margen. */
const CAPACITY = 12;

const CELL = 128;

const VERTEX = /* glsl */ `
  attribute float aFace;
  attribute vec3 aColor;
  attribute float aHighlight;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vFace;
  varying float vHighlight;

  void main() {
    vUv = uv;
    vColor = aColor;
    vFace = aFace;
    vHighlight = aHighlight;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vFace;
  varying float vHighlight;

  void main() {
    vec2 uv = vec2((vFace + vUv.x) / 6.0, vUv.y);
    vec4 tex = texture2D(uAtlas, uv);
    if (tex.a < 0.3) discard;
    // El brillo del par ganado se suma al color base.
    vec3 tint = vColor + vec3(vHighlight) * 0.9;
    gl_FragColor = vec4(tint * tex.rgb, tex.a * uOpacity);
  }
`;

/** Dibuja el atlas: seis caras de dado con pips, en blanco para poder teñirlas. */
function buildAtlas(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = CELL * 6;
  canvas.height = CELL;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('No se pudo crear el canvas del atlas de dados');

  context.clearRect(0, 0, canvas.width, canvas.height);

  // Posiciones de los pips en una grilla de 3x3, por cara.
  const layouts: readonly (readonly (readonly [number, number])[])[] = [
    [[1, 1]],
    [
      [0, 0],
      [2, 2],
    ],
    [
      [0, 0],
      [1, 1],
      [2, 2],
    ],
    [
      [0, 0],
      [2, 0],
      [0, 2],
      [2, 2],
    ],
    [
      [0, 0],
      [2, 0],
      [1, 1],
      [0, 2],
      [2, 2],
    ],
    [
      [0, 0],
      [2, 0],
      [0, 1],
      [2, 1],
      [0, 2],
      [2, 2],
    ],
  ];

  const padding = CELL * 0.1;
  const inner = CELL - padding * 2;
  const step = inner / 3;
  const radius = step * 0.24;

  layouts.forEach((layout, faceIndex) => {
    const originX = faceIndex * CELL;
    // Marco de la cara.
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.roundRect(
      originX + padding * 0.4,
      padding * 0.4,
      CELL - padding * 0.8,
      CELL - padding * 0.8,
      CELL * 0.14,
    );
    context.fill();

    // Pips en negro, para que el contraste no dependa del color del jugador.
    context.fillStyle = '#11151f';
    for (const [column, row] of layout) {
      context.beginPath();
      context.arc(
        originX + padding + step * (column + 0.5),
        padding + step * (row + 0.5),
        radius,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  });

  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export interface DiePlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Cara visible, de 1 a 6. */
  readonly face: number;
  readonly color: Color;
  readonly scale: number;
  readonly rotationY: number;
  /** 0 = apagado, 1 = brilla (par ganado). */
  readonly highlight: number;
}

export class DiceLayer {
  readonly group = new Group();

  private readonly mesh: InstancedMesh;
  private readonly material: ShaderMaterial;
  private readonly texture: CanvasTexture;
  private readonly scratch = new Object3D();

  constructor() {
    this.texture = buildAtlas();

    const geometry = new PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);

    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uAtlas: { value: this.texture },
        uOpacity: { value: 1 },
      },
    });

    this.mesh = new InstancedMesh(geometry, this.material, CAPACITY);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 6;

    const face = new InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
    const color = new InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    const highlight = new InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
    for (const attribute of [face, color, highlight]) attribute.setUsage(DynamicDrawUsage);

    this.mesh.geometry.setAttribute('aFace', face);
    this.mesh.geometry.setAttribute('aColor', color);
    this.mesh.geometry.setAttribute('aHighlight', highlight);

    this.group.add(this.mesh);
  }

  update(dice: readonly DiePlacement[]): void {
    const face = this.mesh.geometry.getAttribute('aFace') as InstancedBufferAttribute;
    const color = this.mesh.geometry.getAttribute('aColor') as InstancedBufferAttribute;
    const highlight = this.mesh.geometry.getAttribute('aHighlight') as InstancedBufferAttribute;

    let cursor = 0;
    for (const die of dice) {
      if (cursor >= CAPACITY) break;
      this.scratch.position.set(die.x, die.y, die.z);
      this.scratch.rotation.set(0, die.rotationY, 0);
      this.scratch.scale.setScalar(die.scale);
      this.scratch.updateMatrix();
      this.mesh.setMatrixAt(cursor, this.scratch.matrix);

      face.setX(cursor, Math.max(0, Math.min(5, Math.round(die.face) - 1)));
      color.setXYZ(cursor, die.color.r, die.color.g, die.color.b);
      highlight.setX(cursor, Math.max(0, Math.min(1, die.highlight)));
      cursor += 1;
    }

    this.mesh.count = cursor;
    this.mesh.instanceMatrix.needsUpdate = true;
    face.needsUpdate = true;
    color.needsUpdate = true;
    highlight.needsUpdate = true;
  }

  setOpacity(value: number): void {
    this.material.uniforms['uOpacity']!.value = value;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.group.remove(this.mesh);
  }
}
