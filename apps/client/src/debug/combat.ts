/**
 * Sandbox de combate (`/debug/combat`).
 *
 * Herramienta de desarrollo, no pantalla de juego: permite disparar una ronda
 * entre dos territorios vecinos sin jugar una partida, elegir los ejércitos de
 * cada bando, el nivel de espectáculo y el tipo de enlace.
 *
 * OJO: aca los eventos estan SIMULADOS. El motor de reglas de verdad llega en el
 * Hito 3; cuando exista, el sandbox pasa a pedirle los eventos a `apply()` y
 * este simulador se borra.
 */

import '../styles/main.css';

import { Color } from 'three';
import type { BattleRoundResolved, GameEvent } from '@conqueror/rules';
import { pairKey } from '@conqueror/map-data';
import { t } from '../app/i18n.js';
import { createMockGameState, createSeededRandom, type MockGameState } from '../app/fixtures.js';
import { playerColor } from '../app/palette.js';
import { createRenderer } from '../render/renderer.js';
import { createBattleScene } from '../render/combat/BattleScene.js';
import { createCombatDirector } from '../render/combat/CombatDirector.js';
import type { SpectacleLevel } from '../render/combat/spectacle.js';
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

  const renderer = createRenderer(canvas);
  const scene = await createGameScene({
    renderer,
    canvas,
    reducedMotion: false,
    mapMaxUnits: 5,
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

  const battle = createBattleScene({ renderer, scene, maxUnits: 16 });
  renderer.scene.add(battle.group);

  let lastRound: BattleRoundResolved | null = null;

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
  });

  renderer.onFrame((delta) => {
    scene.update(delta);
    director.update(delta);
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
  );
  panel.append(grid);

  const info = nodo('p', 'mt-3 text-[11px] leading-relaxed text-algodon/60');
  panel.append(info);

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

  hud.append(panel);

  /** Pares adyacentes, para no ofrecer combinaciones invalidas. */
  const pares = scene.data.adjacency.edges.map(([a, b]) => ({ a, b }));

  function nombreDe(id: string): string {
    return scene.data.byId.get(id)?.names['es-AR'] ?? id;
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
    info.textContent = lineas.join('\n');
    info.style.whiteSpace = 'pre-line';
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

  selectorNivel.addEventListener('change', () => {
    director.setLevel(selectorNivel.value as SpectacleLevel);
  });

  botonRonda.addEventListener('click', () => {
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
    director.enqueue(eventos);
  });

  botonConquistar.addEventListener('click', () => {
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
    director.enqueue([event, { type: 'TERRITORY_CONQUERED', territory: to }]);
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
    lastRound = null;
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
