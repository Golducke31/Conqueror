/**
 * Material de las unidades.
 *
 * El color del jugador se aplica SOLO sobre la mascara de uniforme (`aMask`),
 * como pide el plan: el resto del modelo queda en tonos neutros y asi el color
 * se lee a distancia. Se usa `instanceColor`, que three declara solo cuando la
 * malla es instanciada y tiene colores por instancia.
 *
 * El mismo material sirve para las primitivas y para los modelos finales
 * (ADR 0012): si el modelo trae atlas, se multiplica por la textura; si la
 * mascara esta pintada en un canal del atlas en vez de por vertice, se toma de
 * ahi. Con `uHasMap` en 0 el resultado es identico al de la fase placeholder.
 *
 * El balanceo en reposo va en el vertex shader: cero costo de CPU.
 */

import type { ShaderMaterial, Texture } from 'three';
import { ShaderMaterial as ShaderMaterialImpl, Vector3 } from 'three';

import type { MaskChannel } from './models/manifest.js';

export interface UnitMaterialHandle {
  readonly material: ShaderMaterial;
  setTime(seconds: number): void;
  setDim(value: number): void;
  /** Opacidad global del lote, para fundidos (conquista, cierres). */
  setOpacity(value: number): void;
  /** Atlas de texturas del modelo y canal de la mascara, si viene pintada. */
  setMap(map: Texture | null, maskChannel?: MaskChannel): void;
  dispose(): void;
}

/** Canal de la textura, en el orden que espera el shader. */
const CANAL: Readonly<Record<MaskChannel, number>> = { none: 0, r: 1, g: 2, b: 3, a: 4 };

const VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute float aMask;
  uniform float uTime;
  varying vec3 vColor;
  varying vec3 vTint;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying float vMask;

  void main() {
    vColor = aColor;
    vMask = aMask;
    vUv = uv;
    vTint = vec3(1.0);
    #ifdef USE_INSTANCING_COLOR
      vTint = instanceColor;
    #endif

    vec3 transformed = position;
    // Balanceo en reposo: la fase sale de la posicion de la instancia, asi que
    // no hace falta subir ningun dato por unidad desde la CPU.
    float phase = instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.61;
    transformed.y += sin(uTime * 1.1 + phase) * 0.16;

    vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uLightDirection;
  uniform float uAmbient;
  uniform float uDim;
  uniform float uOpacity;
  uniform sampler2D uMap;
  uniform float uHasMap;
  uniform float uMaskChannel;
  varying vec3 vColor;
  varying vec3 vTint;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying float vMask;

  float canalDeMascara(vec4 texel) {
    if (uMaskChannel < 1.5) return texel.r;
    if (uMaskChannel < 2.5) return texel.g;
    if (uMaskChannel < 3.5) return texel.b;
    return texel.a;
  }

  void main() {
    vec4 texel = vec4(1.0);
    if (uHasMap > 0.5) texel = texture2D(uMap, vUv);

    // La mascara sale del vertice o del canal del atlas, si esta pintada ahi.
    float mask = vMask;
    if (uHasMap > 0.5 && uMaskChannel > 0.5) mask = canalDeMascara(texel);

    vec3 tinted = mix(vColor, vColor * vTint, mask);
    vec3 base = tinted * texel.rgb;

    float diffuse = max(dot(normalize(vNormal), normalize(uLightDirection)), 0.0);
    vec3 shaded = base * (uAmbient + (1.0 - uAmbient) * diffuse);
    gl_FragColor = vec4(shaded * uDim, uOpacity);
  }
`;

export function createUnitMaterial(): UnitMaterialHandle {
  const material = new ShaderMaterialImpl({
    transparent: false,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uLightDirection: { value: new Vector3(0.45, 0.82, 0.35).normalize() },
      uAmbient: { value: 0.42 },
      uDim: { value: 1 },
      uOpacity: { value: 1 },
      uMap: { value: null },
      uHasMap: { value: 0 },
      uMaskChannel: { value: 0 },
    },
  });

  return {
    material,
    setTime(seconds: number): void {
      material.uniforms['uTime']!.value = seconds;
    },
    setDim(value: number): void {
      material.uniforms['uDim']!.value = value;
    },
    setOpacity(value: number): void {
      material.uniforms['uOpacity']!.value = Math.max(0, Math.min(1, value));
    },
    setMap(map: Texture | null, maskChannel: MaskChannel = 'none'): void {
      material.uniforms['uMap']!.value = map;
      material.uniforms['uHasMap']!.value = map === null ? 0 : 1;
      material.uniforms['uMaskChannel']!.value = CANAL[maskChannel];
    },
    dispose(): void {
      material.dispose();
    },
  };
}
