/**
 * Particulas del combate.
 *
 * Un unico sistema de `Points` con **object pooling**: nada se crea ni se
 * destruye durante una batalla (lo prohibe el plan, seccion 12). Los buffers se
 * reservan una vez y se compactan los vivos al principio de cada arreglo.
 *
 * Tipos: humo de polvora, polvo, chispas y fogonazo.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DynamicDrawUsage,
  Group,
  LinearFilter,
  Points,
  ShaderMaterial,
} from 'three';
import type { Color } from 'three';

export type ParticleKind = 'smoke' | 'dust' | 'spark' | 'flash';

export interface ParticleBurst {
  readonly kind: ParticleKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Cuantas particulas emitir. */
  readonly count: number;
  /** Radio inicial de la emision. */
  readonly spread: number;
  /** Velocidad inicial. */
  readonly speed: number;
  readonly color: Color;
  /** Escala de tamaño respecto del valor por defecto del tipo. */
  readonly scale?: number;
}

interface KindProfile {
  readonly size: number;
  readonly life: number;
  readonly gravity: number;
  readonly drag: number;
  readonly grow: number;
  readonly fade: 'out' | 'in-out' | 'fast';
  readonly additive: boolean;
}

const PROFILES: Readonly<Record<ParticleKind, KindProfile>> = {
  // Humo: sube, se expande y se apaga lento.
  smoke: { size: 26, life: 1.6, gravity: 0.35, drag: 0.9, grow: 2.4, fade: 'out', additive: false },
  // Polvo: sube poco y se disipa rapido.
  dust: { size: 20, life: 1.1, gravity: 0.12, drag: 0.86, grow: 2.0, fade: 'out', additive: false },
  // Chispas: rapidas, con gravedad y vida corta.
  spark: { size: 7, life: 0.5, gravity: -6, drag: 0.94, grow: 1.0, fade: 'fast', additive: true },
  // Fogonazo: instantaneo y brillante.
  flash: { size: 34, life: 0.14, gravity: 0, drag: 1, grow: 1.6, fade: 'fast', additive: true },
};

const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (320.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uSprite;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 tex = texture2D(uSprite, gl_PointCoord);
    if (tex.a < 0.02) discard;
    gl_FragColor = vec4(vColor, tex.a * vAlpha);
  }
`;

/** Sprite radial suave, generado en canvas. */
function buildSprite(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('No se pudo crear el sprite de particulas');

  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export class ParticlePool {
  readonly group = new Group();

  private readonly capacity: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly velocities: Float32Array;
  private readonly ages: Float32Array;
  private readonly lifetimes: Float32Array;
  private readonly kinds: Uint8Array;

  private readonly geometry: BufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly texture: CanvasTexture;
  private readonly points: Points;
  private alive = 0;

  /** Generador simple, para que las rafagas no salgan todas identicas. */
  private seed = 12345;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    this.velocities = new Float32Array(capacity * 3);
    this.ages = new Float32Array(capacity);
    this.lifetimes = new Float32Array(capacity);
    this.kinds = new Uint8Array(capacity);

    this.geometry = new BufferGeometry();
    const position = new BufferAttribute(this.positions, 3);
    const color = new BufferAttribute(this.colors, 3);
    const size = new BufferAttribute(this.sizes, 1);
    const alpha = new BufferAttribute(this.alphas, 1);
    for (const attribute of [position, color, size, alpha]) {
      attribute.setUsage(DynamicDrawUsage);
    }
    this.geometry.setAttribute('position', position);
    this.geometry.setAttribute('aColor', color);
    this.geometry.setAttribute('aSize', size);
    this.geometry.setAttribute('aAlpha', alpha);
    this.geometry.setDrawRange(0, 0);
    this.geometry.boundingSphere = null;

    this.texture = buildSprite();
    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uSprite: { value: this.texture } },
    });

    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    this.group.add(this.points);
  }

  /** Numero pseudoaleatorio determinista, para no meter Math.random en la escena. */
  private random(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  /** Emite una rafaga. Nunca crea objetos. */
  spawn(burst: ParticleBurst): void {
    const profile = PROFILES[burst.kind];
    const scale = burst.scale ?? 1;
    const count = Math.min(burst.count, this.capacity - this.alive);

    for (let index = 0; index < count; index += 1) {
      const slot = this.alive;
      this.alive += 1;

      const theta = this.random() * Math.PI * 2;
      const radius = this.random() * burst.spread;
      const offsetX = Math.cos(theta) * radius;
      const offsetZ = Math.sin(theta) * radius;

      this.positions[slot * 3] = burst.x + offsetX;
      this.positions[slot * 3 + 1] = burst.y + this.random() * burst.spread * 0.4;
      this.positions[slot * 3 + 2] = burst.z + offsetZ;

      const speed = burst.speed * (0.45 + this.random() * 0.75);
      this.velocities[slot * 3] = offsetX * speed * 0.35;
      this.velocities[slot * 3 + 1] =
        speed * (burst.kind === 'spark' ? 0.9 : 0.5 + this.random() * 0.6);
      this.velocities[slot * 3 + 2] = offsetZ * speed * 0.35;

      const tint = 0.85 + this.random() * 0.3;
      this.colors[slot * 3] = burst.color.r * tint;
      this.colors[slot * 3 + 1] = burst.color.g * tint;
      this.colors[slot * 3 + 2] = burst.color.b * tint;

      this.sizes[slot] = profile.size * scale * (0.7 + this.random() * 0.6);
      this.alphas[slot] = 1;
      this.ages[slot] = 0;
      this.lifetimes[slot] = profile.life * (0.75 + this.random() * 0.5);
      this.kinds[slot] =
        burst.kind === 'smoke' ? 0 : burst.kind === 'dust' ? 1 : burst.kind === 'spark' ? 2 : 3;
    }
  }

  /** Avanza la simulacion. Las muertas se sacan por intercambio con la ultima. */
  update(deltaSeconds: number): void {
    let index = 0;
    while (index < this.alive) {
      const profile =
        PROFILES[
          this.kinds[index] === 0
            ? 'smoke'
            : this.kinds[index] === 1
              ? 'dust'
              : this.kinds[index] === 2
                ? 'spark'
                : 'flash'
        ];

      this.ages[index] = (this.ages[index] ?? 0) + deltaSeconds;
      const age = this.ages[index] ?? 0;
      const life = this.lifetimes[index] ?? 1;

      if (age >= life) {
        const last = this.alive - 1;
        this.swap(index, last);
        this.alive -= 1;
        continue;
      }

      const ratio = age / life;

      this.velocities[index * 3 + 1] =
        (this.velocities[index * 3 + 1] ?? 0) + profile.gravity * deltaSeconds;
      const drag = profile.drag ** (deltaSeconds * 60);
      this.velocities[index * 3] = (this.velocities[index * 3] ?? 0) * drag;
      this.velocities[index * 3 + 1] = (this.velocities[index * 3 + 1] ?? 0) * drag;
      this.velocities[index * 3 + 2] = (this.velocities[index * 3 + 2] ?? 0) * drag;

      this.positions[index * 3] =
        (this.positions[index * 3] ?? 0) + (this.velocities[index * 3] ?? 0) * deltaSeconds;
      this.positions[index * 3 + 1] =
        (this.positions[index * 3 + 1] ?? 0) + (this.velocities[index * 3 + 1] ?? 0) * deltaSeconds;
      this.positions[index * 3 + 2] =
        (this.positions[index * 3 + 2] ?? 0) + (this.velocities[index * 3 + 2] ?? 0) * deltaSeconds;

      this.sizes[index] = (this.sizes[index] ?? 0) * (1 + (profile.grow - 1) * deltaSeconds * 0.8);

      const alpha =
        profile.fade === 'fast'
          ? Math.max(0, 1 - ratio * ratio)
          : profile.fade === 'in-out'
            ? Math.sin(Math.PI * ratio)
            : Math.max(0, 1 - ratio) ** 1.4;
      this.alphas[index] = alpha;

      index += 1;
    }

    this.geometry.setDrawRange(0, this.alive);
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('aColor').needsUpdate = true;
    this.geometry.getAttribute('aSize').needsUpdate = true;
    this.geometry.getAttribute('aAlpha').needsUpdate = true;
  }

  /** Mueve el slot `from` al `to`, incluidos todos los atributos. */
  private swap(from: number, to: number): void {
    if (from === to) return;
    for (let axis = 0; axis < 3; axis += 1) {
      this.positions[to * 3 + axis] = this.positions[from * 3 + axis] ?? 0;
      this.velocities[to * 3 + axis] = this.velocities[from * 3 + axis] ?? 0;
      this.colors[to * 3 + axis] = this.colors[from * 3 + axis] ?? 0;
    }
    this.sizes[to] = this.sizes[from] ?? 0;
    this.alphas[to] = this.alphas[from] ?? 0;
    this.ages[to] = this.ages[from] ?? 0;
    this.lifetimes[to] = this.lifetimes[from] ?? 0;
    this.kinds[to] = this.kinds[from] ?? 0;
  }

  /** Apaga todo sin liberar buffers. */
  clear(): void {
    this.alive = 0;
    this.geometry.setDrawRange(0, 0);
  }

  aliveCount(): number {
    return this.alive;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.group.remove(this.points);
  }
}
