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
 *
 * El FRENTE CALIENTE (battleHeat, C4) es un atributo por vertice (`aHeat`,
 * 0..1 por territorio, derivado del log de eventos — ver heat/heatModel.ts).
 * Se refleja en el shader: oscurecimiento, humo claro y brasas en los BORDES
 * del territorio. El borde se detecta con `fwidth(vTerritory)`: dentro de un
 * territorio el atributo es constante (derivada cero) y salta en la frontera.
 * Es solo visual y no decide nada.
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
  /** Reloj para el pulso de las brasas y el humo. */
  setTime(seconds: number): void;
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

/** Cuanto oscurece el calor en el centro del territorio. */
const HEAT_DARKEN = 0.35;

/** Cuanto de humo claro se mezcla con el calor a tope. */
const HEAT_SMOKE = 0.18;

const TERRITORY_VERTEX = /* glsl */ `
  attribute float aTerritory;
  attribute float aHeat;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying float vTerritory;
  varying float vHeat;
  varying vec2 vWorldXZ;
  void main() {
    vColor = color;
    vNormal = normalize(normalMatrix * normal);
    vTerritory = aTerritory;
    vHeat = aHeat;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldXZ = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const TERRITORY_FRAGMENT = /* glsl */ `
  uniform vec3 uLightDirection;
  uniform float uAmbient;
  uniform float uDim;
  uniform float uTime;
  uniform float uWaveTerritory;
  uniform vec2 uWaveOrigin;
  uniform float uWaveRadius;
  uniform vec3 uWaveColor;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying float vTerritory;
  varying float vHeat;
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

    // Frente caliente: oscurecimiento y humo claro en el territorio peleado.
    tinted *= 1.0 - ${HEAT_DARKEN.toFixed(2)} * vHeat;
    tinted = mix(tinted, vec3(0.52, 0.48, 0.44), vHeat * ${HEAT_SMOKE.toFixed(2)});

    // Brasas en los bordes: vTerritory es constante dentro de un territorio y
    // salta en la frontera, asi que su derivada local marca el borde.
    float edge = smoothstep(0.5, 2.0, fwidth(vTerritory));
    float pulse = 0.55 + 0.45 * sin(uTime * 3.2 + vTerritory * 11.0 + vWorldXZ.x * 0.02);
    vec3 ember = vec3(1.0, 0.38, 0.08);
    tinted += edge * vHeat * pulse * ember * 0.85;

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
      uTime: { value: 0 },
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
    setTime(seconds: number): void {
      material.uniforms['uTime']!.value = seconds;
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
  /** Origen de la accion (territorio propio elegido). */
  setSelected(territoryIndex: number): void;
  /** Destino de la accion (enemigo al que se va a atacar). */
  setTarget(territoryIndex: number): void;
  setOpacity(value: number): void;
  /** Reloj para el pulso de la seleccion. */
  setTime(seconds: number): void;
  dispose(): void;
}

/** Colores de los tres estados de resaltado del tablero. */
export interface HighlightColors {
  readonly hover: Color;
  readonly selected: Color;
  readonly target: Color;
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
  uniform float uTarget;
  uniform vec3 uHoverColor;
  uniform vec3 uSelectedColor;
  uniform vec3 uTargetColor;
  uniform float uHoverOpacity;
  uniform float uSelectedOpacity;
  uniform float uTargetOpacity;
  uniform float uOpacity;
  uniform float uTime;
  varying float vTerritory;
  void main() {
    float isHover = step(abs(vTerritory - uHover), 0.5);
    float isSelected = step(abs(vTerritory - uSelected), 0.5);
    float isTarget = step(abs(vTerritory - uTarget), 0.5);
    float weight = max(max(isHover, isSelected), isTarget);
    if (weight < 0.5) discard;

    // El destino manda sobre el origen y el origen sobre el hover: si un
    // territorio cumple dos roles (p. ej. el puntero esta sobre el origen), se
    // pinta el rol mas fuerte en vez de mezclar colores.
    vec3 tint = uHoverColor;
    tint = mix(tint, uSelectedColor, isSelected);
    tint = mix(tint, uTargetColor, isTarget);

    float alpha = max(max(uHoverOpacity * isHover, uSelectedOpacity * isSelected), uTargetOpacity * isTarget);
    // Pulso suave: la seleccion activa se nota sin parpadear.
    alpha *= 0.84 + 0.16 * sin(uTime * 4.2);
    gl_FragColor = vec4(tint, alpha * uOpacity);
  }
`;

/**
 * Malla de resaltado: comparte la geometria del tablero y descarta en el
 * fragment shader todo lo que no sea el territorio apuntado, el origen o el
 * destino de la accion en curso.
 */
export function createHighlightMaterial(colors: HighlightColors): HighlightMaterialHandle {
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
      uTarget: { value: -1 },
      uHoverColor: { value: colors.hover.clone() },
      uSelectedColor: { value: colors.selected.clone() },
      uTargetColor: { value: colors.target.clone() },
      // El destino es el estado que mas tiene que gritar: es el que el jugador
      // esta por confirmar.
      uHoverOpacity: { value: 0.22 },
      uSelectedOpacity: { value: 0.38 },
      uTargetOpacity: { value: 0.5 },
      uOpacity: { value: 1 },
      uTime: { value: 0 },
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
    setTarget(territoryIndex: number): void {
      material.uniforms['uTarget']!.value = territoryIndex;
    },
    setOpacity(value: number): void {
      material.uniforms['uOpacity']!.value = value;
    },
    setTime(seconds: number): void {
      material.uniforms['uTime']!.value = seconds;
    },
    dispose(): void {
      material.dispose();
    },
  };
}
