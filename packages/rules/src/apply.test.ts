import { describe, expect, it } from 'vitest';

import { apply, RULE_ERROR } from './apply.js';
import { buildClassicBoard } from './board.js';
import { cardSymbol } from './cards.js';
import { armiesOf, ownerOf, territoryCount, totalArmies } from './queries.js';
import {
  applyOk,
  contextFor,
  neutralVictory,
  errorOf,
  finishSetup,
  giveAllTo,
  makeGame,
  placeReinforcements,
  scriptedRng,
  setPlayer,
  setTerritories,
  setTerritory,
  stackReinforcements,
  stateAfter,
} from './test-helpers.js';
import type { GameState } from './types.js';

const board = buildClassicBoard();

/** Partida con el despliegue inicial ya terminado y los refuerzos colocados. */
function partidaLista(players = 3, seed = 42): GameState {
  const base = finishSetup(makeGame({ players, seed }), contextFor(makeGame({ players, seed })));
  const ctx = contextFor(base);
  const conRefuerzos = stackReinforcements(base, ctx);
  return stateAfter(
    conRefuerzos,
    { type: 'END_PHASE' },
    conRefuerzos.currentPlayer,
    contextFor(conRefuerzos),
  );
}

/**
 * Estado listo para atacar: p1 con ejercitos en `brasil` y 2 en `uruguay`
 * (vecino suyo), p2 con 1 en `peru`. Todo lo demas es de p3, para que nadie
 * este cerca de ganar mientras corre el test.
 */
function escenarioAtaque(brasil = 10): GameState {
  const base = giveAllTo(makeGame({ players: 3, seed: 5 }), 'p3');
  const listo = setTerritories(base, {
    brasil: ['p1', brasil],
    uruguay: ['p1', 2],
    peru: ['p2', 1],
  });
  return neutralVictory({ ...listo, phase: 'attack', currentPlayer: 'p1', armiesToPlace: 0 });
}

describe('apply — guardas comunes', () => {
  it('rechaza comandos de otro jugador', () => {
    const state = makeGame({ players: 3 });
    const ctx = contextFor(state);
    const territorio = board.territories.find(
      (territory) => ownerOf(state, territory) === 'p2',
    ) as string;
    expect(
      errorOf(state, { type: 'PLACE_ARMIES', territory: territorio, count: 1 }, 'p2', ctx),
    ).toBe(RULE_ERROR.NOT_YOUR_TURN);
  });

  it('rechaza comandos cuando la partida termino', () => {
    const state: GameState = { ...makeGame({ players: 3 }), phase: 'game-over', winner: 'p1' };
    expect(errorOf(state, { type: 'END_PHASE' }, 'p1', contextFor(state))).toBe(
      RULE_ERROR.GAME_OVER,
    );
  });

  it('rechaza comandos de un jugador que no existe o que quedo fuera', () => {
    const state = makeGame({ players: 3 });
    expect(errorOf(state, { type: 'END_PHASE' }, 'p9', contextFor(state))).toBe(
      RULE_ERROR.PLAYER_OUT,
    );

    const fuera = setPlayer(state, 'p1', { alive: false });
    expect(errorOf(fuera, { type: 'END_PHASE' }, 'p1', contextFor(fuera))).toBe(
      RULE_ERROR.PLAYER_OUT,
    );
  });

  it('un comando ilegal no cambia NADA del estado', () => {
    const state = makeGame({ players: 3 });
    const congelado = Object.freeze({
      ...state,
      territories: Object.freeze({ ...state.territories }),
      players: Object.freeze([...state.players]),
    }) as GameState;

    const antes = JSON.stringify(conEstadoPlano(congelado));
    const resultado = apply(
      congelado,
      { type: 'ATTACK', from: 'brasil', to: 'peru', dice: 3 },
      'p1',
      contextFor(congelado),
    );
    expect(resultado.ok).toBe(false);
    expect(JSON.stringify(conEstadoPlano(congelado))).toBe(antes);
  });

  it('devuelve un estado nuevo, no el mismo objeto', () => {
    const state = makeGame({ players: 3 });
    const ctx = contextFor(state);
    const territorio = board.territories.find(
      (territory) => ownerOf(state, territory) === 'p1',
    ) as string;
    const resultado = applyOk(
      state,
      { type: 'PLACE_ARMIES', territory: territorio, count: 1 },
      'p1',
      ctx,
    );
    expect(resultado.state).not.toBe(state);
    expect(resultado.state.territories).not.toBe(state.territories);
  });
});

/** Copia sin las referencias al tablero (que es compartido y constante). */
function conEstadoPlano(state: GameState): unknown {
  return { ...state, board: state.board.id };
}

describe('PLACE_ARMIES', () => {
  it('coloca ejercitos en un territorio propio', () => {
    const state = makeGame({ players: 3 });
    const ctx = contextFor(state);
    const territorio = board.territories.find(
      (territory) => ownerOf(state, territory) === 'p1',
    ) as string;

    const { state: despues, events } = applyOk(
      state,
      { type: 'PLACE_ARMIES', territory: territorio, count: 3 },
      'p1',
      ctx,
    );

    expect(armiesOf(despues, territorio)).toBe(armiesOf(state, territorio) + 3);
    expect(despues.armiesToPlace).toBe(state.armiesToPlace - 3);
    expect(despues.placementRoundAllowance).toBe((state.placementRoundAllowance ?? 0) - 3);
    expect(events).toEqual([{ type: 'ARMIES_PLACED', territory: territorio, count: 3 }]);
  });

  it('no deja pasar del cupo de la ronda', () => {
    const state = makeGame({ players: 3 });
    const ctx = contextFor(state);
    const territorio = board.territories.find(
      (territory) => ownerOf(state, territory) === 'p1',
    ) as string;
    expect(
      errorOf(state, { type: 'PLACE_ARMIES', territory: territorio, count: 6 }, 'p1', ctx),
    ).toBe(RULE_ERROR.ROUND_LIMIT);
  });

  it('rechaza territorios ajenos, desconocidos y cantidades invalidas', () => {
    const state = makeGame({ players: 3 });
    const ctx = contextFor(state);
    const ajeno = board.territories.find(
      (territory) => ownerOf(state, territory) === 'p2',
    ) as string;
    const propio = board.territories.find(
      (territory) => ownerOf(state, territory) === 'p1',
    ) as string;

    expect(errorOf(state, { type: 'PLACE_ARMIES', territory: ajeno, count: 1 }, 'p1', ctx)).toBe(
      RULE_ERROR.NOT_OWNER,
    );
    expect(
      errorOf(state, { type: 'PLACE_ARMIES', territory: 'atlantida', count: 1 }, 'p1', ctx),
    ).toBe(RULE_ERROR.UNKNOWN_TERRITORY);
    expect(errorOf(state, { type: 'PLACE_ARMIES', territory: propio, count: 0 }, 'p1', ctx)).toBe(
      RULE_ERROR.INVALID_COUNT,
    );
    expect(errorOf(state, { type: 'PLACE_ARMIES', territory: propio, count: 99 }, 'p1', ctx)).toBe(
      RULE_ERROR.NOT_ENOUGH_ARMIES,
    );
  });

  it('pasa al siguiente jugador cuando se agota el cupo de la ronda', () => {
    const state = makeGame({ players: 3 });
    const ctx = contextFor(state);
    const territorio = board.territories.find(
      (territory) => ownerOf(state, territory) === 'p1',
    ) as string;

    const despues = stateAfter(
      state,
      { type: 'PLACE_ARMIES', territory: territorio, count: 5 },
      'p1',
      ctx,
    );
    expect(despues.currentPlayer).toBe('p2');
    expect(despues.placementRound).toBe(1);
    expect(despues.placementRoundAllowance).toBe(5);
  });

  it('sube de ronda cuando ya colocaron todos', () => {
    const state = makeGame({ players: 2, seed: 3 });
    const ctx = contextFor(state);
    const propio = (actual: GameState): string =>
      board.territories.find(
        (territory) => ownerOf(actual, territory) === actual.currentPlayer,
      ) as string;

    let actual = stateAfter(
      state,
      { type: 'PLACE_ARMIES', territory: propio(state), count: 5 },
      'p1',
      ctx,
    );
    actual = stateAfter(
      actual,
      { type: 'PLACE_ARMIES', territory: propio(actual), count: 5 },
      'p2',
      ctx,
    );

    expect(actual.currentPlayer).toBe('p1');
    expect(actual.placementRound).toBe(2);
    expect(actual.placementRoundAllowance).toBe(3);
  });

  it('al terminar el despliegue arranca el refuerzo del primer jugador', () => {
    const base = makeGame({ players: 3, seed: 21 });
    const ctx = contextFor(base);
    const listo = finishSetup(base, ctx);

    expect(listo.phase).toBe('reinforce');
    expect(listo.currentPlayer).toBe('p1');
    expect(listo.armiesToPlace).toBeGreaterThanOrEqual(listo.config.reinforcement.minimum);
    expect(listo.placementRound).toBe(0);
    expect(listo.placementRoundAllowance).toBeNull();
  });

  it('en el refuerzo no hay cupo por ronda', () => {
    const base = makeGame({ players: 3, seed: 22 });
    const listo = finishSetup(base, contextFor(base));
    const ctx = contextFor(listo);
    const territorio = board.territories.find(
      (territory) => ownerOf(listo, territory) === 'p1',
    ) as string;

    const despues = stateAfter(
      listo,
      { type: 'PLACE_ARMIES', territory: territorio, count: listo.armiesToPlace },
      'p1',
      ctx,
    );
    expect(despues.armiesToPlace).toBe(0);
    expect(despues.phase).toBe('reinforce');
  });
});

describe('TRADE_CARDS', () => {
  /** Tres tarjetas del mismo simbolo, en la mano de p1. */
  function manoCanjeable(): readonly [string, string, string] {
    const primero = board.territories[0] as string;
    const simbolo = cardSymbol(primero, board);
    const iguales = board.territories.filter(
      (territory) => cardSymbol(territory, board) === simbolo,
    ) as unknown as [string, string, string];
    return [iguales[0], iguales[1], iguales[2]];
  }

  function enRefuerzo(cards: readonly string[]): GameState {
    const base = finishSetup(
      makeGame({ players: 3, seed: 33 }),
      contextFor(makeGame({ players: 3, seed: 33 })),
    );
    return setPlayer(base, 'p1', { cards });
  }

  it('canjea tres iguales y suma los ejercitos', () => {
    const trio = manoCanjeable();
    const state = enRefuerzo(trio);
    const ctx = contextFor(state);

    const { state: despues, events } = applyOk(
      state,
      { type: 'TRADE_CARDS', cardIds: trio },
      'p1',
      ctx,
    );

    expect(despues.players[0]?.cards).toEqual([]);
    expect(despues.discard).toEqual(trio);
    expect(despues.trades).toBe(1);
    expect(despues.armiesToPlace).toBeGreaterThan(state.armiesToPlace);
    expect(events[0]?.type).toBe('CARDS_TRADED');
  });

  it('escala el valor con los canjes anteriores', () => {
    const trio = manoCanjeable();
    const state = enRefuerzo(trio);
    const primero = applyOk(state, { type: 'TRADE_CARDS', cardIds: trio }, 'p1', contextFor(state));
    const conDos = setPlayer(
      {
        ...primero.state,
        players: primero.state.players.map((player) =>
          player.id === 'p1' ? { ...player, cards: trio } : player,
        ),
      },
      'p1',
      { cards: trio },
    );
    const segundo = applyOk(
      conDos,
      { type: 'TRADE_CARDS', cardIds: trio },
      'p1',
      contextFor(conDos),
    );

    const gananciaUno = primero.state.armiesToPlace - state.armiesToPlace;
    const gananciaDos = segundo.state.armiesToPlace - conDos.armiesToPlace;
    expect(gananciaDos - gananciaUno).toBe(state.config.cards.escalatingStep);
  });

  it('rechaza canjes invalidos y tarjetas que no estan en la mano', () => {
    const trio = manoCanjeable();
    const state = enRefuerzo(trio);
    const ctx = contextFor(state);
    const otra = board.territories.find(
      (territory) => cardSymbol(territory, board) !== cardSymbol(trio[0], board),
    ) as string;

    const conOtra = setPlayer(state, 'p1', { cards: [trio[0], trio[1], otra] });
    expect(
      errorOf(conOtra, { type: 'TRADE_CARDS', cardIds: [trio[0], trio[1], otra] }, 'p1', ctx),
    ).toBe(RULE_ERROR.INVALID_TRADE);
    expect(
      errorOf(state, { type: 'TRADE_CARDS', cardIds: [trio[0], trio[1], 'chile'] }, 'p1', ctx),
    ).toBe(RULE_ERROR.CARDS_NOT_OWNED);
  });

  it('el canje es obligatorio con demasiadas tarjetas', () => {
    const base = enRefuerzo([]);
    const conCinco = setPlayer(base, 'p1', {
      cards: board.territories.slice(0, base.config.cards.forcedTradeAt) as unknown as string[],
    });
    const sinNada = { ...conCinco, armiesToPlace: 0 };
    expect(errorOf(sinNada, { type: 'END_PHASE' }, 'p1', contextFor(sinNada))).toBe(
      RULE_ERROR.MUST_TRADE,
    );
  });

  it('no se puede canjear fuera del refuerzo', () => {
    const trio = manoCanjeable();
    const state = { ...enRefuerzo(trio), phase: 'attack' as const };
    expect(errorOf(state, { type: 'TRADE_CARDS', cardIds: trio }, 'p1', contextFor(state))).toBe(
      RULE_ERROR.WRONG_PHASE,
    );
  });
});

describe('ATTACK', () => {
  it('resuelve una ronda y deja los ejercitos que dice el evento', () => {
    const state = escenarioAtaque();
    const ctx = contextFor(state, scriptedRng([1, 6]));
    const { state: despues, events } = applyOk(
      state,
      { type: 'ATTACK', from: 'brasil', to: 'peru', dice: 1 },
      'p1',
      ctx,
    );

    const ronda = events[0];
    expect(ronda?.type).toBe('BATTLE_ROUND_RESOLVED');
    if (ronda?.type !== 'BATTLE_ROUND_RESOLVED') return;
    expect(armiesOf(despues, 'brasil')).toBe(ronda.attackerArmiesAfter);
    expect(armiesOf(despues, 'peru')).toBe(ronda.defenderArmiesAfter);
    expect(despues.phase).toBe('attack');
  });

  it('conquista cuando el defensor queda en cero', () => {
    const state = escenarioAtaque();
    const ctx = contextFor(state, scriptedRng([6, 1]));
    const { state: despues, events } = applyOk(
      state,
      { type: 'ATTACK', from: 'brasil', to: 'peru', dice: 1 },
      'p1',
      ctx,
    );

    expect(ownerOf(despues, 'peru')).toBe('p1');
    expect(armiesOf(despues, 'peru')).toBe(0);
    expect(despues.phase).toBe('conquest-move');
    expect(despues.pendingConquest).toEqual({ from: 'brasil', to: 'peru', min: 1, max: 9 });
    expect(despues.conqueredThisTurn).toBe(true);
    expect(despues.conqueredTerritories).toEqual(['peru']);
    expect(events.some((event) => event.type === 'TERRITORY_CONQUERED')).toBe(true);
  });

  it('rechaza ataques imposibles', () => {
    const state = escenarioAtaque();
    const ctx = contextFor(state, scriptedRng([6, 1]));

    // japon no es vecino de brasil.
    expect(
      errorOf(state, { type: 'ATTACK', from: 'brasil', to: 'japon', dice: 1 }, 'p1', ctx),
    ).toBe(RULE_ERROR.NOT_ADJACENT);
    // uruguay es vecino y es del propio jugador.
    expect(
      errorOf(state, { type: 'ATTACK', from: 'brasil', to: 'uruguay', dice: 1 }, 'p1', ctx),
    ).toBe(RULE_ERROR.NOT_ENEMY);
    // peru es de p2: no se ataca desde un territorio ajeno.
    expect(errorOf(state, { type: 'ATTACK', from: 'peru', to: 'brasil', dice: 1 }, 'p1', ctx)).toBe(
      RULE_ERROR.NOT_OWNER,
    );
    // Con 2 ejercitos se tira 1 dado: pedir 3 es ilegal.
    const conDos = escenarioAtaque(2);
    expect(
      errorOf(
        conDos,
        { type: 'ATTACK', from: 'brasil', to: 'peru', dice: 3 },
        'p1',
        contextFor(conDos),
      ),
    ).toBe(RULE_ERROR.INVALID_DICE);
  });

  it('no se ataca con un solo ejercito', () => {
    const state = setTerritory(escenarioAtaque(), 'brasil', 'p1', 1);
    expect(
      errorOf(
        state,
        { type: 'ATTACK', from: 'brasil', to: 'peru', dice: 1 },
        'p1',
        contextFor(state),
      ),
    ).toBe(RULE_ERROR.NOT_ENOUGH_ARMIES);
  });

  it('no se ataca fuera de la fase de ataque', () => {
    const state = { ...escenarioAtaque(), phase: 'reinforce' as const };
    expect(
      errorOf(
        state,
        { type: 'ATTACK', from: 'brasil', to: 'peru', dice: 1 },
        'p1',
        contextFor(state),
      ),
    ).toBe(RULE_ERROR.WRONG_PHASE);
  });

  it('elimina al defensor que se queda sin territorios y hereda sus tarjetas', () => {
    const base = giveAllTo(makeGame({ players: 3, seed: 6 }), 'p3');
    const state = neutralVictory({
      ...setTerritories(base, { brasil: ['p1', 10], peru: ['p2', 1] }),
      phase: 'attack' as const,
      currentPlayer: 'p1',
      armiesToPlace: 0,
      players: base.players.map((player) =>
        player.id === 'p2' ? { ...player, cards: ['argentina', 'uruguay'] } : player,
      ),
    });

    const { state: despues, events } = applyOk(
      state,
      { type: 'ATTACK', from: 'brasil', to: 'peru', dice: 1 },
      'p1',
      contextFor(state, scriptedRng([6, 1])),
    );

    expect(territoryCount(despues, 'p2')).toBe(0);
    expect(despues.players.find((player) => player.id === 'p2')?.alive).toBe(false);
    expect(despues.players.find((player) => player.id === 'p1')?.cards).toEqual([
      'argentina',
      'uruguay',
    ]);
    expect(events.some((event) => event.type === 'PLAYER_ELIMINATED')).toBe(true);
    expect(despues.phase).toBe('conquest-move');
    expect(despues.winner).toBeNull();
  });

  it('gana al cumplir el objetivo comun', () => {
    const base = giveAllTo(makeGame({ players: 3, seed: 6 }), 'p2');
    const objetivo = base.config.victory.commonObjectiveTerritories;
    const propios = board.territories.slice(0, objetivo - 1);
    const cambios: Record<string, readonly ['p1', number]> = { brasil: ['p1', 10] };
    for (const territory of propios) cambios[territory] = ['p1', 2];
    const restantes = board.territories.filter((territory) => cambios[territory] === undefined);
    const vecino = restantes.find((territory) =>
      (board.neighbors['brasil'] ?? []).includes(territory),
    );

    // Si el vecino no quedo libre, se busca un par adyacente propio/ajeno.
    const origen =
      vecino === undefined
        ? (propios.find((territory) =>
            (board.neighbors[territory] ?? []).some(
              (candidato) => cambios[candidato] === undefined,
            ),
          ) as string)
        : 'brasil';
    const destino =
      vecino ??
      (board.neighbors[origen] ?? []).find((candidato) => cambios[candidato] === undefined);

    const state: GameState = {
      ...setTerritories(base, { ...cambios, [destino as string]: ['p2', 1] }),
      phase: 'attack',
      currentPlayer: 'p1',
      armiesToPlace: 0,
      config: { ...base.config, victory: { ...base.config.victory, strategy: 'common-objective' } },
    };

    const { state: despues, events } = applyOk(
      state,
      { type: 'ATTACK', from: origen, to: destino as string, dice: 1 },
      'p1',
      contextFor(state, scriptedRng([6, 1])),
    );

    expect(territoryCount(despues, 'p1')).toBeGreaterThanOrEqual(objetivo);
    expect(events.some((event) => event.type === 'GAME_WON')).toBe(true);
    expect(despues.phase).toBe('game-over');
    expect(despues.winner).toBe('p1');
  });
});

describe('MOVE_AFTER_CONQUEST', () => {
  /** Estado con una conquista pendiente de 1 a 9 ejercitos. */
  function conquistado(): GameState {
    const state = escenarioAtaque();
    const { state: despues } = applyOk(
      state,
      { type: 'ATTACK', from: 'brasil', to: 'peru', dice: 1 },
      'p1',
      contextFor(state, scriptedRng([6, 1])),
    );
    return despues;
  }

  it('mueve los ejercitos y vuelve a la fase de ataque', () => {
    const state = conquistado();
    const { state: despues, events } = applyOk(
      state,
      { type: 'MOVE_AFTER_CONQUEST', count: 4 },
      'p1',
      contextFor(state),
    );

    expect(armiesOf(despues, 'brasil')).toBe(6);
    expect(armiesOf(despues, 'peru')).toBe(4);
    expect(despues.phase).toBe('attack');
    expect(despues.pendingConquest).toBeNull();
    expect(events[0]).toEqual({ type: 'ARMIES_MOVED', from: 'brasil', to: 'peru', count: 4 });
  });

  it('respeta el minimo y el maximo', () => {
    const state = conquistado();
    const ctx = contextFor(state);
    expect(errorOf(state, { type: 'MOVE_AFTER_CONQUEST', count: 0 }, 'p1', ctx)).toBe(
      RULE_ERROR.INVALID_COUNT,
    );
    expect(errorOf(state, { type: 'MOVE_AFTER_CONQUEST', count: 10 }, 'p1', ctx)).toBe(
      RULE_ERROR.INVALID_COUNT,
    );
  });

  it('sin conquista pendiente no hay nada que mover', () => {
    const state = { ...escenarioAtaque(), phase: 'attack' as const };
    expect(errorOf(state, { type: 'MOVE_AFTER_CONQUEST', count: 1 }, 'p1', contextFor(state))).toBe(
      RULE_ERROR.WRONG_PHASE,
    );
  });

  it('siempre deja al menos un ejercito en el origen', () => {
    // Ataque con 3 ejercitos: gana sin bajas, asi que solo pueden moverse 2.
    const base = escenarioAtaque(3);
    const state = applyOk(
      base,
      { type: 'ATTACK', from: 'brasil', to: 'peru', dice: 1 },
      'p1',
      contextFor(base, scriptedRng([6, 1])),
    ).state;

    expect(state.pendingConquest?.max).toBe(2);
    expect(errorOf(state, { type: 'MOVE_AFTER_CONQUEST', count: 3 }, 'p1', contextFor(state))).toBe(
      RULE_ERROR.INVALID_COUNT,
    );
    const despues = stateAfter(
      state,
      { type: 'MOVE_AFTER_CONQUEST', count: 2 },
      'p1',
      contextFor(state),
    );
    expect(armiesOf(despues, 'brasil')).toBe(1);
  });
});

describe('REGROUP', () => {
  function enReagrupe(): GameState {
    const base = giveAllTo(makeGame({ players: 3, seed: 12 }), 'p3');
    return neutralVictory({
      ...setTerritories(base, { brasil: ['p1', 5], peru: ['p1', 2], australia: ['p1', 1] }),
      phase: 'regroup',
      currentPlayer: 'p1',
      armiesToPlace: 0,
    });
  }

  it('mueve entre territorios propios conectados', () => {
    const state = enReagrupe();
    const { state: despues, events } = applyOk(
      state,
      { type: 'REGROUP', from: 'brasil', to: 'peru', count: 3 },
      'p1',
      contextFor(state),
    );

    expect(armiesOf(despues, 'brasil')).toBe(2);
    expect(armiesOf(despues, 'peru')).toBe(5);
    expect(events[0]).toEqual({ type: 'ARMIES_MOVED', from: 'brasil', to: 'peru', count: 3 });
    expect(despues.regroupMoves['brasil>peru']).toBe(1);
  });

  it('exige camino por territorios propios', () => {
    const state = enReagrupe();
    // australia es de p1 pero esta aislado: todos sus vecinos son de p3.
    expect(
      errorOf(
        state,
        { type: 'REGROUP', from: 'brasil', to: 'australia', count: 1 },
        'p1',
        contextFor(state),
      ),
    ).toBe(RULE_ERROR.NO_OWN_PATH);
  });

  it('limita los movimientos por par', () => {
    const state = enReagrupe();
    const uno = stateAfter(
      state,
      { type: 'REGROUP', from: 'brasil', to: 'peru', count: 1 },
      'p1',
      contextFor(state),
    );
    expect(
      errorOf(
        uno,
        { type: 'REGROUP', from: 'brasil', to: 'peru', count: 1 },
        'p1',
        contextFor(uno),
      ),
    ).toBe(RULE_ERROR.REGROUP_LIMIT);
  });

  it('no deja el origen vacio', () => {
    const state = enReagrupe();
    expect(
      errorOf(
        state,
        { type: 'REGROUP', from: 'brasil', to: 'peru', count: 5 },
        'p1',
        contextFor(state),
      ),
    ).toBe(RULE_ERROR.INVALID_COUNT);
  });

  it('solo entre territorios propios y en la fase de reagrupe', () => {
    const state = enReagrupe();
    expect(
      errorOf(
        state,
        { type: 'REGROUP', from: 'brasil', to: 'argentina', count: 1 },
        'p1',
        contextFor(state),
      ),
    ).toBe(RULE_ERROR.NOT_OWNER);

    const enAtaque = { ...state, phase: 'attack' as const };
    expect(
      errorOf(
        enAtaque,
        { type: 'REGROUP', from: 'brasil', to: 'peru', count: 1 },
        'p1',
        contextFor(enAtaque),
      ),
    ).toBe(RULE_ERROR.WRONG_PHASE);
  });
});

describe('END_PHASE y END_TURN', () => {
  it('el refuerzo no se cierra con ejercitos pendientes', () => {
    const base = finishSetup(
      makeGame({ players: 3, seed: 44 }),
      contextFor(makeGame({ players: 3, seed: 44 })),
    );
    expect(errorOf(base, { type: 'END_PHASE' }, 'p1', contextFor(base))).toBe(
      RULE_ERROR.MUST_PLACE_ARMIES,
    );
  });

  it('refuerzo → ataque → reagrupe', () => {
    const listo = partidaLista(3, 44);
    expect(listo.phase).toBe('attack');

    const reagrupe = stateAfter(listo, { type: 'END_PHASE' }, 'p1', contextFor(listo));
    expect(reagrupe.phase).toBe('regroup');
  });

  it('cierra el turno y pasa al siguiente jugador con sus refuerzos', () => {
    const state = partidaLista(3, 45);
    const { state: despues, events } = applyOk(
      state,
      { type: 'END_TURN' },
      'p1',
      contextFor(state),
    );

    expect(despues.currentPlayer).toBe('p2');
    expect(despues.phase).toBe('reinforce');
    expect(despues.armiesToPlace).toBeGreaterThan(0);
    expect(despues.conqueredThisTurn).toBe(false);
    expect(despues.regroupMoves).toEqual({});
    expect(events.some((event) => event.type === 'TURN_CHANGED')).toBe(true);
  });

  it('roba una tarjeta solo si conquisto en el turno', () => {
    const base = escenarioAtaque();
    const conquistado = applyOk(
      base,
      { type: 'ATTACK', from: 'brasil', to: 'peru', dice: 1 },
      'p1',
      contextFor(base, scriptedRng([6, 1])),
    ).state;
    const conMover = stateAfter(
      conquistado,
      { type: 'MOVE_AFTER_CONQUEST', count: 1 },
      'p1',
      contextFor(conquistado),
    );

    const sinConquista = partidaLista(3, 46);
    const conRobo = applyOk(conMover, { type: 'END_TURN' }, 'p1', contextFor(conMover));
    const sinRobo = applyOk(sinConquista, { type: 'END_TURN' }, 'p1', contextFor(sinConquista));

    expect(conRobo.events.some((event) => event.type === 'CARD_DRAWN')).toBe(true);
    expect(sinRobo.events.some((event) => event.type === 'CARD_DRAWN')).toBe(false);
    expect(conRobo.state.players[0]?.cards).toHaveLength(1);
    expect(conRobo.state.deck.length).toBe(sinRobo.state.deck.length - 1);
  });

  it('el numero de turno sube cuando vuelve a jugar el primero', () => {
    const cerrarTurno = (state: GameState): GameState => {
      const conRefuerzos = placeReinforcements(state, contextFor(state));
      const enAtaque = stateAfter(
        conRefuerzos,
        { type: 'END_PHASE' },
        conRefuerzos.currentPlayer,
        contextFor(conRefuerzos),
      );
      return stateAfter(
        enAtaque,
        { type: 'END_TURN' },
        enAtaque.currentPlayer,
        contextFor(enAtaque),
      );
    };

    let state = partidaLista(2, 47);
    const inicial = state.turn;

    state = cerrarTurno(state);
    expect(state.turn).toBe(inicial);
    expect(state.currentPlayer).toBe('p2');

    state = cerrarTurno(state);
    expect(state.turn).toBe(inicial + 1);
    expect(state.currentPlayer).toBe('p1');
  });

  it('no se cierra el turno en el refuerzo', () => {
    const base = finishSetup(
      makeGame({ players: 3, seed: 48 }),
      contextFor(makeGame({ players: 3, seed: 48 })),
    );
    expect(errorOf(base, { type: 'END_TURN' }, 'p1', contextFor(base))).toBe(
      RULE_ERROR.WRONG_PHASE,
    );
  });
});

describe('SURRENDER', () => {
  it('saca al jugador y le pasa el turno al siguiente', () => {
    const state = makeGame({ players: 3 });
    const { state: despues, events } = applyOk(
      state,
      { type: 'SURRENDER' },
      'p1',
      contextFor(state),
    );

    expect(despues.players.find((player) => player.id === 'p1')?.alive).toBe(false);
    expect(despues.currentPlayer).toBe('p2');
    expect(events.some((event) => event.type === 'PLAYER_ELIMINATED')).toBe(true);
  });

  it('si queda uno solo, gana', () => {
    const base = makeGame({ players: 2, seed: 9 });
    const { state: despues, events } = applyOk(base, { type: 'SURRENDER' }, 'p1', contextFor(base));

    expect(despues.phase).toBe('game-over');
    expect(despues.winner).toBe('p2');
    expect(events.some((event) => event.type === 'GAME_WON')).toBe(true);
  });

  it('no cambia la cantidad de ejercitos del tablero', () => {
    const state = makeGame({ players: 3 });
    const antes = totalArmies(state);
    const despues = stateAfter(state, { type: 'SURRENDER' }, 'p1', contextFor(state));
    expect(totalArmies(despues)).toBe(antes);
  });
});
