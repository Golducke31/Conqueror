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
import type { TerritoryId } from '@conqueror/shared';

import { detectLocale, setLocale, t } from '../../app/i18n.js';
import { playerColor } from '../../app/palette.js';
import { createAudioManager } from '../../render/combat/audio/audioManager.js';
import { createBattleScene, type BattleScene } from '../../render/combat/BattleScene.js';
import { createCombatDirector, type CombatDirector } from '../../render/combat/CombatDirector.js';
import { createHeatModel } from '../../render/combat/heat/heatModel.js';
import { SPECTACLE_PROFILES } from '../../render/combat/spectacle.js';
import { createUnitModels, type UnitModels } from '../../render/tokens/models/unitModels.js';
import { createRenderer, type RendererHandle } from '../../render/renderer.js';
import { createGameScene, type GameScene, type BoardView } from './GameScene.js';
import {
  dadosMaximos,
  resolverClic,
  SIN_SELECCION,
  type PickContext,
  type SelectionState,
} from './selectionModel.js';
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
  /** Ultimo estado que se pinto (para no repintar lo mismo). */
  let estadoPintado: PublicGameState | null = null;
  /** Hay eventos nuevos que el HUD todavia no volco a la pantalla. */
  let eventosSinPintar = false;
  /** Ultima ocupacion del director que se reflejo en el HUD. */
  let estadoOcupado = false;

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
    // Se repinta SIEMPRE con el estado mas reciente, no solo si quedo uno
    // pendiente: los eventos del combate llegan al HUD por `hud.eventos` y el
    // registro solo se vuelca a la pantalla en el proximo render. Sin esto, la
    // ultima batalla no aparecia en el registro hasta el siguiente cambio de
    // fase (justo cuando el jugador se queda mirando el resultado).
    const actual = pendiente ?? transport.getState();
    pendiente = null;
    if (actual !== null) aplicarEstado(actual);
    dispararMarcha();
  });
  // --- Seleccion: mapa, HUD y motor -------------------------------------------
  // El mapa no decide nada: avisa que territorio se toco y aca se resuelve la
  // intencion contra el estado PUBLICO del motor (`selectionModel`). Asi el
  // clic y los botones del HUD no pueden divergir, y el mapa solo dibuja lo que
  // este controlador le dice.
  let seleccion: SelectionState = SIN_SELECCION;

  const aplicarSeleccion = (nueva: SelectionState): void => {
    if (nueva.origin === seleccion.origin && nueva.target === seleccion.target) return;
    seleccion = nueva;
    scene.setSelection(nueva);
    hud.setSelection(nueva);
  };

  /** Contexto de reglas para resolver un clic, con el estado real del motor. */
  const contextoPick = (publico: PublicGameState): PickContext => ({
    phase: publico.phase,
    activePlayer: publico.activePlayer,
    territories: publico.territories,
    adjacency: scene.data.adjacency.byTerritory,
    rules: setup.config,
    selection: seleccion,
  });

  scene.onPick((territory) => {
    const publico = transport.getState();
    // Durante la animacion de combate el estado del tablero va por detras: un
    // clic nuevo se resolveria contra datos viejos.
    if (publico === null || director.isBusy()) return;

    const ctx = contextoPick(publico);
    const intencion = resolverClic(ctx, territory);

    switch (intencion.kind) {
      case 'none':
        return;

      case 'clear':
        hud.setFocus(null);
        aplicarSeleccion(SIN_SELECCION);
        return;

      case 'inspect':
        // Mostrar el nombre y el dueno del territorio tocado sin elegirlo: es
        // el caso del enemigo al que todavia no se puede atacar.
        hud.setFocus(intencion.territory);
        return;

      case 'select-origin':
        hud.setFocus(null);
        aplicarSeleccion({ origin: intencion.territory, target: null });
        return;

      case 'select-target':
        aplicarSeleccion({ origin: seleccion.origin, target: intencion.territory });
        return;

      case 'attack': {
        const ejercitos = ctx.territories[intencion.from]?.armies ?? 0;
        // Se deja el destino fijado: la flecha queda sobre el frente elegido y
        // repetir el ataque es otro clic en el mismo lugar.
        aplicarSeleccion({ origin: intencion.from, target: intencion.to });
        void transport.send({
          type: 'ATTACK',
          from: intencion.from,
          to: intencion.to,
          dice: dadosMaximos(ejercitos, setup.config),
        });
        return;
      }

      case 'invalid':
        hud.aviso(motivoAviso(intencion.reason, ctx, territory));
        return;

      default:
        return;
    }
  });

  /** Texto del aviso para un clic que no se pudo ejecutar. */
  function motivoAviso(
    motivo: 'not-adjacent' | 'not-reachable' | 'no-armies' | 'not-own',
    ctx: PickContext,
    territory: TerritoryId | null,
  ): string {
    const destino = territory === null ? '' : nombres(territory);
    const origen = seleccion.origin === null ? '' : nombres(seleccion.origin);
    switch (motivo) {
      case 'not-adjacent':
        return t('aviso.noVecino', { destino, origen });
      case 'not-reachable':
        return t('aviso.noAlcanzable', { destino });
      case 'no-armies': {
        const min = ctx.rules.combat.minArmiesPerTerritory;
        return t('aviso.sinEjercitos', { min, origen });
      }
      case 'not-own':
      default:
        return t('aviso.noVecino', { destino, origen });
    }
  }

  // El mapa dibuja el hover y el HUD lo escribe: un solo lugar por dato.
  scene.onHover((territory) => hud.setHover(territory));

  // La probabilidad que calcula el mapa al apuntar un enemigo se muestra en el
  // mismo renglon: el jugador decide antes de hacer clic, no despues.
  scene.onAttackOdds((info) => hud.setAttackOdds(info?.probability ?? null));

  // Los chips del HUD tambien cambian la seleccion: el mapa tiene que seguirlos.
  hud.onSelection((nueva) => {
    seleccion = nueva;
    scene.setSelection(nueva);
  });

  /**
   * Limpia lo que dejo de tener sentido tras un cambio de estado: si el origen
   * ya no es propio, si se salio de la fase de accion o si el destino dejo de
   * ser atacable, la seleccion se cae en vez de quedar mintiendo.
   */
  const sanearSeleccion = (publico: PublicGameState): void => {
    if (seleccion.origin === null) return;
    if (publico.phase !== 'attack' && publico.phase !== 'regroup') {
      aplicarSeleccion(SIN_SELECCION);
      return;
    }
    const origen = publico.territories[seleccion.origin];
    if (origen === undefined || origen.owner !== publico.activePlayer) {
      aplicarSeleccion(SIN_SELECCION);
      return;
    }
    if (seleccion.target === null) return;
    const destino = publico.territories[seleccion.target];
    const sigueValido =
      destino !== undefined &&
      (publico.phase === 'regroup'
        ? destino.owner === publico.activePlayer
        : destino.owner !== publico.activePlayer);
    if (!sigueValido) aplicarSeleccion({ origin: seleccion.origin, target: null });
  };

  /**
   * Un solo camino para pintar un estado publico: tablero, seleccion, HUD y
   * relevo. Si se aplicaran en orden distinto segun el llamador, el mapa y el
   * HUD podrian quedar mostrando fases diferentes.
   *
   * Se descarta el trabajo repetido: `director.onIdle` se dispara en cada frame
   * mientras no hay nada animandose, y repintar el HUD a 60 fps rompe la
   * interfaz (los elementos se recrean todo el tiempo). Un estado se pinta una
   * vez, salvo que haya eventos nuevos que volcar en el registro.
   */
  const aplicarEstado = (publico: PublicGameState): void => {
    const ocupado = director.isBusy();
    const estadoNuevo = publico !== estadoPintado || eventosSinPintar;
    // El director avisa que termino antes de que la escena de batalla cierre
    // del todo: si el HUD se pintara solo con estados nuevos, quedaria con los
    // botones deshabilitados hasta el proximo cambio de fase.
    const cambioOcupacion = ocupado !== estadoOcupado;

    if (estadoNuevo) {
      estadoPintado = publico;
      eventosSinPintar = false;
      aplicarVisual(publico);
      sanearSeleccion(publico);
    }
    estadoOcupado = ocupado;

    if (estadoNuevo || cambioOcupacion) {
      hud.render(publico);
      gestionarRelevo(publico);
    }
  };

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
    // El registro crece fuera del render: hay que volver a pintarlo aunque el
    // estado no cambie (si no, la ultima batalla no aparece hasta la proxima
    // fase).
    eventosSinPintar = true;
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
    aplicarEstado(publico);
  });

  transport.onError((mensaje) => {
    console.warn('[local]', mensaje);
  });

  // --- Primer pintado -------------------------------------------------------------
  const inicial = transport.getState();
  if (inicial !== null) {
    aplicarEstado(inicial);
  }

  // Gancho de pruebas: con `?debug=1` se puede preguntar donde cae un
  // territorio en pantalla para hacer clic sobre el mapa de verdad desde el
  // smoke test, sin adivinar coordenadas.
  if (options.debug === true) {
    (window as unknown as { __conqueror?: unknown }).__conqueror = {
      screenOf: (territory: TerritoryId): { x: number; y: number } | null =>
        scene.screenPosition(territory),
    };
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
