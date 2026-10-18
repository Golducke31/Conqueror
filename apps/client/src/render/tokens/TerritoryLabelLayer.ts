/**
 * Capa de nombres de territorio.
 *
 * El nombre de cada pais se dibuja SOBRE el tablero, en el lugar del pais, para
 * que el jugador no tenga que adivinar que territorio esta tocando.
 *
 * Presupuesto: un `InstancedMesh` y un atlas de palabras en canvas. Un
 * `Sprite`/`Text` por etiqueta serian 50 draw calls; esto es una sola. El atlas
 * se arma una vez con todas las etiquetas, cada una en su celda, y el shader
 * elige la celda con dos atributos por instancia (`aUvOffset`, `aUvScale`).
 *
 * El texto se dibuja blanco con contorno oscuro (igual que los numeros de
 * ejercitos): el blanco se tinta por instancia, asi el territorio apuntado o
 * seleccionado se resalta sin placa de fondo y el nombre se lee sobre cualquier
 * color de jugador.
 *
 * Las etiquetas van planas sobre el plano XZ, como los numeros: el tablero se
 * mira en perspectiva y un texto que siempre mirara a la camara flotaria fuera
 * del mapa.
 */

import {
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import type { TerritoryId } from '@conqueror/shared';

/** Ancho de cada celda del atlas, en pixeles. */
const CELL_W = 384;
/** Alto de cada celda del atlas. */
const CELL_H = 96;
/** Grilla del atlas: 5 x 10 = 50 celdas, una por territorio. */
const COLS = 5;
const ROWS = 10;
/** Margen interno de la celda, para que el texto no toque los bordes. */
const PADDING_X = 10;
const PADDING_Y = 8;

const VERTEX = /* glsl */ `
  attribute vec2 aUvOffset;
  attribute vec2 aUvScale;
  attribute vec3 aColor;
  attribute float aAlpha;
  uniform float uWidth;
  uniform float uHeight;
  uniform float uZoom;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vUv = aUvOffset + uv * aUvScale;
    vColor = aColor;
    vAlpha = aAlpha;

    // El plano unidad se estira al tamano de la etiqueta y se escala con el
    // zoom para que el texto mantenga un tamano legible en pantalla.
    vec3 scaled = vec3(position.x * uWidth, 0.0, position.z * uHeight) * uZoom;
    vec4 placed = instanceMatrix * vec4(scaled, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * placed;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec4 tex = texture2D(uAtlas, vUv);
    if (tex.a < 0.12) discard;
    gl_FragColor = vec4(tex.rgb * vColor, tex.a * uOpacity * vAlpha);
  }
`;

export interface TerritoryLabel {
  readonly territory: TerritoryId;
  readonly text: string;
  /** Posicion del ancla, en coordenadas de mundo. */
  readonly x: number;
  readonly z: number;
  /** Altura sobre el tablero. */
  readonly y: number;
  /** 1 = resaltada (apuntada, origen o destino), 0 = normal. */
  readonly emphasis: number;
}

export interface TerritoryLabelLayerOptions {
  /** Color de las etiquetas normales. */
  readonly baseColor: Color;
  /** Color de la etiqueta resaltada. */
  readonly emphasisColor: Color;
  /** Alto en unidades de mundo de una etiqueta. */
  readonly worldHeight: number;
}

/** Dibuja una palabra centrada en su celda, ajustando el cuerpo a lo ancho. */
function drawCell(context: CanvasRenderingContext2D, text: string, col: number, row: number): void {
  const left = col * CELL_W;
  const top = row * CELL_H;

  context.save();
  context.beginPath();
  context.rect(left, top, CELL_W, CELL_H);
  context.clip();

  const maxWidth = CELL_W - PADDING_X * 2;
  const maxHeight = CELL_H - PADDING_Y * 2;

  // Cuerpo inicial limitado por el alto; si la palabra no entra a lo ancho, se
  // reduce hasta que entre. Asi todas las etiquetas tienen la misma altura
  // salvo las muy largas, que quedan un poco mas chicas en vez de cortarse.
  let size = Math.round(maxHeight * 0.82);
  context.font = `600 ${size}px "Trebuchet MS", "Segoe UI", system-ui, sans-serif`;
  const measured = context.measureText(text).width;
  if (measured > maxWidth) {
    size = Math.max(12, Math.floor((size * maxWidth) / measured));
    context.font = `600 ${size}px "Trebuchet MS", "Segoe UI", system-ui, sans-serif`;
  }

  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.miterLimit = 2;
  // Contorno oscuro grueso: el nombre se lee sobre cualquier color de jugador.
  context.lineWidth = Math.max(3, size * 0.16);
  context.strokeStyle = 'rgba(6, 9, 20, 0.94)';
  context.fillStyle = '#ffffff';

  const x = left + CELL_W / 2;
  const y = top + CELL_H / 2 + size * 0.04;
  context.strokeText(text, x, y);
  context.fillText(text, x, y);
  context.restore();
}

/** Arma el atlas con una celda por etiqueta, en el orden recibido. */
function buildAtlas(texts: readonly string[]): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W * COLS;
  canvas.height = CELL_H * ROWS;

  const context = canvas.getContext('2d');
  if (context === null) throw new Error('No se pudo crear el canvas del atlas de nombres');

  context.clearRect(0, 0, canvas.width, canvas.height);
  texts.forEach((text, index) => {
    if (index >= COLS * ROWS) return;
    drawCell(context, text, index % COLS, Math.floor(index / COLS));
  });

  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export class TerritoryLabelLayer {
  readonly group = new Group();

  private readonly mesh: InstancedMesh;
  private readonly material: ShaderMaterial;
  private readonly texture: CanvasTexture;
  private readonly scratch = new Object3D();
  private readonly tint = new Color();
  private readonly baseColor: Color;
  private readonly emphasisColor: Color;
  /** Celda del atlas de cada territorio, por id. */
  private readonly cellOf = new Map<TerritoryId, number>();
  private readonly capacity: number;

  constructor(
    labels: readonly { readonly territory: TerritoryId; readonly text: string }[],
    options: TerritoryLabelLayerOptions,
  ) {
    const texts = labels.map((label) => label.text);
    labels.forEach((label, index) => this.cellOf.set(label.territory, index));
    this.texture = buildAtlas(texts);

    this.capacity = Math.max(1, labels.length);
    const geometry = new PlaneGeometry(1, 1);
    // El plano unidad se apoya en XZ: "arriba" del texto queda hacia -Z.
    geometry.rotateX(-Math.PI / 2);

    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uAtlas: { value: this.texture },
        uWidth: { value: options.worldHeight * (CELL_W / CELL_H) },
        uHeight: { value: options.worldHeight },
        uZoom: { value: 1 },
        uOpacity: { value: 1 },
      },
    });

    this.mesh = new InstancedMesh(geometry, this.material, this.capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.needsUpdate = true;

    const uvOffset = new InstancedBufferAttribute(new Float32Array(this.capacity * 2), 2);
    const uvScale = new InstancedBufferAttribute(new Float32Array(this.capacity * 2), 2);
    const color = new InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3);
    const alpha = new InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    for (const attribute of [uvOffset, uvScale, color, alpha]) {
      attribute.setUsage(DynamicDrawUsage);
    }

    this.mesh.geometry.setAttribute('aUvOffset', uvOffset);
    this.mesh.geometry.setAttribute('aUvScale', uvScale);
    this.mesh.geometry.setAttribute('aColor', color);
    this.mesh.geometry.setAttribute('aAlpha', alpha);

    this.baseColor = options.baseColor.clone();
    this.emphasisColor = options.emphasisColor.clone();

    this.group.add(this.mesh);
  }

  /** Reescribe las etiquetas visibles (una instancia por territorio listado). */
  update(labels: readonly TerritoryLabel[]): void {
    const uvOffset = this.mesh.geometry.getAttribute('aUvOffset') as InstancedBufferAttribute;
    const uvScale = this.mesh.geometry.getAttribute('aUvScale') as InstancedBufferAttribute;
    const colorAttribute = this.mesh.geometry.getAttribute('aColor') as InstancedBufferAttribute;
    const alphaAttribute = this.mesh.geometry.getAttribute('aAlpha') as InstancedBufferAttribute;

    const uScale = 1 / COLS;
    const vScale = 1 / ROWS;

    let cursor = 0;
    for (const label of labels) {
      const cell = this.cellOf.get(label.territory);
      if (cell === undefined || cursor >= this.capacity) continue;

      const col = cell % COLS;
      const row = Math.floor(cell / COLS);

      this.scratch.position.set(label.x, label.y, label.z);
      this.scratch.rotation.set(0, 0, 0);
      this.scratch.scale.setScalar(1);
      this.scratch.updateMatrix();
      this.mesh.setMatrixAt(cursor, this.scratch.matrix);

      // El canvas crece hacia abajo y la textura tiene `flipY`: la fila 0 del
      // dibujo es la banda de arriba de la textura.
      uvOffset.setXY(cursor, col * uScale, 1 - (row + 1) * vScale);
      uvScale.setXY(cursor, uScale, vScale);

      const emphasis = Math.min(1, Math.max(0, label.emphasis));
      this.tint.copy(this.baseColor).lerp(this.emphasisColor, emphasis);
      colorAttribute.setXYZ(cursor, this.tint.r, this.tint.g, this.tint.b);
      alphaAttribute.setX(cursor, 0.62 + 0.38 * emphasis);
      cursor += 1;
    }

    this.mesh.count = cursor;
    this.mesh.instanceMatrix.needsUpdate = true;
    uvOffset.needsUpdate = true;
    uvScale.needsUpdate = true;
    colorAttribute.needsUpdate = true;
    alphaAttribute.needsUpdate = true;
  }

  /** Escala para que los nombres mantengan un tamano parecido en pantalla. */
  setZoomScale(value: number): void {
    this.material.uniforms['uZoom']!.value = value;
  }

  /** Opacidad global: se baja al alejar la camara para no saturar el mapa. */
  setOpacity(value: number): void {
    this.material.uniforms['uOpacity']!.value = Math.min(1, Math.max(0, value));
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.group.remove(this.mesh);
  }
}
