/**
 * Escena del tablero.
 *
 * Une todo: geometria del mundo, fichas instanciadas, numeros, camara y
 * picking. No conoce las reglas del juego: recibe un estado publico y lo dibuja.
 * El combate visual se le enchufa por `director`.
 *
 * Presupuesto de draw calls de la escena en reposo:
 *   oceano 1 + tablero 1 + resaltado 1 + fronteras 1 + rutas maritimas 1
 *   + 3 tipos de unidad + 1 capa de numeros = 9
 */

import type { Color } from 'three';
import {
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector2,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import gsap from 'gsap';

import type { TerritoryId } from '@conqueror/shared';
import type { MockGameState } from '../../app/fixtures.js';
import {
  BORDER_COLOR,
  HOVER_COLOR,
  LABEL_NEUTRAL_COLOR,
  NEUTRAL_COLOR,
  OCEAN_COLOR,
  SEA_ROUTE_COLOR,
  SELECT_COLOR,
  playerColor,
} from '../../app/palette.js';
import type { RendererHandle } from '../../render/renderer.js';
import { createHighlightMaterial, createTerritoryMaterial } from '../../render/mapMaterials.js';
import { NumberLayer } from '../../render/tokens/NumberLayer.js';
import { SquadLayer } from '../../render/tokens/SquadLayer.js';
import { buildBoard, territoryAnchors, type BoardBuild } from '../../map/boardGeometry.js';
import { createCameraRig, type CameraRig, type FocusOptions } from '../../map/cameraRig.js';
import { loadMapData, type LoadedMapData } from '../../map/loadMapData.js';
import { TerritoryPicker } from '../../map/picking.js';

/** Distancia de referencia para el tamaño en pantalla de los numeros. */
const LABEL_REFERENCE_DISTANCE = 620;

export interface GameSceneOptions {
  readonly renderer: RendererHandle;
  readonly canvas: HTMLCanvasElement;
  readonly reducedMotion: boolean;
  /** Tope de unidades por ficha en el mapa. */
  readonly mapMaxUnits: number;
}

export interface GameScene {
  readonly data: LoadedMapData;
  readonly board: BoardBuild;
  readonly rig: CameraRig;
  readonly group: Group;
  setGameState(state: MockGameState): void;
  selected(): TerritoryId | null;
  hovered(): TerritoryId | null;
  onSelect(callback: (territory: TerritoryId | null) => void): void;
  focusTerritory(territory: TerritoryId, options?: FocusOptions): void;
  /** Encuadra un punto del tablero en coordenadas de mundo. */
  focusPoint(x: number, z: number, options?: FocusOptions): void;
  /** Atenuacion del mapa, para la escena de batalla. */
  setDim(value: number): void;
  /** Unidades visibles en el tablero, para el overlay de depuracion. */
  visibleUnits(): number;
  /** Indice del territorio en la malla fusionada (`aTerritory`). */
  territoryIndex(territory: TerritoryId): number | undefined;
  /**
   * Radio, en unidades de mundo, que cubre el territorio desde un punto: la
   * onda de cambio de dueno lo usa para saber hasta donde tiene que barrer.
   */
  coverRadiusFrom(territory: TerritoryId, x: number, z: number): number | undefined;
  /**
   * Onda de cambio de dueno sobre el material del tablero. Devuelve la timeline
   * para encadenarla a la coreografia de la conquista.
   *
   * OJO con el orden: los atributos de color por vertice siguen teniendo el
   * color ANTERIOR mientras la onda corre. Recien cuando la onda termina hay que
   * llamar a `setGameState` con el dueno nuevo, que reescribe los atributos con
   * el mismo color que muestra el shader. Si se llama antes, el territorio
   * "desaparece" de la onda.
   */
  playOwnershipWave(options: {
    readonly territoryIndex: number;
    readonly originX: number;
    readonly originZ: number;
    readonly color: Color;
    readonly radius: number;
    readonly duration: number;
  }): gsap.core.Timeline;
  /** Fuerza la onda a su estado final, para cuando se salta la animacion. */
  finishOwnershipWave(): void;
  update(deltaSeconds: number): void;
  dispose(): void;
}

export async function createGameScene(options: GameSceneOptions): Promise<GameScene> {
  const data = await loadMapData();

  let gameState: MockGameState | null = null;

  const colorFor = (territory: TerritoryId): Color | null => {
    const owner = gameState?.territories[territory]?.owner ?? null;
    if (owner === null) return null;
    const player = gameState?.players.find((candidate) => candidate.id === owner);
    return player === undefined ? null : playerColor(player.color);
  };

  const board = buildBoard(data, {
    colorFor,
    neutralColor: NEUTRAL_COLOR,
    borderColor: BORDER_COLOR,
    seaRouteColor: SEA_ROUTE_COLOR,
  });

  const group = new Group();

  const oceanMaterial = new MeshBasicMaterial({ color: OCEAN_COLOR });
  const ocean = new Mesh(board.ocean, oceanMaterial);
  ocean.renderOrder = 0;

  const territoryMaterial = createTerritoryMaterial({
    lightDirection: new Vector3(0.42, 0.86, 0.3),
    ambient: 0.5,
  });
  const mapMesh = new Mesh(board.map, territoryMaterial.material);
  mapMesh.renderOrder = 1;

  const highlightMaterial = createHighlightMaterial(HOVER_COLOR, SELECT_COLOR);
  const highlightMesh = new Mesh(board.map, highlightMaterial.material);
  highlightMesh.renderOrder = 2;
  highlightMesh.raycast = () => undefined;

  const borderMaterial = new LineBasicMaterial({
    color: BORDER_COLOR,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });
  const borders = new LineSegments(board.borders, borderMaterial);
  borders.renderOrder = 3;

  const seaRouteMaterial = new LineBasicMaterial({
    color: SEA_ROUTE_COLOR,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const seaRoutes = new LineSegments(board.seaRoutes, seaRouteMaterial);
  seaRoutes.renderOrder = 3;

  const anchors = territoryAnchors(data, board.projection);

  // Rango de vertices de cada territorio dentro de la malla fusionada. Se
  // calcula una sola vez: reescribir los colores de dueno recorriendo las caras
  // para cada territorio seria cuadratico.
  const vertexRanges = new Int32Array(board.territoryIds.length * 2);
  {
    let current = -1;
    for (let face = 0; face < board.faceTerritory.length; face += 1) {
      const index = board.faceTerritory[face] ?? 0;
      if (index !== current) {
        if (current >= 0) vertexRanges[current * 2 + 1] = face * 3;
        current = index;
        vertexRanges[current * 2] = face * 3;
      }
    }
    if (current >= 0) vertexRanges[current * 2 + 1] = board.faceTerritory.length * 3;
  }

  const squads = new SquadLayer({
    maxUnits: options.mapMaxUnits,
    unitScale: 1.5,
    baseY: board.relief + 0.4,
  });
  squads.group.renderOrder = 4;

  const numbers = new NumberLayer();
  numbers.group.renderOrder = 5;

  group.add(ocean, mapMesh, highlightMesh, borders, seaRoutes, squads.group, numbers.group);

  const camera = options.renderer.camera;
  const rig = createCameraRig({
    camera,
    domElement: options.canvas,
    boardWidth: board.projection.width,
    boardHeight: board.projection.height,
    minDistance: 90,
    maxDistance: 1400,
  });

  // Pose inicial: el mundo entero a la vista, con una inclinacion que da
  // profundidad sin deformar demasiado el tablero.
  rig.focusOn(0, 0, { distance: 880, polarDeg: 42, instant: true });
  rig.controls.target.set(0, 0, 0);
  rig.controls.update();

  const picker = new TerritoryPicker(board.faceTerritory, board.territoryIds);
  const raycaster = new Raycaster();
  const pointer = new Vector2();

  let hoveredTerritory: TerritoryId | null = null;
  let selectedTerritory: TerritoryId | null = null;
  const selectListeners = new Set<(territory: TerritoryId | null) => void>();

  const refreshHighlight = (): void => {
    highlightMaterial.setHover(picker.indexOf(hoveredTerritory ?? ''));
    highlightMaterial.setSelected(picker.indexOf(selectedTerritory ?? ''));
    options.renderer.requestRender();
  };

  const toPointer = (event: PointerEvent): void => {
    const rect = options.canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  };

  let hoverScheduled = false;
  const onPointerMove = (event: PointerEvent): void => {
    toPointer(event);
    if (hoverScheduled) return;
    hoverScheduled = true;
    requestAnimationFrame(() => {
      hoverScheduled = false;
      const result = picker.pick(raycaster, camera as PerspectiveCamera, mapMesh, pointer);
      const next = result?.territory ?? null;
      if (next === hoveredTerritory) return;
      hoveredTerritory = next;
      refreshHighlight();
    });
  };

  let downX = 0;
  let downY = 0;
  const onPointerDown = (event: PointerEvent): void => {
    downX = event.clientX;
    downY = event.clientY;
  };

  const onPointerUp = (event: PointerEvent): void => {
    // Solo se considera clic si el puntero casi no se movio: si no, fue un
    // arrastre de camara.
    if (Math.hypot(event.clientX - downX, event.clientY - downY) > 6) return;
    toPointer(event);
    const result = picker.pick(raycaster, camera as PerspectiveCamera, mapMesh, pointer);
    const next = result?.territory ?? null;
    selectedTerritory = next;
    refreshHighlight();
    for (const listener of selectListeners) listener(next);
  };

  const onPointerLeave = (): void => {
    if (hoveredTerritory === null) return;
    hoveredTerritory = null;
    refreshHighlight();
  };

  options.canvas.addEventListener('pointermove', onPointerMove);
  options.canvas.addEventListener('pointerdown', onPointerDown);
  options.canvas.addEventListener('pointerup', onPointerUp);
  options.canvas.addEventListener('pointerleave', onPointerLeave);

  let elapsed = 0;
  let idleTimer = 0;

  /** Timeline de la onda en curso, para poder forzarla al saltar. */
  let waveTimeline: gsap.core.Timeline | null = null;

  const rebuildTokens = (): void => {
    if (gameState === null) return;

    const placements = data.territories.territories.flatMap((territory) => {
      const state = gameState?.territories[territory.id];
      const anchor = anchors.get(territory.id);
      if (state === undefined || anchor === undefined) return [];
      const owner = state.owner;
      const player = owner === null ? undefined : gameState?.players.find((p) => p.id === owner);
      return [
        {
          territory: territory.id,
          x: anchor.x,
          z: anchor.z,
          armies: state.armies,
          color: player === undefined ? LABEL_NEUTRAL_COLOR : playerColor(player.color),
        },
      ];
    });

    squads.update(placements);

    const labels = placements.flatMap((placement) => {
      const info = squads.layoutOf(placement.territory);
      if (info === undefined) return [];
      return [
        {
          text: String(placement.armies),
          x: placement.x,
          z: placement.z + info.radius + 6,
          y: board.relief + 1.2,
          color: placement.color,
        },
      ];
    });

    numbers.update(labels);
    options.renderer.requestRender();
  };

  return {
    data,
    board,
    rig,
    group,

    setGameState(state: MockGameState): void {
      gameState = state;

      // Se reescriben los colores por dueno en la malla fusionada.
      const colorAttribute = board.map.getAttribute('color');
      board.territoryIds.forEach((id, index) => {
        const owner = state.territories[id]?.owner ?? null;
        const player = owner === null ? undefined : state.players.find((p) => p.id === owner);
        const color = player === undefined ? NEUTRAL_COLOR : playerColor(player.color);
        const from = vertexRanges[index * 2] ?? 0;
        const to = vertexRanges[index * 2 + 1] ?? 0;
        for (let vertex = from; vertex < to; vertex += 1) {
          colorAttribute.setXYZ(vertex, color.r, color.g, color.b);
        }
      });
      colorAttribute.needsUpdate = true;

      rebuildTokens();
      options.renderer.requestRender();
    },

    selected(): TerritoryId | null {
      return selectedTerritory;
    },

    hovered(): TerritoryId | null {
      return hoveredTerritory;
    },

    onSelect(callback: (territory: TerritoryId | null) => void): void {
      selectListeners.add(callback);
    },

    focusTerritory(territory: TerritoryId, focusOptions?: FocusOptions): void {
      const anchor = anchors.get(territory);
      if (anchor === undefined) return;
      options.renderer.setContinuous(true);
      const timeline = rig.focusOn(anchor.x, anchor.z, focusOptions);
      timeline.eventCallback('onComplete', () => options.renderer.setContinuous(false));
    },

    focusPoint(x: number, z: number, focusOptions?: FocusOptions): void {
      if (focusOptions?.instant !== true) options.renderer.setContinuous(true);
      const timeline = rig.focusOn(x, z, focusOptions);
      timeline.eventCallback('onComplete', () => {
        if (focusOptions?.instant !== true) options.renderer.setContinuous(false);
      });
    },

    setDim(value: number): void {
      territoryMaterial.setDim(value);
      squads.setDim(value);
      numbers.setOpacity(Math.max(0, value - 0.15));
      borderMaterial.opacity = 0.32 * value;
      seaRouteMaterial.opacity = 0.55 * value;
      options.renderer.requestRender();
    },

    visibleUnits(): number {
      return squads.visibleUnits();
    },

    territoryIndex(territory: TerritoryId): number | undefined {
      const index = board.territoryIds.indexOf(territory);
      return index < 0 ? undefined : index;
    },

    coverRadiusFrom(territory: TerritoryId, x: number, z: number): number | undefined {
      const geometry = data.byId.get(territory);
      if (geometry === undefined) return undefined;
      // La bbox viene en longitud desenrollada, igual que la que usa la
      // geometria del tablero: proyectar las cuatro esquinas alcanza.
      const [minLon, minLat, maxLon, maxLat] = geometry.bbox;
      const corners: readonly (readonly [number, number])[] = [
        [minLon, minLat],
        [maxLon, minLat],
        [minLon, maxLat],
        [maxLon, maxLat],
      ];
      let radius = 0;
      for (const [lon, lat] of corners) {
        const corner = board.projection.toWorld(lon, lat);
        radius = Math.max(radius, Math.hypot(corner.x - x, corner.z - z));
      }
      // Piso para islas chicas: la onda tiene que verse aunque el territorio
      // sea pequenio. Sobrepasar el radio no tine nada fuera del territorio.
      return Math.max(radius, 40) + 30;
    },

    playOwnershipWave(waveOptions): gsap.core.Timeline {
      waveTimeline?.kill();
      territoryMaterial.startWave({
        territory: waveOptions.territoryIndex,
        originX: waveOptions.originX,
        originZ: waveOptions.originZ,
        color: waveOptions.color,
      });

      const state = { radius: 0 };
      const timeline = gsap.timeline({
        onComplete: () => {
          territoryMaterial.clearWave();
          waveTimeline = null;
          options.renderer.setContinuous(false);
        },
      });
      timeline.to(state, {
        radius: Math.max(1, waveOptions.radius),
        duration: Math.max(0.05, waveOptions.duration),
        ease: 'power2.out',
        onUpdate: () => {
          territoryMaterial.setWaveRadius(state.radius);
          options.renderer.requestRender();
        },
      });
      options.renderer.setContinuous(true);
      waveTimeline = timeline;
      return timeline;
    },

    finishOwnershipWave(): void {
      if (waveTimeline === null) return;
      waveTimeline.progress(1);
      territoryMaterial.clearWave();
      waveTimeline = null;
    },

    update(deltaSeconds: number): void {
      elapsed += deltaSeconds;
      squads.setTime(elapsed);
      rig.update(deltaSeconds);

      const distance = camera.position.distanceTo(rig.controls.target);
      numbers.setZoomScale(Math.max(0.35, Math.min(2.4, distance / LABEL_REFERENCE_DISTANCE)));

      // Movimiento en reposo sin gastar bateria: se pide un frame cada 80 ms en
      // lugar de renderizar continuo.
      idleTimer += deltaSeconds;
      if (idleTimer >= 0.08) {
        idleTimer = 0;
        options.renderer.requestRender();
      }
    },

    dispose(): void {
      options.canvas.removeEventListener('pointermove', onPointerMove);
      options.canvas.removeEventListener('pointerdown', onPointerDown);
      options.canvas.removeEventListener('pointerup', onPointerUp);
      options.canvas.removeEventListener('pointerleave', onPointerLeave);
      selectListeners.clear();
      squads.dispose();
      numbers.dispose();
      highlightMaterial.dispose();
      territoryMaterial.dispose();
      oceanMaterial.dispose();
      borderMaterial.dispose();
      seaRouteMaterial.dispose();
      board.map.dispose();
      board.borders.dispose();
      board.ocean.dispose();
      board.seaRoutes.dispose();
      rig.dispose();
    },
  };
}
