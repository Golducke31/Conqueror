/**
 * Materiales del tablero.
 *
 * Todo con `ShaderMaterial` propio y chico: no hace falta PBR para un tablero
 * estilizado, y asi el resaltado y la atenuacion durante la batalla son
 * uniformes baratos de animar.
 *
 * `uDim` es la atenuacion del mapa: el plan de combate pide oscurecer el resto
 * del mundo mientras se juega una batalla.
 *
 * La ONDA DE CAMBIO DE DUENO tambien vive aca, como uniformes del mismo
 * material (el plan pide expresamente "no crear materiales nuevos"): un barrido
 * radial desde el punto del frente va tiñendo SOLO el territorio conquistado,
 * del color anterior (que sigue en los atributos por vertice) al del dueno
 * nuevo. Cuando la onda termina, `setGameState` reescribe los atributos con el
 * color definitivo y la onda se apaga: el corte es invisible.
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
  /**
   * Arranca la onda de cambio de dueno sobre un territorio.
   * El radio arranca en 0; quien anima llama a `setWaveRadius`.
   */
  startWave(options: {
    /** Indice del territorio en la malla (`aTerritory`). */
    readonly territory: number;
    /** Origen del barrido, en coordenadas de mundo (XZ). */
    readonly originX: number;
    readonly originZ: number;
    /** Color del dueno nuevo. */
    readonly color: Color;
  }): void;
  /** Radio actual del barrido, en unidades de mundo. */
  setWaveRadius(value: number): void;
  /** Apaga la onda (por ejemplo al terminar o al saltar). */
  clearWave(): void;
  dispose(): void;
}

/** Ancho del borde brillante del frente de la onda. */
const WAVE_EDGE = 26;

const TERRITORY_VERTEX = /* glsl */ `
  attribute float aTerritory;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying float vTerritory;
  varying vec2 vWorldXZ;
  void main() {
    vColor = color;
    vNormal = normalize(normalMatrix * normal);
    vTerritory = aTerritory;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldXZ = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const TERRITORY_FRAGMENT = /* glsl */ `
  uniform vec3 uLightDirection;
  uniform float uAmbient;
  uniform float uDim;
  uniform float uWaveTerritory;
  uniform vec2 uWaveOrigin;
  uniform float uWaveRadius;
  uniform vec3 uWaveColor;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying float vTerritory;
  varying vec2 vWorldXZ;
  void main() {
    vec3 base = vColor;

    // Onda de cambio de dueno: solo actua sobre el territorio conquistado.
    float isWave = step(abs(vTerritory - uWaveTerritory), 0.5);
    float distanceToOrigin = distance(vWorldXZ, uWaveOrigin);
    float inside = 1.0 - smoothstep(uWaveRadius - ${WAVE_EDGE.toFixed(1)}, uWaveRadius, distanceToOrigin);
    // El frente de la onda brilla levemente, con el color del dueno nuevo.
    float front = 1.0 - smoothstep(0.0, ${(WAVE_EDGE * 0.5).toFixed(1)}, abs(distanceToOrigin - uWaveRadius));
    vec3 tinted = mix(base, uWaveColor, inside * isWave);
    tinted += front * isWave * (uWaveColor * 0.45 + vec3(0.18));

    float diffuse = max(dot(normalize(vNormal), normalize(uLightDirection)), 0.0);
    vec3 shaded = tinted * (uAmbient + (1.0 - uAmbient) * diffuse);
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
      uWaveTerritory: { value: -1 },
      uWaveOrigin: { value: [0, 0] },
      uWaveRadius: { value: 0 },
      uWaveColor: { value: [1, 1, 1] },
    },
  });

  return {
    material,
    setDim(value: number): void {
      material.uniforms['uDim']!.value = value;
    },
    startWave(waveOptions): void {
      material.uniforms['uWaveTerritory']!.value = waveOptions.territory;
      material.uniforms['uWaveOrigin']!.value = [waveOptions.originX, waveOptions.originZ];
      material.uniforms['uWaveColor']!.value = [
        waveOptions.color.r,
        waveOptions.color.g,
        waveOptions.color.b,
      ];
      material.uniforms['uWaveRadius']!.value = 0;
    },
    setWaveRadius(value: number): void {
      material.uniforms['uWaveRadius']!.value = Math.max(0, value);
    },
    clearWave(): void {
      material.uniforms['uWaveTerritory']!.value = -1;
      material.uniforms['uWaveRadius']!.value = 0;
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
