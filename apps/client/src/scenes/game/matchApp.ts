/**
 * Partida local, de punta a punta (Hito 4).
 *
 * Arma la escena, el transporte local (motor en Web Worker) y el HUD, y los
 * conecta: la UI manda comandos por el `GameTransport` y espera el estado
 * publico nuevo; los eventos alimentan el director de combate, que anima sin
 * bloquear nada (la animacion nunca decide: los numeros vienen del motor).
 *
 * Estado visual vs. estado de reglas: el motor ya tiene el resultado cuando
 * llegan los eventos. El tablero los alcanza con la coreografia ( las rondas y
 * la onda de dueño se cuentan sobre la escena ) y recien despues se sincroniza
 * con el estado publico, para que el tablero nunca muestre algo que las reglas
 * no hayan decidido. El HUD, en cambio, trabaja siempre con el estado real.
 *
 * Ver docs/adr/0013-modo-local.md
 */

import { Color, Vector3 } from 'three';
import type { BattleRoundResolved, GameEvent, PublicGameState } from '@conqueror/rules';

import { detectLocale, setLocale } from '../../app/i18n.js';
import { playerColor } from '../../app/palette.js';
import { createAudioManager } from '../../render/combat/audio/audioManager.js';
import { createBattleScene, type BattleScene } from '../../render/combat/BattleScene.js';
import { createCombatDirector, type CombatDirector } from '../../render/combat/CombatDirector.js';
import { createHeatModel } from '../../render/combat/heat/heatModel.js';
import { SPECTACLE_PROFILES } from '../../render/combat/spectacle.js';
import { createUnitModels, type UnitModels } from '../../render/tokens/models/unitModels.js';
import { createRenderer, type RendererHandle } from '../../render/renderer.js';
import { createGameScene, type GameScene, type BoardView } from './GameScene.js';
import { LocalTransport } from '../../net/localTransport.js';
import { createGameHud, type GameHud } from '../../ui/gameHud.js';
import { mostrarRelevo, ocultarRelevo } from '../../ui/handoff.js';
import type { LocalGameSetup } from '../../ui/setup.js';

export interface MatchOptions {
  readonly setup: LocalGameSetup;
  readonly canvas: HTMLCanvasElement;
  readonly hud: HTMLElement;
  readonly relevo: HTMLElement;
  readonly reducedMotion: boolean;
  /** Demora entre comandos de bot (ms). */
  readonly botDelayMs?: number;
  readonly debug?: boolean;
  /** Se llama cuando la partida termina o el jugador sale. */
  readonly onExit?: () => void;
}

export interface MatchApp {
  dispose(): void;
}

export async function startMatch(options: MatchOptions): Promise<MatchApp> {
  const { setup } = options;
  const táctil = window.matchMedia('(pointer: coarse)').matches;

  setLocale(detectLocale());

  const renderer: RendererHandle = createRenderer(options.canvas);

  // Modelos finales: se piden en diferido y, mientras llegan, las fichas usan
  // las primitivas (ADR 0012). El mapa y la batalla comparten los mismos.
  const models: UnitModels = createUnitModels({
    renderer: renderer.renderer,
    ...(options.debug === undefined ? {} : { debug: options.debug }),
  });
  void models.load();

  // Audio: arranca mudo (no hay archivos en el manifiesto) y suena cuando el
  // usuario los agrega (ADR 0011). El primer gesto desbloquea el contexto. El
  // paneo se calcula con la camara: lo que esta fuera de la vista va al centro.
  const audio = createAudioManager({
    ...(options.debug === undefined ? {} : { debug: options.debug }),
    panOf: (mundo) => {
      const punto = new Vector3(mundo.x, mundo.y, mundo.z);
      const direccion = new Vector3();
      renderer.camera.getWorldDirection(direccion);
      if (punto.clone().sub(renderer.camera.position).dot(direccion) <= 0) return 0;
      punto.project(renderer.camera);
      return punto.x;
    },
  });
  void audio.load();
  const desbloquear = (): void => {
    void audio.unlock();
    window.removeEventListener('pointerdown', desbloquear);
    window.removeEventListener('keydown', desbloquear);
  };
  window.addEventListener('pointerdown', desbloquear);
  window.addEventListener('keydown', desbloquear);

  const scene: GameScene = await createGameScene({
    renderer,
    canvas: options.canvas,
    reducedMotion: options.reducedMotion,
    mapMaxUnits: táctil ? 3 : 5,
    rules: setup.config,
    models,
  });
  renderer.scene.add(scene.group);

  const battle: BattleScene = createBattleScene({
    renderer,
    scene,
    maxUnits: 16,
    audio,
    models,
  });
  renderer.scene.add(battle.group);

  // --- Transporte: motor en worker ------------------------------------------
  const transport = await LocalTransport.create({
    spec: {
      players: setup.players.map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
      })),
      config: setup.config,
      seed: setup.seed,
      botPlayers: setup.botPlayers,
    },
    botDelayMs: options.botDelayMs ?? 700,
  });

  // --- HUD -------------------------------------------------------------------
  const nombres = (id: string): string => scene.data.byId.get(id)?.names[detectLocale()] ?? id;

  const hud: GameHud = createGameHud(options.hud, {
    nombres,
    adyacencia: scene.data.adjacency.byTerritory,
    rules: setup.config,
    botIds: new Set(setup.botPlayers),
    transport,
    busy: () => director.isBusy(),
    onSkip: () => director.skip(),
    onExit: () => {
      options.onExit?.();
    },
  });

  // --- Estado visual del tablero ---------------------------------------------
  // Empieza siendo el estado publico (dueños y ejercitos iniciales).
  let visual: BoardView | null = null;
  let ultimaRonda: BattleRoundResolved | null = null;
  /** Estado publico que llego mientras el director estaba ocupado. */
  let pendiente: PublicGameState | null = null;
  /** Marcha posterior a una conquista, pendiente de animar. */
  let marcha: { from: string; to: string; count: number } | null = null;
  /** Jugador del ultimo relevo mostrado. */
  let ultimoRelevo: string | null = null;

  const heat = createHeatModel();

  const aplicarVisual = (publico: PublicGameState): void => {
    visual = publico;
    scene.setGameState(publico);
  };

  const ancla = (territorio: string): { x: number; z: number } | undefined => {
    const entry = scene.data.byId.get(territorio);
    if (entry === undefined) return undefined;
    return scene.board.projection.toWorld(entry.labelAnchor[0], entry.labelAnchor[1]);
  };

  // --- Director de combate ----------------------------------------------------
  const director: CombatDirector = createCombatDirector({
    renderer,
    scene,
    battle,
    reducedMotion: options.reducedMotion,
    level: 'tactical',
    armiesOf: (territorio) => visual?.territories[territorio]?.armies ?? 0,
    colorOf: (territorio) => {
      const owner = visual?.territories[territorio]?.owner ?? null;
      const player = visual?.players.find((candidate) => candidate.id === owner);
      return player === undefined ? new Color('#c9d3ea') : playerColor(player.color);
    },
    anchorOf: ancla,
    onRoundApplied: (event) => {
      // La ronda se conto: los ejercitos quedan como los resolvio el motor.
      if (visual === null) return;
      visual = {
        ...visual,
        territories: {
          ...visual.territories,
          [event.from]: {
            owner: visual.territories[event.from]?.owner ?? null,
            armies: event.attackerArmiesAfter,
          },
          [event.to]: {
            owner: visual.territories[event.to]?.owner ?? null,
            armies: event.defenderArmiesAfter,
          },
        },
      };
      scene.setGameState(visual);
    },
    onConquered: (territorio) => {
      // La onda barrio el territorio: recien aca cambia el dueño. La vanguardia
      // (1 ejercito) ocupa el territorio; el movimiento grande llega con la
      // marcha, cuando el jugador elige cuantos mover.
      if (visual === null || ultimaRonda === null) return;
      const atacante = visual.territories[ultimaRonda.from]?.owner ?? null;
      visual = {
        ...visual,
        territories: {
          ...visual.territories,
          [territorio]: { owner: atacante, armies: 1 },
        },
      };
      scene.setGameState(visual);
      scene.focusTerritory(territorio, { distance: 260, polarDeg: 52, duration: 0.6 });
    },
  });

  director.onIdle(() => {
    audio.setAmbienceHeat(0);
    if (pendiente !== null) {
      aplicarVisual(pendiente);
      hud.render(pendiente);
      gestionarRelevo(pendiente);
      pendiente = null;
    }
    dispararMarcha();
  });

  /** Marcha de los ejercitos movidos tras una conquista (solo visual). */
  const dispararMarcha = (): void => {
    if (marcha === null) return;
    const { from, to, count } = marcha;
    marcha = null;
    const desde = ancla(from);
    const hacia = ancla(to);
    if (desde === undefined || hacia === undefined) return;
    const dueno = visual?.territories[to]?.owner ?? null;
    const player = visual?.players.find((candidate) => candidate.id === dueno);
    battle.playMarch({
      fromX: desde.x,
      fromZ: desde.z,
      toX: hacia.x,
      toZ: hacia.z,
      count,
      color: player === undefined ? new Color('#c9d3ea') : playerColor(player.color),
      profile: SPECTACLE_PROFILES.tactical,
      onComplete: () => {},
    });
  };

  // --- Relevo (hot-seat) -------------------------------------------------------
  // El relevo existe para que un jugador humano no vea las tarjetas ni la mision
  // del humano anterior. Con un solo humano no hay nada que ocultar entre
  // jugadores: con 0 humanos (solo bots) tampoco. Por eso se muestra unicamente
  // cuando hay 2 o mas humanos y el turno cae en uno distinto del ultimo.
  const humanosIds = setup.players
    .filter((player) => !setup.botPlayers.includes(player.id))
    .map((player) => player.id);
  const hayRelevo = humanosIds.length >= 2;

  const gestionarRelevo = (publico: PublicGameState): void => {
    if (!hayRelevo || publico.phase === 'game-over') {
      ocultarRelevo(options.relevo);
      ultimoRelevo = null;
      return;
    }
    if (setup.botPlayers.includes(publico.activePlayer)) {
      // Turno de un bot: se ve el tablero, no hace falta ocultar nada.
      ocultarRelevo(options.relevo);
      ultimoRelevo = null;
      return;
    }
    if (ultimoRelevo === publico.activePlayer) return;
    const jugador = publico.players.find((player) => player.id === publico.activePlayer);
    if (jugador === undefined) return;
    ultimoRelevo = jugador.id;
    mostrarRelevo(options.relevo, {
      playerName: jugador.name,
      color: jugador.color,
      turno: publico.turn,
      onReady: () => ocultarRelevo(options.relevo),
    });
  };

  // --- Cableado de eventos ------------------------------------------------------
  const aplicarCalor = (eventos: readonly GameEvent[]): void => {
    if (heat.apply(eventos)) scene.setHeat(new Map(heat.entries()));
    for (let i = eventos.length - 1; i >= 0; i -= 1) {
      const evento = eventos[i];
      if (evento === undefined) continue;
      if (evento.type === 'TERRITORY_CONQUERED') {
        audio.setAmbienceHeat(heat.get(evento.territory));
        return;
      }
      if (evento.type === 'BATTLE_ROUND_RESOLVED') {
        audio.setAmbienceHeat(heat.get(evento.to));
        return;
      }
    }
  };

  transport.onEvents((eventos) => {
    hud.eventos(eventos);
    aplicarCalor(eventos);
    for (const evento of eventos) {
      if (evento.type === 'BATTLE_ROUND_RESOLVED') ultimaRonda = evento;
      // La marcha se anima cuando el movimiento ya esta aplicado (fase attack).
      if (evento.type === 'ARMIES_MOVED' && marcha === null) {
        marcha = { from: evento.from, to: evento.to, count: evento.count };
      }
    }
    director.enqueue(eventos);
    if (!director.isBusy()) dispararMarcha();
  });

  transport.onState((publico) => {
    if (director.isBusy()) {
      // El tablero espera a que la coreografia alcance al motor.
      pendiente = publico;
      return;
    }
    aplicarVisual(publico);
    hud.render(publico);
    gestionarRelevo(publico);
  });

  transport.onError((mensaje) => {
    console.warn('[local]', mensaje);
  });

  // --- Primer pintado -------------------------------------------------------------
  const inicial = transport.getState();
  if (inicial !== null) {
    aplicarVisual(inicial);
    hud.render(inicial);
    gestionarRelevo(inicial);
  }

  // --- Loop -------------------------------------------------------------------------
  // `onFrame` no devuelve baja: los listeners los limpia `renderer.dispose()`.
  renderer.onFrame((delta) => {
    scene.update(delta);
    director.update(delta);
  });

  return {
    dispose(): void {
      window.removeEventListener('pointerdown', desbloquear);
      window.removeEventListener('keydown', desbloquear);
      director.dispose();
      battle.dispose();
      scene.dispose();
      audio.dispose();
      transport.dispose();
      hud.dispose();
      renderer.dispose();
    },
  };
}
