/**
 * Capa de numeros.
 *
 * Los ejércitos de cada territorio se muestran con un atlas de digitos y un
 * unico `InstancedMesh`: un caracter por instancia. Un `Text` por etiqueta
 * serian 50 draw calls; esto es una.
 *
 * Los glifos se dibujan en el canvas con relleno blanco y contorno oscuro: el
 * blanco se tinta con el color del jugador y el contorno queda legible sobre
 * cualquier territorio. No hace falta placa de fondo.
 */

import type { Color } from 'three';
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

const CHARS = '0123456789×− ';
const CHAR_COUNT = CHARS.length;
const CELL = 128;

/** Capacidad: 50 territorios por hasta 6 caracteres, mas las bajas flotantes. */
const CAPACITY = 520;

const VERTEX = /* glsl */ `
  attribute float aChar;
  attribute float aSlot;
  attribute float aCenter;
  attribute vec3 aColor;
  attribute float aAlpha;
  uniform float uCharWidth;
  uniform float uCharHeight;
  uniform float uZoom;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vChar;
  varying float vAlpha;

  void main() {
    vUv = uv;
    vColor = aColor;
    vChar = aChar;
    vAlpha = aAlpha;

    vec3 scaled = vec3(position.x * uCharWidth, 0.0, position.z * uCharHeight) * uZoom;
    vec4 placed = instanceMatrix * vec4(scaled, 1.0);
    // El desplazamiento entre caracteres se aplica aca para que escale junto con
    // el glifo: si se horneara en la matriz, al alejar la camara se superpondrian.
    placed.x += (aSlot - aCenter) * uCharWidth * uZoom;

    gl_Position = projectionMatrix * modelViewMatrix * placed;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vChar;
  varying float vAlpha;

  void main() {
    vec2 uv = vec2((vChar + vUv.x) / ${CHAR_COUNT}.0, vUv.y);
    vec4 tex = texture2D(uAtlas, uv);
    if (tex.a < 0.35) discard;
    gl_FragColor = vec4(tex.rgb * vColor, tex.a * uOpacity * vAlpha);
  }
`;

/** Dibuja el atlas de digitos en un canvas. */
function buildAtlas(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = CELL * CHAR_COUNT;
  canvas.height = CELL;

  const context = canvas.getContext('2d');
  if (context === null) throw new Error('No se pudo crear el canvas del atlas de numeros');

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = `bold ${Math.round(CELL * 0.74)}px Georgia, "Times New Roman", serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.lineWidth = CELL * 0.09;
  context.strokeStyle = 'rgba(6, 9, 20, 0.92)';
  context.fillStyle = '#ffffff';

  for (let index = 0; index < CHAR_COUNT; index += 1) {
    const character = CHARS[index] ?? ' ';
    const x = index * CELL + CELL / 2;
    const y = CELL / 2 + CELL * 0.03;
    if (character === ' ') continue;
    context.strokeText(character, x, y);
    context.fillText(character, x, y);
  }

  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export interface LabelPlacement {
  readonly text: string;
  readonly x: number;
  readonly z: number;
  readonly color: Color;
  /** Altura sobre el tablero. */
  readonly y: number;
  /** Opacidad individual, para los numeros flotantes que se apagan. */
  readonly opacity?: number;
}

export class NumberLayer {
  readonly group = new Group();

  private readonly mesh: InstancedMesh;
  private readonly material: ShaderMaterial;
  private readonly texture: CanvasTexture;
  private readonly scratch = new Object3D();

  constructor() {
    this.texture = buildAtlas();

    const geometry = new PlaneGeometry(1, 1);
    // Se apoya en el plano XZ: la "altura" del texto queda hacia el norte (-Z).
    geometry.rotateX(-Math.PI / 2);

    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uAtlas: { value: this.texture },
        uCharWidth: { value: 9 },
        uCharHeight: { value: 12 },
        uZoom: { value: 1 },
        uOpacity: { value: 1 },
      },
    });

    this.mesh = new InstancedMesh(geometry, this.material, CAPACITY);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.needsUpdate = true;

    const charAttribute = new InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
    const slotAttribute = new InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
    const centerAttribute = new InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
    const colorAttribute = new InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    const alphaAttribute = new InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
    alphaAttribute.setUsage(DynamicDrawUsage);
    charAttribute.setUsage(DynamicDrawUsage);
    slotAttribute.setUsage(DynamicDrawUsage);
    centerAttribute.setUsage(DynamicDrawUsage);
    colorAttribute.setUsage(DynamicDrawUsage);

    this.mesh.geometry.setAttribute('aChar', charAttribute);
    this.mesh.geometry.setAttribute('aSlot', slotAttribute);
    this.mesh.geometry.setAttribute('aCenter', centerAttribute);
    this.mesh.geometry.setAttribute('aColor', colorAttribute);
    this.mesh.geometry.setAttribute('aAlpha', alphaAttribute);

    this.group.add(this.mesh);
  }

  /** Reescribe todas las etiquetas. */
  update(labels: readonly LabelPlacement[]): void {
    const charAttribute = this.mesh.geometry.getAttribute('aChar') as InstancedBufferAttribute;
    const slotAttribute = this.mesh.geometry.getAttribute('aSlot') as InstancedBufferAttribute;
    const centerAttribute = this.mesh.geometry.getAttribute('aCenter') as InstancedBufferAttribute;
    const colorAttribute = this.mesh.geometry.getAttribute('aColor') as InstancedBufferAttribute;
    const alphaAttribute = this.mesh.geometry.getAttribute('aAlpha') as InstancedBufferAttribute;

    let cursor = 0;

    for (const label of labels) {
      const text = label.text;
      const center = (text.length - 1) / 2;
      const alpha = label.opacity ?? 1;
      for (let slot = 0; slot < text.length; slot += 1) {
        if (cursor >= CAPACITY) break;
        const character = text[slot] ?? ' ';
        const charIndex = Math.max(0, CHARS.indexOf(character));

        this.scratch.position.set(label.x, label.y, label.z);
        this.scratch.rotation.set(0, 0, 0);
        this.scratch.scale.setScalar(1);
        this.scratch.updateMatrix();
        this.mesh.setMatrixAt(cursor, this.scratch.matrix);

        charAttribute.setX(cursor, charIndex);
        slotAttribute.setX(cursor, slot);
        centerAttribute.setX(cursor, center);
        colorAttribute.setXYZ(cursor, label.color.r, label.color.g, label.color.b);
        alphaAttribute.setX(cursor, alpha);
        cursor += 1;
      }
    }

    this.mesh.count = cursor;
    this.mesh.instanceMatrix.needsUpdate = true;
    charAttribute.needsUpdate = true;
    slotAttribute.needsUpdate = true;
    centerAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
    alphaAttribute.needsUpdate = true;
  }

  /** Escala para que los numeros mantengan un tamano parecido en pantalla. */
  setZoomScale(value: number): void {
    this.material.uniforms['uZoom']!.value = value;
  }

  setOpacity(value: number): void {
    this.material.uniforms['uOpacity']!.value = value;
  }

  /** Tamaño base del glifo, por si la escena necesita ajustarlo. */
  setGlyphSize(width: number, height: number): void {
    this.material.uniforms['uCharWidth']!.value = width;
    this.material.uniforms['uCharHeight']!.value = height;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.group.remove(this.mesh);
  }
}
