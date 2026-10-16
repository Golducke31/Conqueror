/**
 * Director de combate.
 *
 * Recibe los eventos del motor y los convierte en una cola de timelines. Es la
 * unica pieza que conoce a la vez eventos, escena y (mas adelante) audio.
 *
 * Reglas del plan:
 *   - La presentacion NUNCA decide nada: los numeros ya vienen resueltos.
 *   - La escena de batalla se abre en la primera ronda de un par origen/destino
 *     y sigue abierta mientras el atacante tire contra el mismo objetivo.
 *   - Siempre saltable: clic, Espacio o Esc.
 *   - Si se acumulan mas de 5 rondas, ese tramo se comprime a "Rapido".
 *   - El HUD del atacante no habilita un ataque nuevo hasta terminar o saltar.
 */

import gsap from 'gsap';
import type { Color } from 'three';

import type { BattleRoundResolved, GameEvent } from '@conqueror/rules';
import type { TerritoryId } from '@conqueror/shared';
import type { RendererHandle } from '../renderer.js';
import type { GameScene } from '../../scenes/game/GameScene.js';
import type { BattleScene } from './BattleScene.js';
import {
  SPECTACLE_PROFILES,
  resolveSpectacle,
  stepDown,
  type SpectacleLevel,
  type SpectacleProfile,
} from './spectacle.js';

/** A partir de cuantas rondas pendientes se comprime el tramo. */
const COMPRESS_THRESHOLD = 5;

export interface CombatDirectorOptions {
  readonly renderer: RendererHandle;
  readonly scene: GameScene;
  readonly battle: BattleScene;
  readonly reducedMotion: boolean;
  readonly level: SpectacleLevel;
  /** Ejercitos actuales de un territorio. */
  readonly armiesOf: (territory: TerritoryId) => number;
  /** Color del dueno de un territorio. */
  readonly colorOf: (territory: TerritoryId) => Color;
  /** Ancla del territorio en coordenadas de mundo. */
  readonly anchorOf: (
    territory: TerritoryId,
  ) => { readonly x: number; readonly z: number } | undefined;
  /** Se llama cuando una ronda ya termino de contarse. */
  readonly onRoundApplied: (event: BattleRoundResolved) => void;
}

export interface CombatDirector {
  setLevel(level: SpectacleLevel): void;
  level(): SpectacleLevel;
  enqueue(events: readonly GameEvent[]): void;
  skip(): void;
  isBusy(): boolean;
  pending(): number;
  onIdle(callback: () => void): void;
  setSpectator(value: boolean): void;
  update(deltaSeconds: number): void;
  dispose(): void;
}

export function createCombatDirector(options: CombatDirectorOptions): CombatDirector {
  let level = options.level;
  let spectator = false;
  let queue: GameEvent[] = [];
  let current: gsap.core.Timeline | null = null;
  let running = false;
  /** Par origen/destino de la escena abierta. */
  let openPair: { readonly from: TerritoryId; readonly to: TerritoryId } | null = null;
  let elapsed = 0;
  const idleListeners = new Set<() => void>();

  const profileFor = (): SpectacleProfile => {
    const effective = resolveSpectacle(level, options.reducedMotion);
    const compressed = queue.length > COMPRESS_THRESHOLD;
    const stepped = spectator ? stepDown(effective) : effective;
    return SPECTACLE_PROFILES[compressed ? 'fast' : stepped];
  };

  const finishIdle = (): void => {
    running = false;
    for (const listener of idleListeners) listener();
    options.renderer.requestRender();
  };

  const playRound = (event: BattleRoundResolved): void => {
    const profile = profileFor();
    const pairChanged =
      openPair === null || openPair.from !== event.from || openPair.to !== event.to;

    const timeline = gsap.timeline({
      onComplete: () => {
        current = null;
        options.onRoundApplied(event);
        running = false;
        options.renderer.setContinuous(false);
      },
    });

    // Si cambia el par origen/destino, se abre el campo y despliegan las
    // escuadras. La ronda se encadena despues del despliegue.
    if (pairChanged) {
      const attackerArmies = options.armiesOf(event.from);
      const defenderArmies = options.armiesOf(event.to);
      const attackerAnchor = options.anchorOf(event.from);
      const defenderAnchor = options.anchorOf(event.to);
      const front = options.scene.data.frontByPair.get(
        event.from < event.to ? `${event.from}|${event.to}` : `${event.to}|${event.from}`,
      );

      if (front !== undefined && attackerAnchor !== undefined && defenderAnchor !== undefined) {
        const openTl = options.battle.open({
          front,
          attacker: {
            color: options.colorOf(event.from),
            armies: attackerArmies,
            originX: attackerAnchor.x,
            originZ: attackerAnchor.z,
          },
          defender: {
            color: options.colorOf(event.to),
            armies: defenderArmies,
            originX: defenderAnchor.x,
            originZ: defenderAnchor.z,
          },
          profile,
          instant: profile.roundSeconds <= 0.7,
        });
        timeline.add(openTl, 0);
        openPair = { from: event.from, to: event.to };
      }
    }

    // La coreografia completa de la ronda (dados, duelos, bajas, reacomodo) vive
    // en la escena. Se encadena al final del despliegue si lo hubo.
    const roundTl = options.battle.playRound(event, profile);
    timeline.add(roundTl, pairChanged ? '>' : 0);
    options.renderer.setContinuous(true);

    current = timeline;
  };

  const processNext = (): void => {
    if (running) return;
    const next = queue.shift();
    if (next === undefined) {
      if (openPair !== null) {
        openPair = null;
        options.battle.close();
      }
      finishIdle();
      return;
    }

    running = true;

    if (next.type === 'BATTLE_ROUND_RESOLVED') {
      playRound(next);
      return;
    }

    if (next.type === 'TERRITORY_CONQUERED') {
      // En C3 la conquista tiene su propia coreografia. Por ahora cierra.
      openPair = null;
      const timeline = gsap.timeline({
        onComplete: () => {
          current = null;
          running = false;
        },
      });
      timeline.add(options.battle.close());
      current = timeline;
      return;
    }

    // El resto de los eventos no se animan aca.
    running = false;
  };

  return {
    setLevel(value: SpectacleLevel): void {
      level = value;
    },

    level(): SpectacleLevel {
      return level;
    },

    enqueue(events: readonly GameEvent[]): void {
      if (events.length === 0) return;
      queue.push(...events);
      options.renderer.requestRender();
    },

    skip(): void {
      // Se cierra la timeline en curso y se dan por contadas las pendientes.
      if (current !== null) {
        current.progress(1);
        current.kill();
        current = null;
      }
      for (const event of queue) {
        if (event.type === 'BATTLE_ROUND_RESOLVED') options.onRoundApplied(event);
      }
      queue = [];
      running = false;
      openPair = null;
      options.battle.close({ instant: true });
      finishIdle();
    },

    isBusy(): boolean {
      return running || queue.length > 0 || options.battle.isOpen();
    },

    pending(): number {
      return queue.length;
    },

    onIdle(callback: () => void): void {
      idleListeners.add(callback);
    },

    setSpectator(value: boolean): void {
      spectator = value;
    },

    update(deltaSeconds: number): void {
      elapsed += deltaSeconds;
      options.battle.setTime(elapsed);
      options.battle.tick(deltaSeconds);
      if (!running) processNext();
    },

    dispose(): void {
      current?.kill();
      queue = [];
      idleListeners.clear();
    },
  };
}
