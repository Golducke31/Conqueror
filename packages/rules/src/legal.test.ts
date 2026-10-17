import { describe, expect, it } from 'vitest';

import { apply } from './apply.js';
import { buildClassicBoard } from './board.js';
import { cardSymbol, CARD_SYMBOLS } from './cards.js';
import { getLegalCommands, canAttackFrom } from './legal.js';
import { ownerOf } from './queries.js';
import {
  contextFor,
  finishSetup,
  giveAllTo,
  makeGame,
  neutralVictory,
  setPlayer,
  setTerritories,
  setTerritory,
  stackReinforcements,
} from './test-helpers.js';
import type { Command, GameState } from './types.js';

const board = buildClassicBoard();

/** Tipos de comando que aparecen en una lista. */
function tipos(commands: readonly Command[]): Set<string> {
  return new Set(commands.map((command) => command.type));
}

/** Partida en la fase de ataque, con los refuerzos ya colocados. */
function enAtaque(players = 3, seed = 77): GameState {
  const base = finishSetup(makeGame({ players, seed }), contextFor(makeGame({ players, seed })));
  const conRefuerzos = stackReinforcements(base, contextFor(base));
  const resultado = apply(
    conRefuerzos,
    { type: 'END_PHASE' },
    conRefuerzos.currentPlayer,
    contextFor(conRefuerzos),
  );
  if (!resultado.ok) throw new Error(resultado.error.message);
  return resultado.value.state;
}

describe('getLegalCommands', () => {
  it('no devuelve nada si no es el turno del jugador', () => {
    const state = makeGame({ players: 3 });
    expect(getLegalCommands(state, 'p2')).toEqual([]);
  });

  it('no devuelve nada si el jugador quedo fuera o la partida termino', () => {
    const state = makeGame({ players: 3 });
    expect(getLegalCommands(setPlayer(state, 'p1', { alive: false }), 'p1')).toEqual([]);
    expect(getLegalCommands({ ...state, phase: 'game-over' }, 'p1')).toEqual([]);
  });

  it('en el despliegue ofrece colocar en cada territorio propio', () => {
    const state = makeGame({ players: 3 });
    const comandos = getLegalCommands(state, 'p1');
    const propios = board.territories.filter((territory) => ownerOf(state, territory) === 'p1');
    expect(comandos).toHaveLength(propios.length);
    expect(tipos(comandos)).toEqual(new Set(['PLACE_ARMIES']));
  });

  it('en el refuerzo ofrece colocar, canjear y cerrar la fase', () => {
    const base = finishSetup(
      makeGame({ players: 3, seed: 77 }),
      contextFor(makeGame({ players: 3, seed: 77 })),
    );
    const trio = board.territories.filter(
      (territory) => cardSymbol(territory, board) === CARD_SYMBOLS[0],
    ) as unknown as string[];
    const conCartas = setPlayer(base, base.currentPlayer, { cards: trio.slice(0, 3) });

    const comandos = getLegalCommands(conCartas, conCartas.currentPlayer);
    expect(tipos(comandos)).toEqual(new Set(['PLACE_ARMIES', 'TRADE_CARDS']));

    const sinPendientes = { ...conCartas, armiesToPlace: 0 };
    expect(tipos(getLegalCommands(sinPendientes, sinPendientes.currentPlayer))).toEqual(
      new Set(['TRADE_CARDS', 'END_PHASE']),
    );
  });

  it('no deja cerrar la fase con un canje obligatorio pendiente', () => {
    const base = finishSetup(
      makeGame({ players: 3, seed: 78 }),
      contextFor(makeGame({ players: 3, seed: 78 })),
    );
    const conCinco = setPlayer({ ...base, armiesToPlace: 0 }, base.currentPlayer, {
      cards: board.territories.slice(0, base.config.cards.forcedTradeAt) as unknown as string[],
    });
    expect(
      getLegalCommands(conCinco, conCinco.currentPlayer).some((c) => c.type === 'END_PHASE'),
    ).toBe(false);
  });

  it('en el ataque ofrece cada cantidad de dados valida y cerrar el turno', () => {
    const state = enAtaque();
    const comandos = getLegalCommands(state, state.currentPlayer);
    const tiposDisponibles = tipos(comandos);
    expect(tiposDisponibles.has('ATTACK')).toBe(true);
    expect(tiposDisponibles.has('END_PHASE')).toBe(true);
    expect(tiposDisponibles.has('END_TURN')).toBe(true);

    for (const command of comandos) {
      if (command.type !== 'ATTACK') continue;
      expect(command.dice).toBeGreaterThanOrEqual(1);
      expect(command.dice).toBeLessThanOrEqual(state.config.combat.maxAttackerDice);
    }
  });

  it('en el reagrupe ofrece los pares propios y cerrar el turno', () => {
    const base = giveAllTo(makeGame({ players: 3, seed: 79 }), 'p3');
    const state = neutralVictory({
      ...setTerritories(base, { brasil: ['p1', 5], peru: ['p1', 2] }),
      phase: 'regroup' as const,
      currentPlayer: 'p1',
      armiesToPlace: 0,
    });
    const comandos = getLegalCommands(state, 'p1');
    expect(tipos(comandos)).toEqual(new Set(['REGROUP', 'END_TURN']));
    expect(
      comandos.some((command) => command.type === 'REGROUP' && command.from === 'brasil'),
    ).toBe(true);
  });

  it('tras conquistar solo ofrece mover ejercitos', () => {
    const base = giveAllTo(makeGame({ players: 3, seed: 80 }), 'p3');
    const state = neutralVictory({
      ...setTerritories(base, { brasil: ['p1', 10], peru: ['p2', 1] }),
      phase: 'conquest-move' as const,
      currentPlayer: 'p1',
      armiesToPlace: 0,
      pendingConquest: { from: 'brasil', to: 'peru', min: 1, max: 9 },
    });

    const comandos = getLegalCommands(state, 'p1');
    expect(tipos(comandos)).toEqual(new Set(['MOVE_AFTER_CONQUEST']));
    expect(comandos).toHaveLength(9);
    expect(comandos[0]).toEqual({ type: 'MOVE_AFTER_CONQUEST', count: 1 });
  });

  it('todo comando legal se puede aplicar', () => {
    for (const players of [2, 3, 4, 5, 6]) {
      for (const seed of [11, 22, 33]) {
        let state = finishSetup(
          makeGame({ players, seed }),
          contextFor(makeGame({ players, seed })),
        );
        for (let paso = 0; paso < 12; paso += 1) {
          const comandos = getLegalCommands(state, state.currentPlayer);
          expect(
            comandos.length,
            `sin comandos: ${players} jugadores, semilla ${seed}`,
          ).toBeGreaterThan(0);
          for (const command of comandos.slice(0, 25)) {
            const resultado = apply(state, command, state.currentPlayer, contextFor(state));
            expect(
              resultado.ok,
              `${command.type} rechazado: ${resultado.ok ? '' : resultado.error.code}`,
            ).toBe(true);
          }
          // Se avanza con el primer comando para cambiar de escenario.
          const primero = comandos[0] as Command;
          const resultado = apply(state, primero, state.currentPlayer, contextFor(state));
          if (!resultado.ok) throw new Error(resultado.error.message);
          state = resultado.value.state;
        }
      }
    }
  });

  it('canAttackFrom coincide con lo que ofrece la lista', () => {
    const state = enAtaque();
    const comandos = getLegalCommands(state, state.currentPlayer);
    const origenes = new Set(
      comandos
        .filter(
          (command): command is Extract<Command, { type: 'ATTACK' }> => command.type === 'ATTACK',
        )
        .map((command) => command.from),
    );

    for (const territory of board.territories) {
      if (canAttackFrom(state, state.currentPlayer, territory)) {
        expect(origenes.has(territory), territory).toBe(true);
      }
    }
  });

  it('un territorio con un solo ejercito no puede atacar', () => {
    const base = enAtaque();
    const state = setTerritory(base, 'brasil', 'p1', 1);
    expect(canAttackFrom(state, 'p1', 'brasil')).toBe(false);
  });
});
