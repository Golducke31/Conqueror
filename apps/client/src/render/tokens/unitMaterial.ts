/**
 * Material de las unidades.
 *
 * El color del jugador se aplica SOLO sobre la mascara de uniforme (`aMask`),
 * como pide el plan: el resto del modelo queda en tonos neutros y asi el color
 * se lee a distancia. Se usa `instanceColor`, que three declara solo cuando la
 * malla es instanciada y tiene colores por instancia.
 *
 * El balanceo en reposo va en el vertex shader: cero costo de CPU.
 */

import { ShaderMaterial, Vector3 } from 'three';

export interface UnitMaterialHandle {
  readonly material: ShaderMaterial;
  setTime(seconds: number): void;
  setDim(value: number): void;
  dispose(): void;
}

const VERTEX = /* glsl */ `
  attribute vec3 aColor;
  attribute float aMask;
  uniform float uTime;
  varying vec3 vColor;
  varying vec3 vNormal;

  void main() {
    #ifdef USE_INSTANCING_COLOR
      vColor = mix(aColor, aColor * instanceColor, aMask);
    #else
      vColor = aColor;
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
  varying vec3 vColor;
  varying vec3 vNormal;

  void main() {
    float diffuse = max(dot(normalize(vNormal), normalize(uLightDirection)), 0.0);
    vec3 shaded = vColor * (uAmbient + (1.0 - uAmbient) * diffuse);
    gl_FragColor = vec4(shaded * uDim, uOpacity);
  }
`;

export function createUnitMaterial(): UnitMaterialHandle {
  const material = new ShaderMaterial({
    transparent: false,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uLightDirection: { value: new Vector3(0.45, 0.82, 0.35).normalize() },
      uAmbient: { value: 0.42 },
      uDim: { value: 1 },
      uOpacity: { value: 1 },
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
    dispose(): void {
      material.dispose();
    },
  };
}
