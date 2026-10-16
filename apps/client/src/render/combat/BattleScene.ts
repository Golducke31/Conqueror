/**
 * Escena de batalla.
 *
 * Abre un campo de batalla SOBRE EL FRENTE entre dos territorios, no en sus
 * centroides: las escuadras salen de cada territorio, marchan hasta la linea y
 * quedan enfrentadas. El resto del mapa se atenua.
 *
 * En C2 la ronda completa se coreografía aquí: los dados se animan hasta la cara
 * que mandó el motor, los duelos se escalonan por tipo de unidad, las bajas caen
 * en la primera fila y al cerrar las escuadras se reacomodan. La continuidad entre
 * rondas la mantiene la propia escena: recuerda qué unidades siguen vivas y las
 * siguientes rondas las vuelven a desplegar ya mermadas.
 *
 * C3 agrega:
 *   - La CONQUISTA (playConquest): la escuadra atacante avanza al territorio
 *     conquistado, se planta el estandarte y la onda de cambio de dueño barre
 *     el territorio desde el frente (la onda vive en el material del tablero,
 *     ver mapMaterials.ts). Al final las escuadras se funden.
 *   - La MARCHA posterior (playMarch): los ejercitos que el jugador decide
 *     mover caminan del territorio de origen al conquistado. La dispara la
 *     aplicacion, no la cola de eventos.
 *   - El CRUCE MARITIMO (en open()): si el frente es un seaLink, los navios
 *     navegan de costa a costa, hay una andanada visual (sin bajas: las decide
 *     el motor en la ronda que sigue) y las tropas desembarcan.
 *
 * NADA de esto decide resultados: el `BattleRoundResolved` ya viene resuelto por
 * el motor y `planRound`/`planConquest`/`planSeaCrossing` (puros) lo traducen a
 * planes de tiempos. Ver docs/adr/0006-combate-visual-no-decide.md
 *
 * C5 agrega las SENALES DE AUDIO: si se le pasa un receptor (`AudioSink`, ver
 * audio/audioManager.ts), la coreografia emite un `cue` en el mismo instante en
 * que ocurre cada evento visual —dados, duelos por tipo, marchas, desembarco,
 * estandarte, conquista—. El sonido es consecuencia del mismo evento que mueve
 * las fichas, nunca al reves. Sin receptor, la escena es muda y no pasa nada
 * (ver ADR 0011).
 */

import gsap from 'gsap';
import type { Color } from 'three';
import { Color as ThreeColor, Group, Vector3 } from 'three';

import { composeSquad, type BattleRoundResolved, type UnitType } from '@conqueror/rules';
import type { FrontAnchor } from '@conqueror/map-data';
import type { TerritoryId } from '@conqueror/shared';
import type { RendererHandle } from '../renderer.js';
import type { GameScene } from '../../scenes/game/GameScene.js';
import { UNIT_ORDER, UnitBatch, type UnitInstance } from '../tokens/UnitBatch.js';
import { SPECTACLE_PROFILES, type SpectacleProfile } from './spectacle.js';
import { planConquest, type ConquestPlan } from './choreography/conquest.js';
import { planSeaCrossing, type SeaCrossingPlan } from './choreography/sea.js';
import { planRound, type DuelAction, type RoundPlan } from './choreography/round.js';
import { DiceLayer, type DiePlacement } from './dice/DiceLayer.js';
import { ParticlePool, type ParticleBurst } from './fx/ParticlePool.js';
import { createBannerLayer } from './BannerLayer.js';
import { ShipLayer } from './units/ShipLayer.js';
import { createQualityController } from './choreography/quality.js';
import type { AudioSink } from './audio/audioManager.js';

/** Separacion entre la linea de frente y cada escuadra. */
const LINE_GAP = 30;

/** Separacion entre unidades dentro de la formacion. */
const RANK_SPACING = 7.6;

/** Cuanto avanza el duelista que actua hacia el enemigo. */
const LUNGE_DISTANCE = 6;

/** Tamaño de los dados en el campo (la malla es un plano 1x1). */
const DICE_SCALE = 13;

/** Altura a la que flotan los dados sobre el suelo. */
const DICE_LIFT = 0.9;

/** Sonido de la accion de cada tipo de duelo, al arrancar el enfrentamiento. */
const SONIDO_ACCION: Readonly<Record<DuelAction, string>> = {
  volley: 'infantry.volley',
  charge: 'cavalry.charge',
  cannon: 'cannon.fire',
};

/**
 * Sonido del impacto (y de la baja, en el caso de la infanteria: ahi no hay
 * choque, la salva ya se oyo al arrancar el duelo).
 */
const SONIDO_IMPACTO: Readonly<Record<DuelAction, string>> = {
  volley: 'infantry.death',
  charge: 'cavalry.impact',
  cannon: 'cannon.impact',
};

/** Distancia de la linea de navios a la costa defensora. */
const SHIP_STANDOFF = 26;

/** Escala de los navios respecto de la geometria. */
const SHIP_SCALE = 1.8;

/** Separacion entre navios en la linea. */
const SHIP_SPACING = 22;

/**
 * Tope de unidades marchando tras la conquista. Mas de cinco no se leen a
 * distancia de tablero (las fichas del mapa usan el mismo tope): el resto de
 * los ejercitos van en el estado, no en la animacion.
 */
const MARCH_MAX_UNITS = 5;

/** Escala de las unidades en marcha: por encima de las fichas del tablero
 *  (1.5) para que la marcha se lea como un evento y no como una ficha mas. */
const MARCH_SCALE = 2.8;

/** Separacion entre unidades en la formacion de marcha. */
const MARCH_SPACING = 9;

/** Cuanto de la marcha (0..1) tiene que pasar para soltar otra nube de polvo. */
const MARCH_PUFF_STEP = 0.18;

/** Indice de la unidad viva de un bando, en orden de formacion. */
interface RenderUnit {
  readonly type: UnitType;
  readonly color: Color;
  /** Punto de partida: el ancla del territorio, de donde sale la escuadra. */
  readonly start: Vector3;
  /** Destino: su slot en la formacion frente a frente. */
  readonly base: Vector3;
  readonly rotationY: number;
  readonly scale: number;
  /** 0 = de pie, 1 = caido (se inclina y hunde). */
  fallen: number;
  /** 0..1, embestida transitoria del que actua. */
  lunge: number;
  alive: boolean;
}

interface BattleSideInternal {
  readonly color: Color;
  readonly units: RenderUnit[];
  readonly center: Vector3;
  /** Vector unitario desde este bando hacia el enemigo. */
  readonly dir: Vector3;
}

export interface BattleSide {
  readonly color: Color;
  readonly armies: number;
  /** Ancla del territorio, de donde sale la escuadra. */
  readonly originX: number;
  readonly originZ: number;
}

export interface OpenBattleOptions {
  readonly front: FrontAnchor;
  readonly attacker: BattleSide;
  readonly defender: BattleSide;
  readonly profile: SpectacleProfile;
  /** Si es `true`, no anima el despliegue: deja todo en posicion final. */
  readonly instant: boolean;
}

/** Territorio conquistado, para la secuencia de conquista. */
export interface ConquestTarget {
  readonly territory: TerritoryId;
  /** Indice del territorio en la malla del tablero (`aTerritory`). */
  readonly territoryIndex: number;
  /** Color del dueno NUEVO (el atacante). */
  readonly color: Color;
  /** Ancla del territorio, donde se planta el estandarte. */
  readonly anchorX: number;
  readonly anchorZ: number;
  /** Radio que la onda de cambio de dueño tiene que cubrir. */
  readonly coverRadius: number;
}

export interface ConquestOptions {
  readonly target: ConquestTarget;
  /** Origen del barrido de la onda: el punto del frente. */
  readonly waveOriginX: number;
  readonly waveOriginZ: number;
  readonly profile: SpectacleProfile;
}

export interface MarchOptions {
  readonly fromX: number;
  readonly fromZ: number;
  readonly toX: number;
  readonly toZ: number;
  /** Ejercitos que marchan (se limitan a `MARCH_MAX_UNITS` visuales). */
  readonly count: number;
  readonly color: Color;
  readonly profile: SpectacleProfile;
  /** Se llama cuando la marcha terminó (o se forzó al saltar). */
  readonly onComplete: () => void;
}

export interface BattleSceneOptions {
  readonly renderer: RendererHandle;
  readonly scene: GameScene;
  /** Tope de unidades por bando en batalla. */
  readonly maxUnits: number;
  /**
   * Receptor de senales de audio (opcional). Si falta, la escena es muda y
   * el juego corre normal: el sonido nunca es requisito.
   */
  readonly audio?: AudioSink;
}

export interface BattleScene {
  readonly group: Group;
  open(options: OpenBattleOptions): gsap.core.Timeline;
  playRound(event: BattleRoundResolved, profile: SpectacleProfile): gsap.core.Timeline;
  /** Secuencia de conquista: avance, estandarte, onda, fundido. */
  playConquest(options: ConquestOptions): gsap.core.Timeline;
  /** Marcha de los ejercitos movidos tras la conquista. */
  playMarch(options: MarchOptions): gsap.core.Timeline;
  close(options?: { instant?: boolean; keepBanner?: boolean }): gsap.core.Timeline;
  isOpen(): boolean;
  setTime(seconds: number): void;
  tick(deltaSeconds: number): void;
  /**
   * Muestreo de FPS para la calidad adaptativa. Lo llama el director mientras
   * la batalla está abierta: si el promedio cae por debajo del umbral, se
   * reducen solas las partículas y las unidades visibles.
   */
  recordFrame(deltaSeconds: number): void;
  /**
   * Ajuste MANUAL de calidad (lo usa el sandbox para forzar la calidad
   * reducida). Suspende el ajuste automático hasta `setAdaptiveQuality(true)`.
   */
  setQuality(state: { readonly unitCap: number; readonly particleScale: number }): void;
  /** Reactiva el ajuste automático de calidad (activado por defecto). */
  setAdaptiveQuality(enabled: boolean): void;
  /** Estado de calidad efectivo, para el panel de depuración. */
  quality(): {
    readonly degraded: boolean;
    readonly unitCap: number;
    readonly particleScale: number;
  };
  visibleUnits(): number;
  visibleShips(): number;
  attackerRoster(): readonly UnitType[];
  defenderRoster(): readonly UnitType[];
  dispose(): void;
}

/** Reparte `count` posiciones en una formacion de filas mirando hacia `forward`. */
function formationPositions(
  count: number,
  center: Vector3,
  forward: Vector3,
  right: Vector3,
  spacing: number,
): Vector3[] {
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(count))));
  const positions: Vector3[] = [];

  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const inRow = Math.min(columns, count - row * columns);
    const lateral = (column - (inRow - 1) / 2) * spacing;
    const depth = row * spacing * 0.9;

    positions.push(
      new Vector3(
        center.x + right.x * lateral - forward.x * depth,
        center.y,
        center.z + right.z * lateral - forward.z * depth,
      ),
    );
  }

  return positions;
}

/** Diferencia angular mas corta entre dos rumbos, para no girar de mas. */
function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function createBattleScene(options: BattleSceneOptions): BattleScene {
  const group = new Group();
  const batch = new UnitBatch({ capacity: 64 });
  const dice = new DiceLayer();
  const particles = new ParticlePool(512);
  // El estandarte se apoya en el relieve, igual que las escuadras.
  const banner = createBannerLayer({ baseY: options.scene.board.relief + 0.5 });
  const ships = new ShipLayer({ capacity: 8 });
  group.add(batch.group, dice.group, particles.group, banner.group, ships.group);
  group.visible = false;

  let attackerSide: BattleSideInternal | null = null;
  let defenderSide: BattleSideInternal | null = null;
  let forward = new Vector3(1, 0, 0);
  let right = new Vector3(0, 0, 1);
  let baseY = 1;
  let deployProgress = 1;
  let open = false;
  /** Timeline de la marcha en curso, para forzarla al saltar. */
  let marchTl: gsap.core.Timeline | null = null;
  /** Estandarte plantado durante la secuencia de conquista. */
  let bannerPlanted = false;

  // --- Calidad adaptativa ---------------------------------------------------
  // El controlador muestrea los frames que le pasa el director. Un ajuste
  // manual (sandbox) tiene prioridad y suspende el automático.
  const qualityController = createQualityController({
    unitCap: options.maxUnits,
    particleScale: 1,
  });
  let qualityManual: { readonly unitCap: number; readonly particleScale: number } | null = null;
  let qualityAuto = true;

  /** Tope de unidades por bando efectivo. */
  const currentUnitCap = (): number =>
    qualityManual?.unitCap ?? qualityController.snapshot().unitCap;

  /** Multiplicador de partículas efectivo (1 = escala del perfil). */
  const currentParticleFactor = (): number =>
    qualityManual?.particleScale ?? qualityController.snapshot().particleScale;

  /** Tope de unidades en la marcha, escalado por la calidad. */
  const currentMarchCap = (): number => {
    const ratio = currentUnitCap() / Math.max(1, options.maxUnits);
    return Math.max(2, Math.min(MARCH_MAX_UNITS, Math.floor(MARCH_MAX_UNITS * ratio)));
  };

  const attackerDicePos: Vector3[] = [];
  const defenderDicePos: Vector3[] = [];

  /** Centro de un conjunto de posiciones (para el paneo de una senal). */
  const centroDe = (posiciones: readonly Vector3[]): Vector3 => {
    if (posiciones.length === 0) return new Vector3();
    let x = 0;
    let y = 0;
    let z = 0;
    for (const pos of posiciones) {
      x += pos.x;
      y += pos.y;
      z += pos.z;
    }
    return new Vector3(x / posiciones.length, y / posiciones.length, z / posiciones.length);
  };

  /** Recoloca las instancias interpolando marcha -> formacion y aplicando caidas. */
  const applyInstances = (): void => {
    if (attackerSide === null && defenderSide === null && marchTl === null) return;
    const instances: UnitInstance[] = [];
    // La calidad adaptativa puede ocultar las unidades de atras de la formacion:
    // se dibujan las primeras `cap` de cada bando, en orden de formacion.
    const cap = currentUnitCap();

    const build = (side: BattleSideInternal): void => {
      let shown = 0;
      for (const unit of side.units) {
        if (!unit.alive && unit.fallen < 0.001) continue;
        if (shown >= cap) break;
        shown += 1;
        const px =
          unit.start.x +
          (unit.base.x - unit.start.x) * deployProgress +
          side.dir.x * unit.lunge * LUNGE_DISTANCE;
        const pz =
          unit.start.z +
          (unit.base.z - unit.start.z) * deployProgress +
          side.dir.z * unit.lunge * LUNGE_DISTANCE;
        const py =
          unit.start.y + (unit.base.y - unit.start.y) * deployProgress + unit.fallen * 0.45;
        instances.push({
          type: unit.type,
          x: px,
          y: py,
          z: pz,
          rotationY: unit.rotationY,
          tilt: unit.fallen * (Math.PI * 0.5),
          scale: unit.scale,
          color: unit.color,
        });
      }
    };

    if (attackerSide !== null) build(attackerSide);
    if (defenderSide !== null) build(defenderSide);
    batch.setInstances(instances);
    options.renderer.requestRender();
  };

  /** Empaqueta las unidades vivas de un bando en el orden de formacion. */
  const sideRoster = (side: BattleSideInternal | null): UnitType[] =>
    side === null ? [] : side.units.filter((unit) => unit.alive).map((unit) => unit.type);

  /** Construye las unidades de un bando y las deja listas para el despliegue. */
  const buildSide = (
    side: BattleSide,
    center: Vector3,
    dir: Vector3,
    jitterSeed: number,
    /** Si se pasa, las unidades arrancan alrededor de este punto (desembarco). */
    startCenter?: Vector3,
  ): BattleSideInternal => {
    const composition = composeSquad(side.armies, { maxUnits: currentUnitCap() });
    if (composition.units.length === 0) {
      return { color: side.color, units: [], center, dir };
    }

    const ordered: UnitType[] = [];
    for (const type of UNIT_ORDER) {
      const unit = composition.units.find((candidate) => candidate.type === type);
      if (unit === undefined) continue;
      for (let index = 0; index < unit.count; index += 1) ordered.push(type);
    }

    const positions = formationPositions(ordered.length, center, dir, right, RANK_SPACING);
    const rotationY = Math.atan2(dir.x, dir.z);

    const units: RenderUnit[] = ordered.map((type, index) => {
      const end = positions[index] ?? center;
      // Sin zona de desembarco las unidades salen del ancla del territorio;
      // con ella, de la playa (con un poco mas de dispersion).
      const baseX = startCenter?.x ?? side.originX;
      const baseZ = startCenter?.z ?? side.originZ;
      const spread = startCenter !== undefined ? 9 : 7;
      const offsetX = (((index * 37 + jitterSeed) % 11) - 5) * (spread / 5);
      const offsetZ = (((index * 53 + jitterSeed) % 13) - 6) * (spread / 6);
      return {
        type,
        color: side.color,
        start: new Vector3(baseX + offsetX, baseY, baseZ + offsetZ),
        base: new Vector3(end.x, baseY, end.z),
        rotationY,
        scale: 1.7,
        fallen: 0,
        lunge: 0,
        alive: true,
      };
    });

    return { color: side.color, units, center, dir };
  };

  /** Dibuja los dados con las caras y el brillo que corresponden al plan. */
  const renderDice = (plan: RoundPlan, phase: 'roll' | 'land', rollT: number): void => {
    if (attackerSide === null || defenderSide === null) return;
    const highlight = new Set<string>();
    for (const duel of plan.duels) highlight.add(`${duel.actingSide}:${duel.pairIndex}`);

    // `update` reemplaza todo; armamos las dos filas y las enviamos juntas.
    const placements: DiePlacement[] = [];
    const collect = (
      slots: Vector3[],
      diceValues: readonly number[],
      owner: 'attacker' | 'defender',
      color: Color,
    ): void => {
      for (let index = 0; index < diceValues.length; index += 1) {
        const slot = slots[index];
        if (slot === undefined) continue;
        const face =
          phase === 'roll'
            ? ((Math.floor(rollT * 36) + index * 3) % 6) + 1
            : (diceValues[index] ?? 1);
        placements.push({
          x: slot.x,
          y: slot.y,
          z: slot.z,
          face,
          color,
          scale: DICE_SCALE,
          rotationY: 0,
          highlight: highlight.has(`${owner}:${index}`) ? 1 : 0,
        });
      }
    };
    collect(attackerDicePos, plan.attackerDice, 'attacker', attackerSide.color);
    collect(defenderDicePos, plan.defenderDice, 'defender', defenderSide.color);
    dice.update(placements);
    options.renderer.requestRender();
  };

  /** Emite el destello/humo/polvo segun la accion del duelista ganador. */
  const spawnImpact = (
    action: 'volley' | 'charge' | 'cannon',
    at: Vector3,
    scale: number,
  ): void => {
    // La calidad adaptativa puede recortar la cantidad de partículas.
    scale *= currentParticleFactor();
    const neutral = new ThreeColor(0xb9a07a);
    const spark = new ThreeColor(0xffd27a);
    const smoke = new ThreeColor(0x9aa3b2);
    const bursts: ParticleBurst[] = [];
    if (action === 'cannon') {
      bursts.push({
        kind: 'flash',
        x: at.x,
        y: at.y + 1,
        z: at.z,
        count: Math.round(8 * scale),
        spread: 4,
        speed: 6,
        color: spark,
      });
      bursts.push({
        kind: 'smoke',
        x: at.x,
        y: at.y + 1,
        z: at.z,
        count: Math.round(14 * scale),
        spread: 6,
        speed: 3,
        color: smoke,
      });
      bursts.push({
        kind: 'spark',
        x: at.x,
        y: at.y + 1,
        z: at.z,
        count: Math.round(10 * scale),
        spread: 5,
        speed: 10,
        color: spark,
      });
    } else if (action === 'charge') {
      bursts.push({
        kind: 'dust',
        x: at.x,
        y: at.y + 0.8,
        z: at.z,
        count: Math.round(14 * scale),
        spread: 7,
        speed: 5,
        color: neutral,
      });
      bursts.push({
        kind: 'spark',
        x: at.x,
        y: at.y + 1,
        z: at.z,
        count: Math.round(6 * scale),
        spread: 4,
        speed: 9,
        color: spark,
      });
    } else {
      bursts.push({
        kind: 'spark',
        x: at.x,
        y: at.y + 1,
        z: at.z,
        count: Math.round(8 * scale),
        spread: 4,
        speed: 8,
        color: spark,
      });
      bursts.push({
        kind: 'dust',
        x: at.x,
        y: at.y + 0.6,
        z: at.z,
        count: Math.round(8 * scale),
        spread: 5,
        speed: 3,
        color: neutral,
      });
    }
    for (const burst of bursts) particles.spawn(burst);
    options.renderer.requestRender();
  };

  /** Brasas alrededor del estandarte recien plantado. */
  const spawnEmbers = (at: Vector3, scale: number): void => {
    particles.spawn({
      kind: 'spark',
      x: at.x,
      y: at.y + 1,
      z: at.z,
      count: Math.round(10 * scale * currentParticleFactor()),
      spread: 7,
      speed: 4,
      color: new ThreeColor(0xffb347),
    });
    options.renderer.requestRender();
  };

  /**
   * Secuencia maritima de apertura: navegacion, andanada y desembarco.
   * Devuelve la timeline, el plan y la zona donde arrancan las tropas (la
   * playa), o `null` si el frente es terrestre.
   */
  const openSeaCrossing = (
    front: FrontAnchor,
    attackerArmies: number,
    attackerColor: Color,
    profile: SpectacleProfile,
  ): {
    timeline: gsap.core.Timeline;
    plan: SeaCrossingPlan;
    landingCenter: Vector3;
  } | null => {
    if (front.kind !== 'sea' || front.coastA === null || front.coastB === null) return null;

    const projection = options.scene.board.projection;
    // `toWorld` devuelve un punto 2D {x, z}, no un Vector3.
    const coastA = projection.toWorld(front.coastA[0], front.coastA[1]);
    const coastB = projection.toWorld(front.coastB[0], front.coastB[1]);

    const sailDir = new Vector3(coastB.x - coastA.x, 0, coastB.z - coastA.z);
    if (sailDir.lengthSq() < 1e-6) return null;
    sailDir.normalize();
    const sailRight = new Vector3(sailDir.z, 0, -sailDir.x);

    // Un navio por unidad de artilleria de la escuadra, minimo uno.
    const composition = composeSquad(attackerArmies, { maxUnits: currentUnitCap() });
    const artilleryUnits = composition.units.find((unit) => unit.type === 'artillery')?.count ?? 0;
    const shipCount = Math.max(1, artilleryUnits);

    const lateralOf = (index: number): number => (index - (shipCount - 1) / 2) * SHIP_SPACING;
    const startPositions = Array.from({ length: shipCount }, (_, index) => {
      const lateral = lateralOf(index);
      return new Vector3(
        coastA.x + sailRight.x * lateral,
        baseY + 0.4,
        coastA.z + sailRight.z * lateral,
      );
    });
    // La linea de fondeo: frente a la costa del defensor, sin tocar tierra.
    const anchorCenter = new Vector3(coastB.x, 0, coastB.z).addScaledVector(
      sailDir,
      -SHIP_STANDOFF,
    );
    const anchorPositions = startPositions.map((_, index) => {
      const lateral = lateralOf(index);
      return new Vector3(
        anchorCenter.x + sailRight.x * lateral,
        baseY + 0.4,
        anchorCenter.z + sailRight.z * lateral,
      );
    });

    const plan = planSeaCrossing({ timing: profile.sea, shipCount });
    const timeline = gsap.timeline();
    const shipState = { t: 0 };
    const rotationY = Math.atan2(sailDir.x, sailDir.z);

    const placeShips = (t: number): void => {
      const instances = startPositions.map((start, index) => {
        const end = anchorPositions[index] ?? start;
        // Arco suave: se aparta de la recta a la mitad del camino.
        const arc = Math.sin(Math.PI * t) * 10;
        return {
          x: start.x + (end.x - start.x) * t + sailRight.x * arc,
          y: baseY + 0.4,
          z: start.z + (end.z - start.z) * t + sailRight.z * arc,
          rotationY,
          scale: SHIP_SCALE,
          color: attackerColor,
        };
      });
      ships.setInstances(instances);
      options.renderer.requestRender();
    };

    if (plan.sail.duration <= 0) {
      // Rapido (o salto): los navios fondan directamente.
      placeShips(1);
    } else {
      // Navegacion: suena mientras los navios cruzan.
      timeline.call(
        () => options.audio?.cue('ship.sail', startPositions[0]),
        undefined,
        plan.sail.start,
      );
      timeline.to(
        shipState,
        {
          t: 1,
          duration: plan.sail.duration,
          ease: 'power1.inOut',
          onUpdate: () => placeShips(shipState.t),
        },
        plan.sail.start,
      );
    }

    if (plan.broadside.duration > 0) {
      // Andanada: puro espectaculo. Las bajas las decide el motor en la ronda.
      timeline.call(
        () => {
          options.audio?.cue('ship.cannon', anchorCenter);
          for (const anchorPosition of anchorPositions) {
            spawnImpact('cannon', anchorPosition, 0.8);
          }
          if (profile.cameraShake) options.scene.rig.shake(2.6, 0.2);
        },
        undefined,
        plan.broadside.start + plan.broadside.duration * 0.5,
      );
    }

    // Desembarco: las tropas arrancan en la playa, frente a los navios.
    const landingCenter = anchorCenter.clone().addScaledVector(sailDir, SHIP_STANDOFF * 0.5);
    if (plan.landing.duration > 0) {
      timeline.call(
        () => options.audio?.cue('ship.landing', landingCenter),
        undefined,
        plan.landing.start,
      );
    }
    return { timeline, plan, landingCenter };
  };

  return {
    group,

    isOpen(): boolean {
      return open;
    },

    open(openOptions: OpenBattleOptions): gsap.core.Timeline {
      const { front, profile } = openOptions;
      const projection = options.scene.board.projection;
      baseY = options.scene.board.relief + 0.5;

      const frontWorld = projection.toWorld(front.point[0], front.point[1]);
      const ahead = projection.toWorld(
        front.point[0] + front.normal[0] * 0.6,
        front.point[1] + front.normal[1] * 0.6,
      );

      forward = new Vector3(ahead.x - frontWorld.x, 0, ahead.z - frontWorld.z);
      if (forward.lengthSq() < 1e-6) forward.set(1, 0, 0);
      forward.normalize();
      right = new Vector3(forward.z, 0, -forward.x);

      const frontCenter = new Vector3(frontWorld.x, baseY, frontWorld.z);
      const attackerCenter = frontCenter.clone().addScaledVector(forward, -LINE_GAP);
      const defenderCenter = frontCenter.clone().addScaledVector(forward, LINE_GAP);

      // Si el frente es maritimo, el atacante llega por mar: la secuencia de
      // apertura incluye navegacion, andanada y desembarco.
      const sea = openSeaCrossing(
        front,
        openOptions.attacker.armies,
        openOptions.attacker.color,
        profile,
      );

      attackerSide = buildSide(
        openOptions.attacker,
        attackerCenter,
        forward.clone(),
        3,
        sea?.landingCenter,
      );
      defenderSide = buildSide(openOptions.defender, defenderCenter, forward.clone().negate(), 7);

      // Huecos de los dados: una fila corta delante de cada linea, centrada.
      const placeDice = (center: Vector3, dir: Vector3): Vector3[] => {
        const origin = center.clone().addScaledVector(dir, LINE_GAP * 0.22);
        const step = DICE_SCALE * 1.2;
        return [0, 1, 2].map((index) => {
          const lateral = (index - 1) * step;
          return new Vector3(
            origin.x + right.x * lateral,
            baseY + DICE_LIFT,
            origin.z + right.z * lateral,
          );
        });
      };
      attackerDicePos.splice(
        0,
        attackerDicePos.length,
        ...placeDice(attackerCenter, forward.clone()),
      );
      defenderDicePos.splice(
        0,
        defenderDicePos.length,
        ...placeDice(defenderCenter, forward.clone().negate()),
      );

      group.visible = true;
      options.renderer.setContinuous(true);
      deployProgress = openOptions.instant ? 1 : 0;
      applyInstances();

      if (profile.cameraMove) options.scene.setDim(0.42);
      options.scene.focusPoint(frontWorld.x, frontWorld.z, {
        distance: profile.cameraDistance,
        polarDeg: profile.cameraPolarDeg,
        duration: profile.cameraMove ? 0.55 : 0,
        instant: openOptions.instant || !profile.cameraMove,
      });

      const timeline = gsap.timeline();
      if (sea !== null) timeline.add(sea.timeline, 0);

      const deployInstant =
        openOptions.instant || !profile.deploy || (sea !== null && profile.sea.landing <= 0);
      if (deployInstant) {
        deployProgress = 1;
        applyInstances();
        open = true;
        return timeline;
      }

      // El despliegue (o desembarco, si la llegada fue por mar) arranca cuando
      // termina la travesia: las tropas bajan de los navios ya en la playa.
      const deployStart = sea !== null ? sea.plan.landing.start : 0;
      // El avance de la escuadra suena donde arranca: sobre el frente.
      timeline.call(
        () => options.audio?.cue('infantry.march', frontCenter),
        undefined,
        deployStart,
      );
      const state = { progress: 0 };
      timeline.to(
        state,
        {
          progress: 1,
          duration:
            sea !== null
              ? Math.max(0.25, profile.sea.landing)
              : Math.max(0.25, profile.roundSeconds * 0.35),
          ease: 'power2.out',
          onUpdate: () => {
            deployProgress = state.progress;
            applyInstances();
          },
        },
        deployStart,
      );

      open = true;
      return timeline;
    },

    playRound(event: BattleRoundResolved, profile: SpectacleProfile): gsap.core.Timeline {
      const attackerAlive = sideRoster(attackerSide);
      const defenderAlive = sideRoster(defenderSide);
      const plan = planRound({ event, attackerAlive, defenderAlive, timing: profile.timing });

      const aRefs = attackerSide === null ? [] : attackerSide.units.filter((unit) => unit.alive);
      const dRefs = defenderSide === null ? [] : defenderSide.units.filter((unit) => unit.alive);

      // Marca las bajas ya: asi la proxima ronda las vera muertas aunque se salte.
      for (const duel of plan.duels) {
        const refs = duel.casualtySide === 'attacker' ? aRefs : dRefs;
        const casualty = refs[duel.casualtyIndex];
        if (casualty !== undefined) casualty.alive = false;
      }

      options.renderer.setContinuous(true);
      const timeline = gsap.timeline();

      // --- Dados: aparecen, ruedan y se asientan en la cara del motor. -------
      const diceOpacity = { v: 0 };
      const rollState = { t: 0 };
      dice.setOpacity(0);

      // Los dados de cada bando suenan donde estan: el paneo los separa.
      const dadosAtacante = centroDe(attackerDicePos);
      const dadosDefensor = centroDe(defenderDicePos);
      timeline.call(
        () => {
          options.audio?.cue('dice.roll', dadosAtacante);
          options.audio?.cue('dice.roll', dadosDefensor);
        },
        undefined,
        plan.diceRoll.start,
      );
      timeline.call(
        () => {
          options.audio?.cue('dice.land', dadosAtacante);
          options.audio?.cue('dice.land', dadosDefensor);
        },
        undefined,
        plan.diceLand.start,
      );
      timeline.to(
        diceOpacity,
        {
          v: 1,
          duration: 0.12,
          onUpdate: () => {
            dice.setOpacity(diceOpacity.v);
            renderDice(plan, 'roll', rollState.t);
          },
        },
        plan.diceRoll.start,
      );
      timeline.to(
        rollState,
        {
          t: 1,
          duration: plan.diceRoll.duration,
          ease: 'none',
          onUpdate: () => renderDice(plan, 'roll', rollState.t),
        },
        plan.diceRoll.start,
      );
      timeline.to(
        rollState,
        {
          t: 0,
          duration: plan.diceLand.duration,
          ease: 'power2.out',
          onUpdate: () => renderDice(plan, 'land', 0),
        },
        plan.diceLand.start,
      );
      timeline.to(
        diceOpacity,
        {
          v: 0,
          duration: Math.min(0.25, plan.regroup.duration),
          onUpdate: () => dice.setOpacity(diceOpacity.v),
        },
        plan.regroup.start,
      );

      // --- Duelos: cada comparacion es un enfrentamiento escalonado. ----------
      for (const duel of plan.duels) {
        const actorRefs = duel.actingSide === 'attacker' ? aRefs : dRefs;
        const casualtyRefs = duel.casualtySide === 'attacker' ? aRefs : dRefs;
        const actor = actorRefs[duel.actingIndex];
        const casualty = casualtyRefs[duel.casualtyIndex];

        if (actor !== undefined) {
          // La accion del duelista suena al arrancar el enfrentamiento.
          const sonidoAccion = SONIDO_ACCION[duel.action];
          timeline.call(() => options.audio?.cue(sonidoAccion, actor.base), undefined, duel.start);
          timeline.to(
            actor,
            {
              lunge: 1,
              duration: duel.duration * 0.28,
              yoyo: true,
              repeat: 1,
              ease: 'power2.out',
              onUpdate: () => applyInstances(),
            },
            duel.start,
          );
        }

        timeline.call(
          () => {
            // Destello del par comparado: stinger del lado que gana el par.
            const dadoAtacante = attackerDicePos[duel.pairIndex] ?? dadosAtacante;
            const dadoDefensor = defenderDicePos[duel.pairIndex] ?? dadosDefensor;
            options.audio?.cue(
              duel.winner === 'attacker' ? 'dice.win' : 'dice.lose',
              dadoAtacante.clone().add(dadoDefensor).multiplyScalar(0.5),
            );
            if (casualty !== undefined) {
              options.audio?.cue(SONIDO_IMPACTO[duel.action], casualty.base);
              spawnImpact(duel.action, casualty.base, profile.particleScale);
              if (profile.cameraShake) options.scene.rig.shake(2.2, 0.16);
            }
            applyInstances();
          },
          undefined,
          duel.start + duel.duration,
        );

        if (casualty !== undefined) {
          timeline.to(
            casualty,
            {
              fallen: 1,
              duration: duel.duration * 0.7,
              ease: 'power2.in',
              onUpdate: () => applyInstances(),
            },
            duel.start + duel.duration,
          );
        }
      }

      return timeline;
    },

    playConquest(conquestOptions: ConquestOptions): gsap.core.Timeline {
      const { target, profile } = conquestOptions;
      const plan: ConquestPlan = planConquest({ timing: profile.conquest });
      const timeline = gsap.timeline();

      const anchorWorld = new Vector3(target.anchorX, baseY, target.anchorZ);

      // --- Avance: la escuadra atacante marcha al territorio conquistado. ----
      const units = attackerSide === null ? [] : attackerSide.units.filter((u) => u.alive);
      const toAnchor = anchorWorld
        .clone()
        .sub(units[0]?.base ?? anchorWorld)
        .setY(0);
      if (toAnchor.lengthSq() < 1e-6) toAnchor.set(0, 0, 1);
      toAnchor.normalize();
      const anchorRight = new Vector3(toAnchor.z, 0, -toAnchor.x);
      const slots = formationPositions(units.length, anchorWorld, toAnchor, anchorRight, 9);

      // La escuadra avanza al territorio conquistado: suena la marcha.
      timeline.call(
        () => options.audio?.cue('infantry.march', units[0]?.base ?? anchorWorld),
        undefined,
        0,
      );

      units.forEach((unit, index) => {
        const slot = slots[index] ?? anchorWorld;
        const targetRotation =
          unit.rotationY + shortestAngleDelta(unit.rotationY, Math.atan2(toAnchor.x, toAnchor.z));
        timeline.to(
          unit.base,
          {
            x: slot.x,
            y: baseY,
            z: slot.z,
            duration: plan.advance.duration,
            ease: 'power2.inOut',
            onUpdate: () => applyInstances(),
          },
          index * 0.02,
        );
        timeline.to(
          unit,
          {
            rotationY: targetRotation,
            duration: plan.advance.duration,
            ease: 'power2.inOut',
            onUpdate: () => applyInstances(),
          },
          index * 0.02,
        );
      });

      // --- Estandarte: se planta con un pequeño rebote de escala. -------------
      timeline.call(
        () => {
          // La bandera mira hacia la camara, que esta del lado del atacante.
          const rotationY = Math.atan2(-forward.x, -forward.z);
          options.audio?.cue('flag.plant', anchorWorld);
          banner.plant({ x: target.anchorX, z: target.anchorZ, color: target.color, rotationY });
          bannerPlanted = true;
          banner.group.scale.set(0.25, 0.25, 0.25);
        },
        undefined,
        plan.plant.start,
      );
      timeline.to(
        banner.group.scale,
        {
          x: 1,
          y: 1,
          z: 1,
          duration: plan.plant.duration,
          ease: 'back.out(2.2)',
        },
        plan.plant.start,
      );

      // --- Onda de cambio de dueno: barre desde el frente. -------------------
      // La fanfarria suena cuando la onda cambia el dueno del territorio.
      timeline.call(
        () => options.audio?.cue('territory.conquered', anchorWorld),
        undefined,
        plan.wave.start,
      );
      const waveTimeline = options.scene.playOwnershipWave({
        territoryIndex: target.territoryIndex,
        originX: conquestOptions.waveOriginX,
        originZ: conquestOptions.waveOriginZ,
        color: target.color,
        radius: target.coverRadius,
        duration: plan.wave.duration,
      });
      timeline.add(waveTimeline, plan.wave.start);

      // --- Sostener: brasas alrededor del estandarte. ------------------------
      if (plan.hold.duration > 0) {
        timeline.call(
          () => spawnEmbers(anchorWorld, profile.particleScale),
          undefined,
          plan.hold.start,
        );
      }

      // --- Fundido: las escuadras del campo se disuelven. --------------------
      const opacity = { v: 1 };
      timeline.to(
        opacity,
        {
          v: 0,
          duration: plan.close.duration,
          ease: 'power2.in',
          onUpdate: () => batch.setOpacity(opacity.v),
        },
        plan.close.start,
      );
      timeline.call(
        () => {
          attackerSide = null;
          defenderSide = null;
          // Las escuadras ya estan fundidas: se retiran las instancias para
          // que el cierre de la escena no las vuelva a mostrar.
          batch.setInstances([]);
          batch.setOpacity(1);
          applyInstances();
        },
        undefined,
        plan.close.start + plan.close.duration,
      );

      return timeline;
    },

    playMarch(marchOptions: MarchOptions): gsap.core.Timeline {
      const marchCap = currentMarchCap();
      const count = Math.max(1, Math.min(marchCap, Math.floor(marchOptions.count)));
      const from = new Vector3(marchOptions.fromX, baseY, marchOptions.fromZ);
      const to = new Vector3(marchOptions.toX, baseY, marchOptions.toZ);
      const dir = to.clone().sub(from).setY(0);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
      dir.normalize();
      const marchRight = new Vector3(dir.z, 0, -dir.x);
      const rotationY = Math.atan2(dir.x, dir.z);

      // Formacion de marcha: columnas hacia el destino.
      const slots = formationPositions(count, from, dir, marchRight, MARCH_SPACING);

      group.visible = true;
      options.renderer.setContinuous(true);

      // Si la secuencia de conquista se salto, el estandarte no quedo plantado:
      // se planta ahora, como parte de la llegada.
      if (!bannerPlanted) {
        options.audio?.cue('flag.plant', new Vector3(marchOptions.toX, baseY, marchOptions.toZ));
        banner.plant({
          x: marchOptions.toX,
          z: marchOptions.toZ,
          color: marchOptions.color,
          rotationY: Math.atan2(-dir.x, -dir.z),
        });
        bannerPlanted = true;
        banner.group.scale.set(0.25, 0.25, 0.25);
      }

      // Polvo en la partida.
      particles.spawn({
        kind: 'dust',
        x: from.x,
        y: baseY + 0.5,
        z: from.z,
        count: Math.round(10 * marchOptions.profile.particleScale * currentParticleFactor()),
        spread: 8,
        speed: 3,
        color: new ThreeColor(0xb9a07a),
      });

      const state = { t: 0 };
      let lastPuff = -1;
      const timeline = gsap.timeline({
        onComplete: () => {
          batch.setInstances([]);
          batch.setOpacity(1);
          banner.remove();
          bannerPlanted = false;
          ships.setInstances([]);
          group.visible = false;
          open = false;
          marchTl = null;
          options.renderer.setContinuous(false);
          options.renderer.requestRender();
          marchOptions.onComplete();
        },
      });
      // La columna en marcha suena desde donde arranca.
      timeline.call(() => options.audio?.cue('infantry.march', from), undefined, 0);
      timeline.to(
        banner.group.scale,
        { x: 1, y: 1, z: 1, duration: 0.3, ease: 'back.out(2.2)' },
        0,
      );
      timeline.to(state, {
        t: 1,
        duration: Math.max(0.4, marchOptions.profile.marchSeconds),
        ease: 'none',
        onUpdate: () => {
          const instances: UnitInstance[] = slots.map((slot) => {
            const px = from.x + (to.x - from.x) * state.t + (slot.x - from.x);
            const pz = from.z + (to.z - from.z) * state.t + (slot.z - from.z);
            return {
              type: 'infantry' as UnitType,
              x: px,
              y: baseY,
              z: pz,
              rotationY,
              scale: MARCH_SCALE,
              color: marchOptions.color,
            };
          });
          batch.setInstances(instances);
          // Polvo en la pisada: deja el camino recorrido a la vista.
          if (state.t - lastPuff >= MARCH_PUFF_STEP) {
            lastPuff = state.t;
            particles.spawn({
              kind: 'dust',
              x: from.x + (to.x - from.x) * state.t,
              y: baseY + 0.3,
              z: from.z + (to.z - from.z) * state.t,
              count: Math.max(1, Math.round(3 * currentParticleFactor())),
              spread: 5,
              speed: 1.5,
              color: new ThreeColor(0xb9a07a),
            });
          }
          options.renderer.requestRender();
        },
      });
      marchTl = timeline;
      return timeline;
    },

    close(closeOptions: { instant?: boolean; keepBanner?: boolean } = {}): gsap.core.Timeline {
      options.renderer.setContinuous(true);
      options.scene.setDim(1);
      dice.setOpacity(0);
      particles.clear();

      // Salto duro: la marcha en curso se fuerza a su final (su onComplete
      // aplica el estado de las reglas) y el estandarte se retira.
      if (marchTl !== null) {
        marchTl.progress(1);
        marchTl = null;
      }

      // Tras una conquista el estandarte se queda plantado: marca el
      // territorio recien conquistado hasta que se haga la marcha. Las demas
      // capas ya quedaron invisibles (escuadras fundidas, dados en opacidad
      // cero, navios retirados), asi que el grupo puede seguir vivo.
      const keepBanner = closeOptions.keepBanner === true && bannerPlanted;
      if (!keepBanner) {
        banner.remove();
        bannerPlanted = false;
      }
      ships.setInstances([]);
      batch.setOpacity(1);

      const timeline = gsap.timeline({
        onComplete: () => {
          if (!keepBanner) group.visible = false;
          open = false;
          attackerSide = null;
          defenderSide = null;
          options.renderer.setContinuous(false);
          options.renderer.requestRender();
        },
      });

      if (closeOptions.instant === true) {
        timeline.progress(1);
        if (!keepBanner) group.visible = false;
        open = false;
        attackerSide = null;
        defenderSide = null;
        return timeline;
      }

      const state = { progress: 1 };
      timeline.to(state, {
        progress: 0,
        duration: 0.32,
        ease: 'power2.in',
        onUpdate: () => {
          deployProgress = state.progress;
          applyInstances();
        },
      });
      return timeline;
    },

    setTime(seconds: number): void {
      batch.setTime(seconds);
      ships.setTime(seconds);
      banner.setTime(seconds);
    },

    recordFrame(deltaSeconds: number): void {
      if (!qualityAuto || qualityManual !== null) return;
      const before = qualityController.snapshot().degraded;
      qualityController.recordFrame(deltaSeconds);
      if (qualityController.snapshot().degraded !== before) {
        // El tope de unidades cambió a mitad de la batalla: refrescar ya.
        applyInstances();
        options.renderer.requestRender();
      }
    },

    setQuality(state: { readonly unitCap: number; readonly particleScale: number }): void {
      qualityManual = {
        unitCap: Math.max(1, Math.floor(state.unitCap)),
        particleScale: Math.max(0, state.particleScale),
      };
      applyInstances();
      options.renderer.requestRender();
    },

    setAdaptiveQuality(enabled: boolean): void {
      qualityAuto = enabled;
      if (!enabled) return;
      qualityManual = null;
      qualityController.reset();
      applyInstances();
      options.renderer.requestRender();
    },

    quality(): {
      readonly degraded: boolean;
      readonly unitCap: number;
      readonly particleScale: number;
    } {
      const unitCap = currentUnitCap();
      const particleScale = currentParticleFactor();
      return {
        degraded: unitCap < options.maxUnits || particleScale < 1,
        unitCap,
        particleScale,
      };
    },

    tick(deltaSeconds: number): void {
      particles.update(deltaSeconds);
      if (particles.aliveCount() > 0) options.renderer.requestRender();
    },

    visibleUnits(): number {
      return batch.visibleUnits();
    },

    visibleShips(): number {
      return ships.visibleShips();
    },

    attackerRoster(): readonly UnitType[] {
      return sideRoster(attackerSide);
    },

    defenderRoster(): readonly UnitType[] {
      return sideRoster(defenderSide);
    },

    dispose(): void {
      dice.dispose();
      particles.dispose();
      batch.dispose();
      ships.dispose();
      banner.dispose();
    },
  };
}

/** Perfil por defecto de la escena, para el sandbox. */
export const DEFAULT_BATTLE_PROFILE = SPECTACLE_PROFILES.tactical;
