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
 *   - La CONQUISTA (C3) tiene coreografia propia sobre la escena abierta:
 *     avance de la escuadra, estandarte y onda de cambio de dueno. El estado
 *     se aplica cuando la ONDA termina: desde ahi el tablero ya muestra el
 *     color del dueno nuevo, y recien entonces `setGameState` reescribe los
 *     atributos por vertice con ese mismo color.
 *   - Siempre saltable: clic, Espacio o Esc. Al saltar se fuerzan las
 *     timelines (onda y marcha incluidas) y se aplican los estados pendientes.
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
import { planConquest } from './choreography/conquest.js';

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
  /**
   * Se llama cuando la onda de cambio de dueno termina (o se salta). Recien
   * aca la aplicacion debe aplicar el nuevo dueno: antes, el tablero muestra
   * el color nuevo de la onda pero los atributos siguen con el viejo.
   */
  readonly onConquered: (territory: TerritoryId) => void;
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

/** Clave del frente entre dos territorios, en el orden que usa el mapa. */
const frontKeyOf = (from: TerritoryId, to: TerritoryId): string =>
  from < to ? `${from}|${to}` : `${to}|${from}`;

export function createCombatDirector(options: CombatDirectorOptions): CombatDirector {
  let level = options.level;
  let spectator = false;
  let queue: GameEvent[] = [];
  let current: gsap.core.Timeline | null = null;
  let running = false;
  /** Par origen/destino de la escena abierta. */
  let openPair: { readonly from: TerritoryId; readonly to: TerritoryId } | null = null;
  /** Ultimo par batallado: la conquista se coreografia sobre el. */
  let lastPair: { readonly from: TerritoryId; readonly to: TerritoryId } | null = null;
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
    lastPair = { from: event.from, to: event.to };
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
      const front = options.scene.data.frontByPair.get(frontKeyOf(event.from, event.to));

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

  /**
   * Secuencia de conquista sobre la escena de batalla abierta: avance de la
   * escuadra atacante al territorio, plantado del estandarte, onda de cambio
   * de dueno y cierre de la escena. Devuelve la timeline, o `null` si no hay
   * contexto para coreografiarla (en ese caso el estado se aplica directo).
   */
  const playConquest = (
    event: Extract<GameEvent, { readonly type: 'TERRITORY_CONQUERED' }>,
  ): gsap.core.Timeline | null => {
    const pair = lastPair;
    if (pair === null || openPair === null) {
      // Sin una batalla en curso no hay nada que animar.
      options.onConquered(event.territory);
      return null;
    }

    const from = pair.from;
    const to = pair.to;
    const front = options.scene.data.frontByPair.get(frontKeyOf(from, to));
    const anchor = options.anchorOf(to);
    const territoryIndex = options.scene.territoryIndex(to);
    const profile = profileFor();

    if (front === undefined || anchor === undefined || territoryIndex === undefined) {
      // Faltan piezas del mapa: se cierra y se aplica el estado sin mas.
      openPair = null;
      options.battle.close({ instant: true });
      options.onConquered(event.territory);
      return null;
    }

    // El barrido de la onda arranca en el punto del frente.
    const frontWorld = options.scene.board.projection.toWorld(front.point[0], front.point[1]);
    const coverRadius = options.scene.coverRadiusFrom(to, frontWorld.x, frontWorld.z) ?? 60;
    // Cuando termina la onda el tablero ya muestra el dueno nuevo: ahi se
    // aplica el estado (ver GameScene.playOwnershipWave).
    const plan = planConquest({ timing: profile.conquest });
    const waveEnd = plan.wave.start + plan.wave.duration;

    openPair = null;

    // El perfil cinematico corre la conquista en camara lenta.
    const timeline = gsap.timeline({
      timeScale: profile.conquestTimeScale,
      onComplete: () => {
        current = null;
        lastPair = null;
        running = false;
        // La escena se cierra recien ahora, con el estandarte plantado: marca
        // el territorio recien conquistado hasta que se haga la marcha.
        // (No se encadena antes: `close` evalua su estado al llamarlo, y al
        // terminar la conquista el estandarte ya existe.)
        options.battle.close({ instant: true, keepBanner: true });
        finishIdle();
      },
    });

    timeline.call(() => options.onConquered(event.territory), undefined, waveEnd);

    const conquestTl = options.battle.playConquest({
      target: {
        territory: to,
        territoryIndex,
        // El dueno nuevo es el atacante: el defensor ya quedo en cero.
        color: options.colorOf(from),
        anchorX: anchor.x,
        anchorZ: anchor.z,
        coverRadius,
      },
      waveOriginX: frontWorld.x,
      waveOriginZ: frontWorld.z,
      profile,
    });
    timeline.add(conquestTl, 0);

    options.renderer.setContinuous(true);
    return timeline;
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
      const conquestTl = playConquest(next);
      if (conquestTl === null) running = false;
      else current = conquestTl;
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
      // La timeline en curso se fuerza a su final: sus callbacks (onda de
      // dueno y aplicacion de estados incluidos) se disparan en el acto.
      // Se copia la referencia primero: el onComplete la pone en null.
      const active = current;
      current = null;
      if (active !== null) {
        active.progress(1);
        active.kill();
      }

      // La onda puede quedar a medias si la conquista recien arrancaba.
      options.scene.finishOwnershipWave();

      // Las pendientes se dan por contadas, en orden.
      for (const event of queue) {
        if (event.type === 'BATTLE_ROUND_RESOLVED') options.onRoundApplied(event);
        else if (event.type === 'TERRITORY_CONQUERED') options.onConquered(event.territory);
      }
      queue = [];
      lastPair = null;
      running = false;
      openPair = null;

      // Salto duro: fuera todo, estandarte incluido.
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
