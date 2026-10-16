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
 * NADA de esto decide resultados: el `BattleRoundResolved` ya viene resuelto por
 * el motor y `planRound` (puro) lo traduce a un plan de tiempos. Ver
 * docs/adr/0006-combate-visual-no-decide.md
 */

import gsap from 'gsap';
import type { Color } from 'three';
import { Color as ThreeColor, Group, Vector3 } from 'three';

import { composeSquad, type BattleRoundResolved, type UnitType } from '@conqueror/rules';
import type { FrontAnchor } from '@conqueror/map-data';
import type { RendererHandle } from '../renderer.js';
import type { GameScene } from '../../scenes/game/GameScene.js';
import { UNIT_ORDER, UnitBatch, type UnitInstance } from '../tokens/UnitBatch.js';
import { SPECTACLE_PROFILES, type SpectacleProfile } from './spectacle.js';
import { planRound, type RoundPlan } from './choreography/round.js';
import { DiceLayer, type DiePlacement } from './dice/DiceLayer.js';
import { ParticlePool, type ParticleBurst } from './fx/ParticlePool.js';

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

export interface BattleSceneOptions {
  readonly renderer: RendererHandle;
  readonly scene: GameScene;
  /** Tope de unidades por bando en batalla. */
  readonly maxUnits: number;
}

export interface BattleScene {
  readonly group: Group;
  open(options: OpenBattleOptions): gsap.core.Timeline;
  playRound(event: BattleRoundResolved, profile: SpectacleProfile): gsap.core.Timeline;
  close(options?: { instant?: boolean }): gsap.core.Timeline;
  isOpen(): boolean;
  setTime(seconds: number): void;
  tick(deltaSeconds: number): void;
  visibleUnits(): number;
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

export function createBattleScene(options: BattleSceneOptions): BattleScene {
  const group = new Group();
  const batch = new UnitBatch({ capacity: 64 });
  const dice = new DiceLayer();
  const particles = new ParticlePool(512);
  group.add(batch.group, dice.group, particles.group);
  group.visible = false;

  let attackerSide: BattleSideInternal | null = null;
  let defenderSide: BattleSideInternal | null = null;
  let forward = new Vector3(1, 0, 0);
  let right = new Vector3(0, 0, 1);
  let baseY = 1;
  let deployProgress = 1;
  let open = false;

  const attackerDicePos: Vector3[] = [];
  const defenderDicePos: Vector3[] = [];

  /** Recoloca las instancias interpolando marcha -> formacion y aplicando caidas. */
  const applyInstances = (): void => {
    if (attackerSide === null || defenderSide === null) return;
    const instances: UnitInstance[] = [];

    const build = (side: BattleSideInternal): void => {
      for (const unit of side.units) {
        if (!unit.alive && unit.fallen < 0.001) continue;
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

    build(attackerSide);
    build(defenderSide);
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
  ): BattleSideInternal => {
    const composition = composeSquad(side.armies, { maxUnits: options.maxUnits });
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
      const spread = 7;
      const offsetX = (((index * 37 + jitterSeed) % 11) - 5) * (spread / 5);
      const offsetZ = (((index * 53 + jitterSeed) % 13) - 6) * (spread / 6);
      return {
        type,
        color: side.color,
        start: new Vector3(side.originX + offsetX, baseY, side.originZ + offsetZ),
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

      attackerSide = buildSide(openOptions.attacker, attackerCenter, forward.clone(), 3);
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
      if (!profile.deploy || openOptions.instant) {
        deployProgress = 1;
        applyInstances();
        open = true;
        return timeline;
      }

      const state = { progress: 0 };
      timeline.to(state, {
        progress: 1,
        duration: Math.max(0.25, profile.roundSeconds * 0.35),
        ease: 'power2.out',
        onUpdate: () => {
          deployProgress = state.progress;
          applyInstances();
        },
      });

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
            if (casualty !== undefined) {
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

    close(closeOptions: { instant?: boolean } = {}): gsap.core.Timeline {
      options.renderer.setContinuous(true);
      options.scene.setDim(1);
      dice.setOpacity(0);
      particles.clear();

      const timeline = gsap.timeline({
        onComplete: () => {
          group.visible = false;
          open = false;
          attackerSide = null;
          defenderSide = null;
          options.renderer.setContinuous(false);
          options.renderer.requestRender();
        },
      });

      if (closeOptions.instant === true) {
        timeline.progress(1);
        group.visible = false;
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
    },

    tick(deltaSeconds: number): void {
      particles.update(deltaSeconds);
      if (particles.aliveCount() > 0) options.renderer.requestRender();
    },

    visibleUnits(): number {
      return batch.visibleUnits();
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
    },
  };
}

/** Perfil por defecto de la escena, para el sandbox. */
export const DEFAULT_BATTLE_PROFILE = SPECTACLE_PROFILES.tactical;
