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
  BufferAttribute,
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
import type { RulesConfig } from '@conqueror/shared';
import { estimateBattleOdds } from '@conqueror/rules';
import type { PlayerColorId } from '@conqueror/shared';
import {
  BORDER_COLOR,
  HOVER_COLOR,
  LABEL_COLOR,
  LABEL_EMPHASIS_COLOR,
  LABEL_NEUTRAL_COLOR,
  NEUTRAL_COLOR,
  OCEAN_COLOR,
  SEA_ROUTE_COLOR,
  SELECT_COLOR,
  TARGET_COLOR,
  playerColor,
} from '../../app/palette.js';
import { getLocale } from '../../app/i18n.js';
import type { RendererHandle } from '../../render/renderer.js';
import { createHighlightMaterial, createTerritoryMaterial } from '../../render/mapMaterials.js';
import { createAttackArrow } from '../../render/combat/heat/attackArrow.js';
import { NumberLayer } from '../../render/tokens/NumberLayer.js';
import { SquadLayer } from '../../render/tokens/SquadLayer.js';
import { TerritoryLabelLayer } from '../../render/tokens/TerritoryLabelLayer.js';
import { createUnitModels, type UnitModels } from '../../render/tokens/models/unitModels.js';
import { buildBoard, territoryAnchors, type BoardBuild } from '../../map/boardGeometry.js';
import {
  createCameraRig,
  boardFitDistance,
  type CameraRig,
  type FocusOptions,
} from '../../map/cameraRig.js';
import { loadMapData, type LoadedMapData } from '../../map/loadMapData.js';
import { TerritoryPicker } from '../../map/picking.js';

/** Distancia de referencia para el tamaño en pantalla de los numeros. */
const LABEL_REFERENCE_DISTANCE = 620;

/** Alto en unidades de mundo de un nombre; el ancho es 4x (celda del atlas). */
const LABEL_WORLD_HEIGHT = 13;
const LABEL_WORLD_WIDTH = LABEL_WORLD_HEIGHT * 4;

/** Distancia a la que el zoom de los nombres compensa exactamente la camara. */
const LABEL_ZOOM_DISTANCE = 620;

/** Inclinacion de la vista general, en grados respecto del cenit. */
const POLAR_INICIAL = 42;

/**
 * Vista de tablero: lo que la escena necesita saber de la partida.
 *
 * La cumplen tanto los datos de prueba (`app/fixtures.ts`) como la vista
 * publica del motor (`PublicGameState` de `@conqueror/rules`): la escena
 * dibuja, no conoce las reglas.
 */
export interface BoardPlayerView {
  readonly id: string;
  readonly name: string;
  readonly color: PlayerColorId;
}

export interface BoardView {
  readonly players: readonly BoardPlayerView[];
  readonly activePlayer: string;
  readonly territories: Readonly<
    Record<TerritoryId, { readonly owner: string | null; readonly armies: number }>
  >;
}

export interface GameSceneOptions {
  readonly renderer: RendererHandle;
  readonly canvas: HTMLCanvasElement;
  readonly reducedMotion: boolean;
  /** Tope de unidades por ficha en el mapa. */
  readonly mapMaxUnits: number;
  /** Configuracion de reglas: la usa la probabilidad de conquista estimada. */
  readonly rules: RulesConfig;
  /** Avisos por consola de la carga de modelos. */
  readonly debug?: boolean;
  /**
   * Modelos ya creados por quien llama. El sandbox los comparte entre el mapa y
   * la batalla para no pedirlos dos veces; si falta, la escena crea los suyos.
   */
  readonly models?: UnitModels;
}

/** Objetivo de ataque posible bajo el cursor, con su probabilidad estimada. */
export interface AttackOddsInfo {
  readonly from: TerritoryId;
  readonly to: TerritoryId;
  /** Probabilidad de conquista, entre 0 y 1. */
  readonly probability: number;
}

/** Seleccion vigente: origen de la accion y destino elegido (si lo hay). */
export interface SelectionView {
  readonly origin: TerritoryId | null;
  readonly target: TerritoryId | null;
}

const SIN_SELECCION: SelectionView = { origin: null, target: null };

export interface GameScene {
  readonly data: LoadedMapData;
  readonly board: BoardBuild;
  readonly rig: CameraRig;
  readonly group: Group;
  /**
   * Modelos finales de las unidades. La carga se pide en diferido, despues de
   * armar el tablero, y no bloquea nada: mientras llegan (o si fallan) las
   * fichas siguen con las primitivas (ADR 0012).
   */
  readonly models: UnitModels;
  setGameState(state: BoardView): void;
  /** Territorio elegido como origen de la accion en curso. */
  selected(): TerritoryId | null;
  /** Destino elegido (enemigo al que atacar o territorio de reagrupe). */
  target(): TerritoryId | null;
  hovered(): TerritoryId | null;
  /**
   * Pinta la seleccion. La escena NO decide que se selecciona: el origen y el
   * destino los resuelve la aplicacion con el estado del motor
   * (`scenes/game/selectionModel.ts`). Aca solo se dibujan.
   */
  setSelection(selection: SelectionView): void;
  /**
   * Se llama con cada clic sobre el tablero: el territorio tocado, o `null` si
   * el puntero no llego al mapa (mar, fuera del tablero).
   */
  onPick(callback: (territory: TerritoryId | null) => void): void;
  /** Se llama cuando cambia el territorio bajo el puntero. */
  onHover(callback: (territory: TerritoryId | null) => void): void;
  /** Rehace los nombres impresos en el mapa (cambio de idioma). */
  refreshLabels(): void;
  /**
   * Posicion en pixeles de pantalla (coordenadas de cliente) del centro de un
   * territorio. La usan las pruebas end-to-end para hacer clic sobre el mapa
   * sin adivinar coordenadas.
   */
  screenPosition(territory: TerritoryId): { readonly x: number; readonly y: number } | null;
  /**
   * Se llama cuando cambia el destino de ataque posible bajo el cursor (o
   * `null` cuando no hay ninguno): destino enemigo vecino del territorio
   * propio seleccionado. Lleva la probabilidad estimada de conquista, para que
   * el HUD la muestre junto con el detalle del territorio.
   */
  onAttackOdds(callback: (info: AttackOddsInfo | null) => void): void;
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
  /**
   * Frente caliente: escribe el calor por territorio (0..1) en el atributo
   * `aHeat`. Los territorios que faltan en el mapa quedan en cero. Los valores
   * los deriva la aplicacion del log de eventos (heat/heatModel.ts).
   */
  setHeat(values: ReadonlyMap<TerritoryId, number>): void;
  /** Calor actual de un territorio, para el overlay de depuracion. */
  heatOf(territory: TerritoryId): number;
  update(deltaSeconds: number): void;
  dispose(): void;
}

export async function createGameScene(options: GameSceneOptions): Promise<GameScene> {
  const data = await loadMapData();

  let gameState: BoardView | null = null;

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

  // Frente caliente: atributo por vertice, 0..1 por territorio. Lo escribe
  // `setHeat` con los valores que la aplicacion deriva del log de eventos
  // (render/combat/heat/heatModel.ts). El shader lo usa para oscurecer, echar
  // humo y prender brasas en los bordes.
  const heatAttribute = new BufferAttribute(
    new Float32Array(board.map.getAttribute('position')?.count ?? 0),
    1,
  );
  board.map.setAttribute('aHeat', heatAttribute);

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

  const highlightMaterial = createHighlightMaterial({
    hover: HOVER_COLOR,
    selected: SELECT_COLOR,
    target: TARGET_COLOR,
  });
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

  // Modelos finales: se piden en diferido y, cuando llegan, reemplazan a las
  // primitivas de las fichas del mapa. Un tipo que falle se queda como estaba.
  const ownsModels = options.models === undefined;
  const models =
    options.models ??
    createUnitModels({
      renderer: options.renderer.renderer,
      ...(options.debug === undefined ? {} : { debug: options.debug }),
    });
  models.subscribe((estado) => squads.setGeometries(estado.models));

  const numbers = new NumberLayer();
  numbers.group.renderOrder = 5;

  /**
   * Nombres de los territorios impresos sobre el mapa. El atlas se hornea con
   * el idioma activo, asi que al cambiar de idioma hay que rehacer la capa
   * entera (`refreshLabels`).
   */
  function crearEtiquetas(): TerritoryLabelLayer {
    const layer = new TerritoryLabelLayer(
      data.territories.territories.map((territory) => ({
        territory: territory.id,
        text: territory.names[getLocale()],
      })),
      {
        baseColor: LABEL_COLOR,
        emphasisColor: LABEL_EMPHASIS_COLOR,
        worldHeight: LABEL_WORLD_HEIGHT,
      },
    );
    layer.group.renderOrder = 6;
    return layer;
  }
  let labels = crearEtiquetas();
  // Flecha de avance (mapa vivo): aparece al apuntar un vecino enemigo con un
  // territorio propio seleccionado. Con movimiento reducido se muestra quieta.
  const attackArrow = createAttackArrow({
    renderer: options.renderer,
    reducedMotion: options.reducedMotion,
  });

  group.add(
    ocean,
    mapMesh,
    highlightMesh,
    borders,
    seaRoutes,
    squads.group,
    numbers.group,
    labels.group,
    attackArrow.group,
  );

  const camera = options.renderer.camera;

  /** Distancia a la que entra el tablero completo con el lienzo actual. */
  const distanciaEncaje = (): number => {
    const ancho = options.canvas.clientWidth || window.innerWidth || 1440;
    const alto = options.canvas.clientHeight || window.innerHeight || 900;
    return boardFitDistance({
      boardWidth: board.projection.width,
      boardHeight: board.projection.height,
      fovDeg: (camera as PerspectiveCamera).fov,
      aspect: ancho / Math.max(1, alto),
      polarDeg: POLAR_INICIAL,
    });
  };

  const distanciaInicial = distanciaEncaje();
  const rig = createCameraRig({
    camera,
    domElement: options.canvas,
    boardWidth: board.projection.width,
    boardHeight: board.projection.height,
    minDistance: 90,
    // El tope tiene que dejar alejarse hasta el encaje: en un telefono el
    // tablero entero solo entra desde bastante mas lejos que en un monitor.
    maxDistance: Math.max(1400, distanciaInicial * 1.25),
  });

  // Pose inicial: el mundo entero a la vista, con una inclinacion que da
  // profundidad sin deformar demasiado el tablero.
  rig.focusOn(0, 0, { distance: distanciaInicial, polarDeg: POLAR_INICIAL, instant: true });
  rig.controls.target.set(0, 0, 0);
  rig.controls.update();

  /**
   * Al rotar el telefono o cambiar el tamaño de la ventana, el encaje cambia.
   * Se reencuadra solo si la camara seguia en la vista general: si el jugador
   * ya se habia acercado a mirar algo, no se le mueve la vista.
   */
  let distanciaGeneral = distanciaInicial;
  const alRedimensionar = (): void => {
    const actual = camera.position.distanceTo(rig.controls.target);
    if (Math.abs(actual - distanciaGeneral) > distanciaGeneral * 0.08) return;
    distanciaGeneral = distanciaEncaje();
    rig.focusOn(0, 0, { distance: distanciaGeneral, polarDeg: POLAR_INICIAL, instant: true });
    options.renderer.requestRender();
  };
  window.addEventListener('resize', alRedimensionar);

  const picker = new TerritoryPicker(board.faceTerritory, board.territoryIds);
  const raycaster = new Raycaster();
  const pointer = new Vector2();

  let hoveredTerritory: TerritoryId | null = null;
  let selection: SelectionView = SIN_SELECCION;
  const pickListeners = new Set<(territory: TerritoryId | null) => void>();
  const hoverListeners = new Set<(territory: TerritoryId | null) => void>();
  const oddsListeners = new Set<(info: AttackOddsInfo | null) => void>();
  /** Ultima informacion de ataque publicada, para no repetir el aviso. */
  let lastOddsKey = '';
  /** Par origen-destino de la flecha dibujada, para no re-animarla sin motivo. */
  let lastArrowKey = '';

  /**
   * Los nombres se achican en pantallas angostas: 22 px de texto en un telefono
   * ocupan media provincia y tapan justamente lo que se quiere ver.
   */
  const escalaEtiquetas = (): number => {
    const ancho = options.canvas.clientWidth || window.innerWidth || 1440;
    return Math.max(0.6, Math.min(1, ancho / 1000));
  };

  /**
   * Tamaño en pantalla de una etiqueta. El zoom de la capa compensa la
   * distancia (`uZoom = distancia / referencia`), asi que el resultado es
   * constante: se calcula con la referencia y sirve para cualquier zoom.
   */
  const tamanoEtiquetaPx = (): { w: number; h: number } => {
    const alto = options.canvas.clientHeight || 900;
    const fov = ((camera as PerspectiveCamera).fov * Math.PI) / 180;
    const pxPorUnidad = alto / (2 * Math.tan(fov / 2) * LABEL_ZOOM_DISTANCE);
    const escala = escalaEtiquetas();
    return {
      w: LABEL_WORLD_WIDTH * pxPorUnidad * escala,
      h: LABEL_WORLD_HEIGHT * pxPorUnidad * escala,
    };
  };

  const proyeccion = new Vector3();

  /** Caja de la etiqueta en pixeles de pantalla, o `null` si no se ve. */
  const rectEnPantalla = (
    label: { readonly x: number; readonly y: number; readonly z: number },
    anchoPx: number,
    altoPx: number,
  ): { left: number; top: number; right: number; bottom: number } | null => {
    const ancho = options.canvas.clientWidth;
    const alto = options.canvas.clientHeight;
    if (ancho === 0 || alto === 0) return null;

    proyeccion.set(label.x, label.y, label.z).project(camera as PerspectiveCamera);
    // `z > 1` es detras de la camara (o mas alla del plano lejano).
    if (proyeccion.z > 1) return null;

    const cx = (proyeccion.x * 0.5 + 0.5) * ancho;
    const cy = (-proyeccion.y * 0.5 + 0.5) * alto;
    if (cx < -anchoPx || cx > ancho + anchoPx || cy < -altoPx || cy > alto + altoPx) return null;

    return {
      left: cx - anchoPx / 2,
      top: cy - altoPx / 2,
      right: cx + anchoPx / 2,
      bottom: cy + altoPx / 2,
    };
  };

  const solapan = (
    a: { left: number; top: number; right: number; bottom: number },
    b: { left: number; top: number; right: number; bottom: number },
  ): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  /** Escribe los nombres con el enfasis del territorio que corresponde. */
  const actualizarEtiquetas = (): void => {
    const locale = getLocale();
    const destacada = (territory: TerritoryId): number =>
      territory === selection.target
        ? 1
        : territory === selection.origin
          ? 0.9
          : territory === hoveredTerritory
            ? 0.7
            : 0;

    const candidatas = data.territories.territories.flatMap((territory) => {
      const anchor = anchors.get(territory.id);
      if (anchor === undefined) return [];
      return [
        {
          territory: territory.id,
          text: territory.names[locale],
          x: anchor.x,
          // Un poco al norte del ancla: las fichas y los numeros de ejercitos
          // se dibujan hacia el sur y no se pisan con el nombre.
          z: anchor.z - 12,
          y: board.relief + 1.6,
          emphasis: destacada(territory.id),
          area: territory.areaKm2,
        },
      ];
    });

    // Orden de prioridad: primero lo resaltado, despues los territorios mas
    // grandes (los chicos son los que se amontonan en Europa y el Caribe).
    candidatas.sort((a, b) => b.emphasis - a.emphasis || b.area - a.area);

    const { w: anchoPx, h: altoPx } = tamanoEtiquetaPx();
    const ocupados: { left: number; top: number; right: number; bottom: number }[] = [];
    const visibles: typeof candidatas = [];

    for (const candidata of candidatas) {
      const rect = rectEnPantalla(candidata, anchoPx, altoPx);
      // Fuera de cuadro o detras de la camara: no se dibuja.
      if (rect === null) continue;
      // Un nombre resaltado siempre se dibuja: es el que el jugador esta
      // mirando, aunque tape a otro.
      if (candidata.emphasis < 0.5 && ocupados.some((otro) => solapan(otro, rect))) continue;
      // Se reserva un poco mas de lo que ocupa el texto: dos nombres pegados
      // sin aire tambien se leen mal.
      ocupados.push({
        left: rect.left - 4,
        top: rect.top - 2,
        right: rect.right + 4,
        bottom: rect.bottom + 2,
      });
      visibles.push(candidata);
    }

    labels.update(visibles);
  };

  const refreshHighlight = (): void => {
    highlightMaterial.setHover(picker.indexOf(hoveredTerritory ?? ''));
    highlightMaterial.setSelected(picker.indexOf(selection.origin ?? ''));
    highlightMaterial.setTarget(picker.indexOf(selection.target ?? ''));
    actualizarEtiquetas();
    refreshAttackArrow();
    options.renderer.requestRender();
  };

  /** Escala de la flecha segun lo lejos que este la camara del tablero. */
  const escalaFlecha = (): number => {
    const distancia = camera.position.distanceTo(rig.controls.target);
    return Math.max(1, distancia / 340);
  };

  /**
   * Flecha de avance y probabilidad estimada.
   *
   * Se dibuja cuando hay un territorio propio elegido como origen y un segundo
   * territorio que es objetivo valido: el DESTINO elegido si lo hay, y si no el
   * que esta bajo el puntero. Asi la linea queda fija mientras se decide (no
   * desaparece al mover el mouse) y el jugador ve exactamente lo que va a
   * pasar si hace clic.
   *
   * El objetivo puede ser de otro jugador O NEUTRAL: el motor permite atacar
   * territorios sin dueno, y excluirlos dejaba la flecha sin dibujar sobre
   * objetivos perfectamente legales.
   */
  const refreshAttackArrow = (): void => {
    const from = selection.origin;
    const to = selection.target ?? hoveredTerritory;
    const state = gameState;

    const publish = (info: AttackOddsInfo | null): void => {
      const key = info === null ? '' : `${info.from}|${info.to}|${info.probability}`;
      if (key === lastOddsKey) return;
      lastOddsKey = key;
      for (const listener of oddsListeners) listener(info);
    };

    const hide = (): void => {
      lastArrowKey = '';
      attackArrow.hide();
      publish(null);
    };

    if (state === null || from === null || to === null || from === to) {
      hide();
      return;
    }

    const fromState = state.territories[from];
    const toState = state.territories[to];
    const neighbors = data.adjacency.byTerritory[from] ?? [];
    const canAttack =
      fromState !== undefined &&
      toState !== undefined &&
      fromState.owner === state.activePlayer &&
      fromState.armies > options.rules.combat.minArmiesPerTerritory &&
      toState.owner !== state.activePlayer &&
      neighbors.includes(to);

    const activePlayer = state.players.find((player) => player.id === state.activePlayer);
    const anchorFrom = anchors.get(from);
    const anchorTo = anchors.get(to);

    if (
      !canAttack ||
      activePlayer === undefined ||
      anchorFrom === undefined ||
      anchorTo === undefined
    ) {
      hide();
      return;
    }

    const odds = estimateBattleOdds(fromState.armies, toState.armies, options.rules);
    // Solo se re-anima cuando cambia el par: si no, cada sincronizacion del
    // estado volveria a hacer rebotar la flecha que ya estaba quieta.
    const arrowKey = `${from}|${to}|${activePlayer.color}`;
    if (arrowKey !== lastArrowKey) {
      lastArrowKey = arrowKey;
      attackArrow.show({
        fromX: anchorFrom.x,
        fromZ: anchorFrom.z,
        toX: anchorTo.x,
        toZ: anchorTo.z,
        baseY: board.relief,
        color: playerColor(activePlayer.color),
        // La camara del mapa estrategico esta lejos: la flecha se agranda con
        // la distancia para conservar el grosor en pantalla.
        scale: escalaFlecha(),
      });
    }
    publish({ from, to, probability: odds.winProbability });
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
      for (const listener of hoverListeners) listener(next);
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
    // La escena no decide: avisa que territorio se toco y la aplicacion
    // resuelve la intencion contra el estado del motor.
    for (const listener of pickListeners) listener(next);
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
  /** Respiro para no recalcular el descarte de nombres en cada frame. */
  let relojCamara = 0;
  let ultimaClaveCamara = '';

  /** Timeline de la onda en curso, para poder forzarla al saltar. */
  let waveTimeline: gsap.core.Timeline | null = null;

  /** Ultimo calor conocido por territorio (para `heatOf` y la depuracion). */
  let heatValues = new Map<TerritoryId, number>();

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

  // Recien ahora, con el tablero armado, se piden los modelos. No se espera la
  // respuesta: el mapa ya es jugable con las primitivas (ADR 0012).
  void models.load();

  // Primer juego de nombres: sin esto la capa quedaria con cero instancias
  // hasta el primer hover, porque el estado inicial no tiene seleccion y
  // `refreshHighlight` no se dispara.
  actualizarEtiquetas();
  options.renderer.requestRender();

  return {
    data,
    board,
    rig,
    group,

    setGameState(state: BoardView): void {
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
      // Un cambio de dueno puede invalidar el ataque en curso (el origen se
      // quedo sin ejercitos, el destino dejo de ser enemigo): la flecha se
      // recalcula con el estado nuevo.
      refreshAttackArrow();
      options.renderer.requestRender();
    },

    selected(): TerritoryId | null {
      return selection.origin;
    },

    target(): TerritoryId | null {
      return selection.target;
    },

    hovered(): TerritoryId | null {
      return hoveredTerritory;
    },

    setSelection(next: SelectionView): void {
      if (next.origin === selection.origin && next.target === selection.target) return;
      selection = { origin: next.origin, target: next.target };
      refreshHighlight();
    },

    onPick(callback: (territory: TerritoryId | null) => void): void {
      pickListeners.add(callback);
    },

    onHover(callback: (territory: TerritoryId | null) => void): void {
      hoverListeners.add(callback);
    },

    refreshLabels(): void {
      // El texto esta horneado en el atlas: se rehace la capa completa.
      labels.dispose();
      labels.group.removeFromParent();
      labels = crearEtiquetas();
      group.add(labels.group);
      actualizarEtiquetas();
      options.renderer.requestRender();
    },

    screenPosition(territory: TerritoryId): { x: number; y: number } | null {
      const anchor = anchors.get(territory);
      if (anchor === undefined) return null;
      proyeccion.set(anchor.x, board.relief, anchor.z).project(camera as PerspectiveCamera);
      if (proyeccion.z > 1) return null;
      const rect = options.canvas.getBoundingClientRect();
      return {
        x: rect.left + (proyeccion.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-proyeccion.y * 0.5 + 0.5) * rect.height,
      };
    },

    onAttackOdds(callback: (info: AttackOddsInfo | null) => void): void {
      oddsListeners.add(callback);
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

    models,

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

    setHeat(values: ReadonlyMap<TerritoryId, number>): void {
      heatValues = new Map(values);
      // Los rangos de vertices por territorio ya estan calculados para los
      // colores: el calor se escribe con el mismo recorrido. Los territorios
      // que no estan en el mapa de valores vuelven a cero (el calor decae).
      board.territoryIds.forEach((id, index) => {
        const value = Math.min(1, Math.max(0, values.get(id) ?? 0));
        const from = vertexRanges[index * 2] ?? 0;
        const to = vertexRanges[index * 2 + 1] ?? 0;
        for (let vertex = from; vertex < to; vertex += 1) {
          heatAttribute.setX(vertex, value);
        }
      });
      heatAttribute.needsUpdate = true;
      options.renderer.requestRender();
    },

    heatOf(territory: TerritoryId): number {
      return heatValues.get(territory) ?? 0;
    },

    update(deltaSeconds: number): void {
      elapsed += deltaSeconds;
      squads.setTime(elapsed);
      rig.update(deltaSeconds);
      // El pulso de las brasas del frente caliente corre con el mismo reloj.
      territoryMaterial.setTime(elapsed);
      // ...y el de la seleccion activa, para que el origen y el destino se
      // distingan de un resaltado cualquiera.
      highlightMaterial.setTime(elapsed);

      const distance = camera.position.distanceTo(rig.controls.target);
      numbers.setZoomScale(Math.max(0.35, Math.min(2.4, distance / LABEL_REFERENCE_DISTANCE)));
      // La flecha se mantiene visible mientras se aleja o acerca la camara.
      attackArrow.setScale(escalaFlecha());

      // Nombres: se achican un poco al alejar y se desvanecen cuando entra todo
      // el tablero en cuadro. Con 50 territorios, mostrar todos los nombres a
      // distancia de mapa completo tapa el mapa en vez de ayudar; al acercarse
      // (que es cuando hace falta saber que pais es) aparecen enteros.
      // Nombres: tamaño constante en pantalla (el zoom compensa la distancia)
      // y sin fundido por distancia: la densidad la resuelve el descarte por
      // colision, que deja solo los que entran sin pisarse.
      labels.setZoomScale((distance / LABEL_ZOOM_DISTANCE) * escalaEtiquetas());
      labels.setOpacity(1);

      // Al mover o acercar la camara cambian los nombres que se pisan entre si,
      // asi que se rehace el descarte. Con un respiro de 150 ms: recalcularlo
      // en cada frame seria trabajo tirado.
      relojCamara += deltaSeconds;
      const claveCamara = `${camera.position.x.toFixed(0)}|${camera.position.y.toFixed(0)}|${camera.position.z.toFixed(0)}`;
      if (relojCamara >= 0.15 && claveCamara !== ultimaClaveCamara) {
        relojCamara = 0;
        ultimaClaveCamara = claveCamara;
        actualizarEtiquetas();
      }

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
      window.removeEventListener('resize', alRedimensionar);
      pickListeners.clear();
      hoverListeners.clear();
      oddsListeners.clear();
      attackArrow.dispose();
      squads.dispose();
      // Los modelos inyectados los libera quien los creo.
      if (ownsModels) models.dispose();
      numbers.dispose();
      labels.dispose();
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
