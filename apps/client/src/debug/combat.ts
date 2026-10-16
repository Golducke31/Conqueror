/**
 * Sandbox de combate (`/debug/combat`).
 *
 * Herramienta de desarrollo, no pantalla de juego: permite disparar una ronda
 * entre dos territorios vecinos sin jugar una partida, elegir los ejércitos de
 * cada bando, el nivel de espectáculo y el tipo de enlace.
 *
 * En C3 ademas se ve la secuencia completa de la conquista: ronda final,
 * onda de cambio de dueño con estandarte, y la marcha posterior de los
 * ejercitos que el jugador decide mover (la dispara el boton, no el director).
 *
 * En C5 la escena suena: el `AudioManager` (audio/audioManager.ts) se crea aca
 * y se le pasa a la escena de batalla. Arranca mudo —no hay archivos en el
 * manifiesto— y el panel muestra el registro en vivo de las senales emitidas
 * en cada momento de la coreografia, para sincronizar sonidos aunque todavia
 * no existan (plan de combate, seccion 15).
 *
 * OJO: aca los eventos estan SIMULADOS. El motor de reglas de verdad llega en el
 * Hito 3; cuando exista, el sandbox pasa a pedirle los eventos a `apply()` y
 * este simulador se borra.
 */

import '../styles/main.css';

import { Color, Vector3 } from 'three';
import type { BattleRoundResolved, GameEvent } from '@conqueror/rules';
import { estimateBattleOdds } from '@conqueror/rules';
import { DEFAULT_RULES_CONFIG } from '@conqueror/shared';
import { pairKey } from '@conqueror/map-data';
import { t } from '../app/i18n.js';
import { createMockGameState, createSeededRandom, type MockGameState } from '../app/fixtures.js';
import { playerColor } from '../app/palette.js';
import { createRenderer } from '../render/renderer.js';
import { createBattleScene } from '../render/combat/BattleScene.js';
import { createCombatDirector } from '../render/combat/CombatDirector.js';
import { SPECTACLE_PROFILES, type SpectacleLevel } from '../render/combat/spectacle.js';
import { createHeatModel } from '../render/combat/heat/heatModel.js';
import { createAudioManager, type CueLogEntry } from '../render/combat/audio/audioManager.js';
import { createGameScene } from '../scenes/game/GameScene.js';

function nodo(etiqueta: string, clase: string, texto?: string): HTMLElement {
  const element = document.createElement(etiqueta);
  element.className = clase;
  if (texto !== undefined) element.textContent = texto;
  return element;
}

function opcion(value: string, label: string): HTMLOptionElement {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = label;
  return element;
}

/**
 * Simulador de una ronda. Es un reemplazo temporal del motor:
 * atacante hasta 3 dados, defensor hasta 2, empate para el defensor.
 */
function simulateRound(
  from: string,
  to: string,
  attackerArmies: number,
  defenderArmies: number,
  random: () => number,
): BattleRoundResolved {
  const attackerCount = Math.max(1, Math.min(3, attackerArmies - 1));
  const defenderCount = Math.max(1, Math.min(2, defenderArmies));

  const roll = (count: number): number[] =>
    Array.from({ length: count }, () => 1 + Math.floor(random() * 6)).sort((a, b) => b - a);

  const attackerDice = roll(attackerCount);
  const defenderDice = roll(defenderCount);

  const pairs = Math.min(attackerDice.length, defenderDice.length);
  const comparisons: {
    attackerDie: number;
    defenderDie: number;
    winner: 'attacker' | 'defender';
  }[] = [];
  let attackerLosses = 0;
  let defenderLosses = 0;

  for (let index = 0; index < pairs; index += 1) {
    const attackerDie = attackerDice[index] ?? 0;
    const defenderDie = defenderDice[index] ?? 0;
    const winner = attackerDie > defenderDie ? 'attacker' : 'defender';
    comparisons.push({ attackerDie, defenderDie, winner });
    if (winner === 'attacker') defenderLosses += 1;
    else attackerLosses += 1;
  }

  return {
    type: 'BATTLE_ROUND_RESOLVED',
    from,
    to,
    attackerDice,
    defenderDice,
    comparisons,
    attackerLosses,
    defenderLosses,
    attackerArmiesAfter: Math.max(0, attackerArmies - attackerLosses),
    defenderArmiesAfter: Math.max(0, defenderArmies - defenderLosses),
  };
}

async function main(): Promise<void> {
  const canvas = document.getElementById('lienzo');
  const hud = document.getElementById('hud');
  if (!(canvas instanceof HTMLCanvasElement) || hud === null) {
    throw new Error('Falta el lienzo o el HUD');
  }

  const params = new URLSearchParams(window.location.search);
  const renderer = createRenderer(canvas);

  // Audio: el manager arranca mudo (no hay archivos en el manifiesto) y suena
  // recien cuando el usuario los agrega. El paneo se calcula con la camara.
  const audio = createAudioManager({
    debug: params.get('debug') === '1',
    panOf: (mundo) => {
      const punto = new Vector3(mundo.x, mundo.y, mundo.z);
      const direccion = new Vector3();
      renderer.camera.getWorldDirection(direccion);
      // Detras de la camara no hay paneo: va al centro.
      if (punto.clone().sub(renderer.camera.position).dot(direccion) <= 0) return 0;
      punto.project(renderer.camera);
      return punto.x;
    },
    onCue: (entrada) => mostrarSenal(entrada),
  });
  void audio.load();

  // Politica de autoplay: el contexto arranca bloqueado y se desbloquea con
  // el primer gesto del usuario.
  const desbloquear = (): void => {
    void audio.unlock();
    window.removeEventListener('pointerdown', desbloquear);
    window.removeEventListener('keydown', desbloquear);
  };
  window.addEventListener('pointerdown', desbloquear);
  window.addEventListener('keydown', desbloquear);

  const scene = await createGameScene({
    renderer,
    canvas,
    reducedMotion: false,
    mapMaxUnits: 5,
    rules: DEFAULT_RULES_CONFIG,
  });
  renderer.scene.add(scene.group);

  const random = createSeededRandom(90210);
  let gameState: MockGameState = createMockGameState({
    territoryIds: scene.board.territoryIds,
    neighbors: scene.data.adjacency.byTerritory,
    playerCount: 4,
    seed: 4242,
  });
  scene.setGameState(gameState);

  // Frente caliente: se deriva del log de eventos (acá, los simulados) y se
  // refleja en el shader del tablero. Es solo visual.
  const heat = createHeatModel();
  const aplicarCalor = (eventos: readonly GameEvent[]): void => {
    if (heat.apply(eventos)) scene.setHeat(new Map(heat.entries()));
    // Ambiente: el calor del territorio batallado cruza las capas de sonido.
    audio.setAmbienceHeat(calorBatalla(eventos));
  };

  /** Calor del ultimo territorio que mencionan los eventos (el campo de batalla). */
  function calorBatalla(eventos: readonly GameEvent[]): number {
    for (let i = eventos.length - 1; i >= 0; i -= 1) {
      const evento = eventos[i];
      if (evento === undefined) continue;
      if (evento.type === 'TERRITORY_CONQUERED') return heat.get(evento.territory);
      if (evento.type === 'BATTLE_ROUND_RESOLVED') return heat.get(evento.to);
    }
    return 0;
  }

  const battle = createBattleScene({ renderer, scene, maxUnits: 16, audio });
  renderer.scene.add(battle.group);

  let lastRound: BattleRoundResolved | null = null;
  /** Conquista en curso: el estandarte esta plantado y falta la marcha. */
  let conquista: { readonly from: string; readonly to: string } | null = null;
  /** Marcha de ejercitos en curso (la dispara el boton, no el director). */
  let marching = false;

  const director = createCombatDirector({
    renderer,
    scene,
    battle,
    reducedMotion: false,
    level: 'tactical',
    armiesOf: (territory) => gameState.territories[territory]?.armies ?? 0,
    colorOf: (territory) => {
      const owner = gameState.territories[territory]?.owner ?? null;
      const player = gameState.players.find((candidate) => candidate.id === owner);
      return player === undefined ? new Color('#c9d3ea') : playerColor(player.color);
    },
    anchorOf: (territory) => {
      const entry = scene.data.byId.get(territory);
      if (entry === undefined) return undefined;
      return scene.board.projection.toWorld(entry.labelAnchor[0], entry.labelAnchor[1]);
    },
    onRoundApplied: (event) => {
      const fromState = gameState.territories[event.from];
      const toState = gameState.territories[event.to];
      if (fromState === undefined || toState === undefined) return;
      gameState = {
        ...gameState,
        territories: {
          ...gameState.territories,
          [event.from]: { ...fromState, armies: event.attackerArmiesAfter },
          [event.to]: { ...toState, armies: event.defenderArmiesAfter },
        },
      };
      scene.setGameState(gameState);
      lastRound = event;
      actualizarPanel();
    },
    onConquered: (territory) => {
      // La onda ya barrio el territorio: recien aca se aplica el dueno nuevo.
      const pair = lastRound;
      if (pair === null) return;
      const fromState = gameState.territories[pair.from];
      const toState = gameState.territories[territory];
      if (fromState === undefined || toState === undefined) return;
      gameState = {
        ...gameState,
        territories: {
          ...gameState.territories,
          // Una vanguardia ocupa el territorio; el resto de los atacantes
          // queda en el origen, listo para la marcha.
          [territory]: { ...toState, owner: fromState.owner, armies: 1 },
        },
      };
      scene.setGameState(gameState);
      conquista = { from: pair.from, to: territory };
      scene.focusTerritory(territory, { distance: 260, polarDeg: 52, duration: 0.6 });
      actualizarPanel();
    },
  });

  renderer.onFrame((delta) => {
    scene.update(delta);
    director.update(delta);
  });

  // Cuando el director queda libre se refresca el panel: la fila de marcha
  // habilita su boton recien cuando la secuencia de conquista termino. El
  // ambiente se apaga: ya no hay batalla en curso.
  director.onIdle(() => {
    audio.setAmbienceHeat(0);
    actualizarPanel();
  });

  // ---- Interfaz -----------------------------------------------------------

  const panel = nodo(
    'section',
    'pointer-events-auto absolute left-3 top-3 w-80 rounded-lg border border-lana-3/70 bg-lana/90 p-4 text-sm shadow-xl shadow-hilo/60 backdrop-blur',
  );

  panel.append(
    nodo('h1', 'font-display text-base text-qolli', t('sandbox.titulo')),
    nodo('p', 'mt-1 text-[11px] leading-relaxed text-algodon/50', t('sandbox.ayuda')),
  );

  const grid = nodo('div', 'mt-3 grid grid-cols-2 gap-2');

  const selectorOrigen = document.createElement('select');
  const selectorDestino = document.createElement('select');
  for (const selector of [selectorOrigen, selectorDestino]) {
    selector.className =
      'w-full rounded border border-lana-3 bg-hilo/80 px-2 py-1 text-xs text-algodon';
  }

  const inputAtacante = document.createElement('input');
  const inputDefensor = document.createElement('input');
  for (const input of [inputAtacante, inputDefensor]) {
    input.type = 'number';
    input.min = '2';
    input.max = '40';
    input.className =
      'w-full rounded border border-lana-3 bg-hilo/80 px-2 py-1 text-xs text-algodon';
  }
  inputAtacante.value = '12';
  inputDefensor.value = '8';

  const selectorNivel = document.createElement('select');
  selectorNivel.className =
    'col-span-2 w-full rounded border border-lana-3 bg-hilo/80 px-2 py-1 text-xs text-algodon';
  for (const [value, label] of [
    ['fast', 'Rápido'],
    ['tactical', 'Táctico'],
    ['cinematic', 'Cinemático'],
  ] as const) {
    selectorNivel.append(opcion(value, label));
  }
  selectorNivel.value = 'tactical';

  // Calidad reducida forzada: sirve para VER la calidad adaptativa sin tener
  // que esperar a que baje el FPS de verdad.
  const checkCalidad = document.createElement('input');
  checkCalidad.type = 'checkbox';
  checkCalidad.className = 'h-3.5 w-3.5 accent-grana';
  const filaCalidad = nodo(
    'label',
    'col-span-2 flex items-center gap-2 text-[11px] text-algodon/60',
  );
  filaCalidad.append(checkCalidad, nodo('span', '', t('sandbox.calidadForzada')));

  // Silencio rapido para el sandbox (los volumenes finos estan en /debug/sounds).
  const checkSilencio = document.createElement('input');
  checkSilencio.type = 'checkbox';
  checkSilencio.className = 'h-3.5 w-3.5 accent-grana';
  const filaSilencio = nodo(
    'label',
    'col-span-2 flex items-center gap-2 text-[11px] text-algodon/60',
  );
  filaSilencio.append(checkSilencio, nodo('span', '', t('sandbox.silencio')));

  const campo = (label: string, control: HTMLElement): HTMLElement => {
    const box = nodo('label', 'flex flex-col gap-1');
    box.append(
      nodo('span', 'text-[11px] uppercase tracking-wider text-algodon/50', label),
      control,
    );
    return box;
  };

  grid.append(
    campo(t('sandbox.origen'), selectorOrigen),
    campo(t('sandbox.destino'), selectorDestino),
    campo(t('sandbox.atacante'), inputAtacante),
    campo(t('sandbox.defensor'), inputDefensor),
    campo(t('sandbox.nivel'), selectorNivel),
    filaCalidad,
    filaSilencio,
  );
  panel.append(grid);

  const info = nodo('p', 'mt-3 text-[11px] leading-relaxed text-algodon/60');
  panel.append(info);

  // Registro en vivo de las senales de audio: sirve para sincronizar sonidos
  // aunque todavia no existan los archivos (plan de combate, seccion 15).
  const registro = nodo(
    'div',
    'mt-1 max-h-24 overflow-y-auto rounded border border-lana-3/60 bg-hilo/60 p-2 font-mono text-[10px] leading-relaxed text-algodon/70',
  );
  panel.append(
    nodo('div', 'mt-3 text-[11px] uppercase tracking-wider text-algodon/50', t('sounds.titulo')),
    registro,
  );

  function mostrarSenal(entrada: CueLogEntry): void {
    registro.prepend(nodo('div', '', `${entrada.slot} → ${t(`sounds.estado.${entrada.status}`)}`));
    while (registro.childElementCount > 8) registro.lastElementChild?.remove();
  }

  const acciones = nodo('div', 'mt-3 flex flex-wrap gap-2');
  const boton = (label: string, primario = false): HTMLButtonElement => {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.className = primario
      ? 'rounded border border-qolli bg-qolli/20 px-3 py-1 text-xs font-semibold text-qolli hover:bg-qolli/30'
      : 'rounded border border-lana-3 px-3 py-1 text-xs text-algodon/80 hover:border-qolli hover:text-qolli';
    return element;
  };

  const botonRonda = boton(t('sandbox.ronda'), true);
  const botonConquistar = boton(t('sandbox.conquistar'));
  const botonSaltar = boton(t('sandbox.saltar'));
  const botonReiniciar = boton(t('sandbox.reiniciar'));
  acciones.append(botonRonda, botonConquistar, botonSaltar, botonReiniciar);
  panel.append(acciones);

  // ---- Marcha posterior a la conquista ------------------------------------
  // Aparece cuando el estandarte esta plantado: el jugador elige cuantos
  // ejercitos mover del territorio de origen al conquistado.

  const filaMover = nodo(
    'div',
    'mt-3 hidden items-center gap-2 rounded border border-grana/60 bg-hilo/60 p-2',
  );
  const inputMover = document.createElement('input');
  inputMover.type = 'number';
  inputMover.min = '1';
  inputMover.className =
    'w-16 rounded border border-lana-3 bg-hilo/80 px-2 py-1 text-xs text-algodon';
  const botonMover = boton(t('sandbox.mover'));
  filaMover.append(
    nodo('span', 'text-[11px] uppercase tracking-wider text-algodon/50', t('sandbox.aMover')),
    inputMover,
    botonMover,
  );
  panel.append(filaMover);

  hud.append(panel);

  /** Pares adyacentes, para no ofrecer combinaciones invalidas. */
  const pares = scene.data.adjacency.edges.map(([a, b]) => ({ a, b }));

  function nombreDe(id: string): string {
    return scene.data.byId.get(id)?.names['es-AR'] ?? id;
  }

  /** El director esta ocupado o hay una marcha en curso: nada se dispara. */
  function ocupado(): boolean {
    return director.isBusy() || marching;
  }

  function actualizarPanel(): void {
    const pendientes = director.pending();
    const lineas = [`${t('sandbox.pendientes')}: ${pendientes}`];
    if (lastRound !== null) {
      lineas.push(
        `${t('sandbox.dados')}: [${lastRound.attackerDice.join(' ')}] vs [${lastRound.defenderDice.join(' ')}]`,
      );
      lineas.push(
        `${nombreDe(lastRound.from)}: ${lastRound.attackerArmiesAfter} · ${nombreDe(lastRound.to)}: ${lastRound.defenderArmiesAfter}`,
      );
    }
    // Probabilidad estimada de conquista con los ejércitos elegidos: la calcula
    // el motor de reglas (cadena de Markov exacta) y no decide nada.
    const atacante = Math.max(2, Number(inputAtacante.value) || 2);
    const defensor = Math.max(1, Number(inputDefensor.value) || 1);
    const odds = estimateBattleOdds(atacante, defensor, DEFAULT_RULES_CONFIG);
    lineas.push(`${t('sandbox.probabilidad')}: ${Math.round(odds.winProbability * 100)}%`);
    // Calor del frente elegido: lo deriva el modelo del log de eventos y lo
    // consume el shader del tablero (oscurecer, humo y brasas en los bordes).
    lineas.push(
      `${t('debug.calor')}: ${(heat.get(selectorOrigen.value) ?? 0).toFixed(2)} / ${(
        heat.get(selectorDestino.value) ?? 0
      ).toFixed(2)}`,
    );
    // Calidad efectiva (automática por FPS o forzada por el casillero).
    const calidad = battle.quality();
    lineas.push(
      `${t('sandbox.calidad')}: ${calidad.degraded ? t('sandbox.calidad.reducida') : t('sandbox.calidad.plena')}` +
        ` (${calidad.unitCap} u, x${calidad.particleScale.toFixed(2)})`,
    );
    info.textContent = lineas.join('\n');
    info.style.whiteSpace = 'pre-line';

    if (conquista !== null) {
      const disponibles = (gameState.territories[conquista.from]?.armies ?? 1) - 1;
      filaMover.classList.remove('hidden');
      filaMover.classList.add('flex');
      inputMover.max = String(Math.max(1, disponibles));
      inputMover.value = String(Math.max(1, Math.min(disponibles, 2)));
      // Mientras la secuencia de conquista se funde, el director sigue
      // ocupado: el boton espera.
      botonMover.disabled = disponibles < 1 || ocupado();
    } else {
      filaMover.classList.add('hidden');
      filaMover.classList.remove('flex');
    }
  }

  function llenarDestinos(): void {
    const origen = selectorOrigen.value;
    selectorDestino.replaceChildren();
    for (const par of pares) {
      if (par.a !== origen && par.b !== origen) continue;
      const otro = par.a === origen ? par.b : par.a;
      const front = scene.data.frontByPair.get(pairKey(par.a, par.b));
      const sufijo = front?.kind === 'sea' ? ` · ${t('sandbox.maritimo')}` : '';
      selectorDestino.append(opcion(otro, `${nombreDe(otro)}${sufijo}`));
    }
  }

  function llenarOrigenes(): void {
    selectorOrigen.replaceChildren();
    const vistos = new Set<string>();
    for (const par of pares) {
      for (const id of [par.a, par.b]) {
        if (vistos.has(id)) continue;
        vistos.add(id);
        selectorOrigen.append(opcion(id, nombreDe(id)));
      }
    }
  }

  function paresDisponibles(): void {
    llenarOrigenes();

    // Se busca un par de territorios VECINOS con duenos distintos: una batalla
    // entre dos territorios del mismo jugador no se lee.
    const distinto = pares.find(
      (par) =>
        gameState.territories[par.a]?.owner !== undefined &&
        gameState.territories[par.a]?.owner !== gameState.territories[par.b]?.owner,
    );
    const preferido = distinto?.a ?? 'brasil';
    if ([...selectorOrigen.options].some((option) => option.value === preferido)) {
      selectorOrigen.value = preferido;
    }
    llenarDestinos();

    if (distinto !== undefined) {
      const otro = distinto.a === selectorOrigen.value ? distinto.b : distinto.a;
      if ([...selectorDestino.options].some((option) => option.value === otro)) {
        selectorDestino.value = otro;
      }
    }
    actualizarPanel();
  }

  selectorOrigen.addEventListener('change', () => {
    llenarDestinos();
    actualizarPanel();
  });

  // Cambiar los ejércitos actualiza la probabilidad estimada del panel.
  inputAtacante.addEventListener('change', () => actualizarPanel());
  inputDefensor.addEventListener('change', () => actualizarPanel());

  selectorNivel.addEventListener('change', () => {
    director.setLevel(selectorNivel.value as SpectacleLevel);
  });

  checkCalidad.addEventListener('change', () => {
    if (checkCalidad.checked) {
      // Manual: unidades y partículas recortadas, automático suspendido.
      battle.setAdaptiveQuality(false);
      battle.setQuality({ unitCap: 4, particleScale: 0.3 });
    } else {
      battle.setAdaptiveQuality(true);
    }
    actualizarPanel();
  });

  checkSilencio.addEventListener('change', () => audio.setMuted(checkSilencio.checked));

  botonRonda.addEventListener('click', () => {
    if (ocupado()) return;
    const from = selectorOrigen.value;
    const to = selectorDestino.value;
    const attackerArmies = Math.max(2, Number(inputAtacante.value) || 2);
    const defenderArmies = Math.max(1, Number(inputDefensor.value) || 1);

    const fromState = gameState.territories[from];
    const toState = gameState.territories[to];
    if (fromState === undefined || toState === undefined) return;

    const event = simulateRound(from, to, attackerArmies, defenderArmies, random);
    const eventos: GameEvent[] = [event];
    if (event.defenderArmiesAfter === 0) {
      eventos.push({ type: 'TERRITORY_CONQUERED', territory: to });
    }
    aplicarCalor(eventos);
    director.enqueue(eventos);
  });

  botonConquistar.addEventListener('click', () => {
    if (ocupado()) return;
    const from = selectorOrigen.value;
    const to = selectorDestino.value;
    const fromState = gameState.territories[from];
    const toState = gameState.territories[to];
    if (fromState === undefined || toState === undefined) return;

    // Deja al defensor en 1 y dispara una ultima ronda, para ver la conquista.
    gameState = {
      ...gameState,
      territories: { ...gameState.territories, [to]: { ...toState, armies: 1 } },
    };
    scene.setGameState(gameState);

    const event: BattleRoundResolved = {
      type: 'BATTLE_ROUND_RESOLVED',
      from,
      to,
      attackerDice: [6],
      defenderDice: [2],
      comparisons: [{ attackerDie: 6, defenderDie: 2, winner: 'attacker' }],
      attackerLosses: 0,
      defenderLosses: 1,
      attackerArmiesAfter: Math.max(2, fromState.armies),
      defenderArmiesAfter: 0,
    };
    const eventos: GameEvent[] = [event, { type: 'TERRITORY_CONQUERED', territory: to }];
    aplicarCalor(eventos);
    director.enqueue(eventos);
  });

  botonMover.addEventListener('click', () => {
    if (conquista === null || ocupado()) return;
    const from = conquista.from;
    const to = conquista.to;
    const disponibles = (gameState.territories[from]?.armies ?? 1) - 1;
    const count = Math.max(1, Math.min(disponibles, Math.floor(Number(inputMover.value) || 1)));
    if (disponibles < 1) return;

    const fromAnchor = scene.board.projection.toWorld(
      scene.data.byId.get(from)?.labelAnchor[0] ?? 0,
      scene.data.byId.get(from)?.labelAnchor[1] ?? 0,
    );
    const toAnchor = scene.board.projection.toWorld(
      scene.data.byId.get(to)?.labelAnchor[0] ?? 0,
      scene.data.byId.get(to)?.labelAnchor[1] ?? 0,
    );

    marching = true;
    actualizarPanel();

    battle.playMarch({
      fromX: fromAnchor.x,
      fromZ: fromAnchor.z,
      toX: toAnchor.x,
      toZ: toAnchor.z,
      count,
      color: playerColor(
        gameState.players.find((player) => player.id === gameState.territories[to]?.owner)?.color ??
          'rojo',
      ),
      profile: SPECTACLE_PROFILES[selectorNivel.value as SpectacleLevel],
      onComplete: () => {
        // La marcha llego: los ejercitos se mueven de verdad.
        const fromState = gameState.territories[from];
        const toState = gameState.territories[to];
        if (fromState !== undefined && toState !== undefined) {
          gameState = {
            ...gameState,
            territories: {
              ...gameState.territories,
              [from]: { ...fromState, armies: Math.max(1, fromState.armies - count) },
              [to]: { ...toState, armies: toState.armies + count },
            },
          };
          scene.setGameState(gameState);
        }
        conquista = null;
        marching = false;
        actualizarPanel();
      },
    });
  });

  botonSaltar.addEventListener('click', () => director.skip());

  botonReiniciar.addEventListener('click', () => {
    director.skip();
    gameState = createMockGameState({
      territoryIds: scene.board.territoryIds,
      neighbors: scene.data.adjacency.byTerritory,
      playerCount: 4,
      seed: 4242,
    });
    scene.setGameState(gameState);
    heat.reset();
    scene.setHeat(new Map());
    audio.setAmbienceHeat(0);
    lastRound = null;
    conquista = null;
    marching = false;
    paresDisponibles();
    scene.focusPoint(0, 0, { distance: 1020, polarDeg: 42, instant: true });
  });

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space' || event.code === 'Escape') {
      event.preventDefault();
      director.skip();
    }
  });

  paresDisponibles();
  renderer.requestRender();
}

void main();
