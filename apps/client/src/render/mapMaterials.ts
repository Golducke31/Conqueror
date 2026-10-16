/**
 * Materiales del tablero.
 *
 * Todo con `ShaderMaterial` propio y chico: no hace falta PBR para un tablero
 * estilizado, y asi el resaltado y la atenuacion durante la batalla son
 * uniformes baratos de animar.
 *
 * `uDim` es la atenuacion del mapa: el plan de combate pide oscurecer el resto
 * del mundo mientras se juega una batalla.
 */

import type { Color, Vector3 } from 'three';
import { DoubleSide, ShaderMaterial } from 'three';

export interface TerritoryMaterialOptions {
  /** Color de la luz principal. */
  readonly lightDirection: Vector3;
  /** Luz ambiente minima, para que ninguna cara quede negra. */
  readonly ambient: number;
}

export interface TerritoryMaterialHandle {
  readonly material: ShaderMaterial;
  /** Atenuacion global, 0 = negro, 1 = normal. */
  setDim(value: number): void;
  dispose(): void;
}

const TERRITORY_VERTEX = /* glsl */ `
  attribute float aTerritory;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying float vTerritory;
  void main() {
    vColor = color;
    vNormal = normalize(normalMatrix * normal);
    vTerritory = aTerritory;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TERRITORY_FRAGMENT = /* glsl */ `
  uniform vec3 uLightDirection;
  uniform float uAmbient;
  uniform float uDim;
  varying vec3 vColor;
  varying vec3 vNormal;
  void main() {
    float diffuse = max(dot(normalize(vNormal), normalize(uLightDirection)), 0.0);
    vec3 shaded = vColor * (uAmbient + (1.0 - uAmbient) * diffuse);
    gl_FragColor = vec4(shaded * uDim, 1.0);
  }
`;

export function createTerritoryMaterial(
  options: TerritoryMaterialOptions,
): TerritoryMaterialHandle {
  const material = new ShaderMaterial({
    vertexColors: true,
    vertexShader: TERRITORY_VERTEX,
    fragmentShader: TERRITORY_FRAGMENT,
    uniforms: {
      uLightDirection: { value: options.lightDirection.clone().normalize() },
      uAmbient: { value: options.ambient },
      uDim: { value: 1 },
    },
  });

  return {
    material,
    setDim(value: number): void {
      material.uniforms['uDim']!.value = value;
    },
    dispose(): void {
      material.dispose();
    },
  };
}

export interface HighlightMaterialHandle {
  readonly material: ShaderMaterial;
  setHover(territoryIndex: number): void;
  setSelected(territoryIndex: number): void;
  setOpacity(value: number): void;
  dispose(): void;
}

const HIGHLIGHT_VERTEX = /* glsl */ `
  attribute float aTerritory;
  varying float vTerritory;
  void main() {
    vTerritory = aTerritory;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HIGHLIGHT_FRAGMENT = /* glsl */ `
  uniform float uHover;
  uniform float uSelected;
  uniform vec3 uHoverColor;
  uniform vec3 uSelectedColor;
  uniform float uOpacity;
  varying float vTerritory;
  void main() {
    float isHover = step(abs(vTerritory - uHover), 0.5);
    float isSelected = step(abs(vTerritory - uSelected), 0.5);
    float weight = max(isHover, isSelected);
    if (weight < 0.5) discard;
    vec3 tint = mix(uHoverColor, uSelectedColor, isSelected);
    gl_FragColor = vec4(tint, uOpacity * weight);
  }
`;

/**
 * Malla de resaltado: comparte la geometria del tablero y descarta en el
 * fragment shader todo lo que no sea el territorio apuntado o seleccionado.
 */
export function createHighlightMaterial(
  hoverColor: Color,
  selectedColor: Color,
): HighlightMaterialHandle {
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    // Se dibuja apenas por encima de la cara superior, sin pelearse con el z.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    vertexShader: HIGHLIGHT_VERTEX,
    fragmentShader: HIGHLIGHT_FRAGMENT,
    uniforms: {
      uHover: { value: -1 },
      uSelected: { value: -1 },
      uHoverColor: { value: hoverColor.clone() },
      uSelectedColor: { value: selectedColor.clone() },
      uOpacity: { value: 0.28 },
    },
  });

  return {
    material,
    setHover(territoryIndex: number): void {
      material.uniforms['uHover']!.value = territoryIndex;
    },
    setSelected(territoryIndex: number): void {
      material.uniforms['uSelected']!.value = territoryIndex;
    },
    setOpacity(value: number): void {
      material.uniforms['uOpacity']!.value = value;
    },
    dispose(): void {
      material.dispose();
    },
  };
}
