import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { apply } from './apply.js';
import { getLegalCommands } from './legal.js';
import { armiesOf, totalArmies } from './queries.js';
import { createRng } from './rng.js';
import { contextFor, makeGame, playersFor, scriptedRng } from './test-helpers.js';
import type { Command, GameState } from './types.js';

/** Copia comparable del estado (el tablero es constante y compartido). */
function plano(state: GameState): string {
  return JSON.stringify({ ...state, board: state.board.id });
}

/** Congela el estado en profundidad: escribir en el tira. */
function congelar(state: GameState): GameState {
  for (const territory of state.board.territories) {
    const actual = state.territories[territory];
    if (actual !== undefined) Object.freeze(actual);
  }
  Object.freeze(state.territories);
  Object.freeze(state.players);
  Object.freeze(state.conqueredTerritories);
  return Object.freeze(state);
}

/** Elige un comando legal (o `null` si no hay) con un RNG dado. */
function elegirLegal(state: GameState, rng: ReturnType<typeof createRng>): Command | null {
  const legales = getLegalCommands(state, state.currentPlayer);
  if (legales.length === 0) return null;
  return legales[rng.int(0, legales.length - 1)] as Command;
}

describe('propiedades del motor', { timeout: 30_000 }, () => {
  it('un comando ilegal nunca cambia el estado', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50_000 }),
        fc.integer({ min: 2, max: 6 }),
        fc.integer({ min: 0, max: 5 }),
        (seed, players, indice) => {
          const state = makeGame({ players, seed });
          const ctx = contextFor(state);
          const otro = playersFor(players)[indice % players] as { id: string };

          // Comandos imposibles: de otro jugador, territorio inexistente, dados fuera de rango.
          const imposibles: Command[] = [
            { type: 'PLACE_ARMIES', territory: 'atlantida', count: 1 },
            { type: 'ATTACK', from: 'atlantida', to: 'atlantida', dice: 3 },
            { type: 'ATTACK', from: 'brasil', to: 'peru', dice: 3 },
            { type: 'MOVE_AFTER_CONQUEST', count: 1 },
            { type: 'REGROUP', from: 'brasil', to: 'peru', count: 1 },
            { type: 'END_PHASE' },
            { type: 'TRADE_CARDS', cardIds: ['a', 'b', 'c'] },
          ];

          for (const command of imposibles) {
            const antes = plano(state);
            const resultado = apply(state, command, state.currentPlayer, ctx);
            // En la fase de despliegue colocar es legal: solo se exige que un
            // comando RECHAZADO deje el estado intacto.
            if (!resultado.ok) expect(plano(state)).toBe(antes);
          }

          // Y un comando del jugador equivocado siempre se rechaza.
          if (otro.id !== state.currentPlayer) {
            const antes = plano(state);
            const resultado = apply(
              state,
              { type: 'PLACE_ARMIES', territory: 'brasil', count: 1 },
              otro.id,
              ctx,
            );
            expect(resultado.ok).toBe(false);
            expect(plano(state)).toBe(antes);
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it('apply no muta el estado de entrada', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50_000 }),
        fc.integer({ min: 2, max: 6 }),
        (seed, players) => {
          const state = congelar(makeGame({ players, seed }));
          const ctx = contextFor(state);
          const command = elegirLegal(state, createRng(seed));
          if (command === null) return;

          const antes = plano(state);
          const resultado = apply(state, command, state.currentPlayer, ctx);
          expect(resultado.ok).toBe(true);
          expect(plano(state)).toBe(antes);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('la misma semilla y los mismos comandos dan el mismo estado', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50_000 }),
        fc.integer({ min: 2, max: 4 }),
        (seed, players) => {
          const correr = (): string => {
            let state = makeGame({ players, seed });
            const ctx = contextFor(state);
            const bot = createRng(seed + 7);
            for (let paso = 0; paso < 40 && state.phase !== 'game-over'; paso += 1) {
              const command = elegirLegal(state, bot);
              if (command === null) break;
              const resultado = apply(state, command, state.currentPlayer, ctx);
              if (!resultado.ok) throw new Error(resultado.error.message);
              state = resultado.value.state;
            }
            return plano(state);
          };

          expect(correr()).toBe(correr());
        },
      ),
      { numRuns: 25 },
    );
  });

  it('nunca queda un territorio con menos ejercitos de los permitidos', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50_000 }),
        fc.integer({ min: 2, max: 6 }),
        (seed, players) => {
          let state = makeGame({ players, seed });
          const ctx = contextFor(state);
          const bot = createRng(seed + 3);

          for (let paso = 0; paso < 120 && state.phase !== 'game-over'; paso += 1) {
            const command = elegirLegal(state, bot);
            if (command === null) break;
            const resultado = apply(state, command, state.currentPlayer, ctx);
            if (!resultado.ok)
              throw new Error(`${resultado.error.code}: ${resultado.error.message}`);
            state = resultado.value.state;

            for (const territory of state.board.territories) {
              const ejercitos = armiesOf(state, territory);
              expect(ejercitos, `${territory} quedo en ${ejercitos}`).toBeGreaterThanOrEqual(0);

              // Un territorio con dueno conserva al menos 1 ejercito, salvo el
              // que se acaba de conquistar y esta esperando el movimiento.
              const esPendiente = state.pendingConquest?.to === territory;
              const minimo = esPendiente ? 0 : 1;
              if (state.territories[territory]?.owner !== null) {
                expect(
                  ejercitos,
                  `${territory} con dueno y ${ejercitos} ejercitos`,
                ).toBeGreaterThanOrEqual(minimo);
              }
            }
          }
        },
      ),
      { numRuns: 25 },
    );
  });

  it('los ejercitos solo cambian por lo que dicen las reglas', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50_000 }),
        fc.integer({ min: 2, max: 6 }),
        (seed, players) => {
          let state = makeGame({ players, seed });
          const ctx = contextFor(state);
          const bot = createRng(seed + 5);

          for (let paso = 0; paso < 120 && state.phase !== 'game-over'; paso += 1) {
            const command = elegirLegal(state, bot);
            if (command === null) break;

            const antes = totalArmies(state);
            const resultado = apply(state, command, state.currentPlayer, ctx);
            if (!resultado.ok)
              throw new Error(`${resultado.error.code}: ${resultado.error.message}`);
            const despues = totalArmies(resultado.value.state);

            if (command.type === 'ATTACK') {
              // Una ronda de combate solo saca los ejercitos que perdieron.
              const ronda = resultado.value.events.find(
                (event) => event.type === 'BATTLE_ROUND_RESOLVED',
              );
              if (ronda?.type === 'BATTLE_ROUND_RESOLVED') {
                expect(antes - despues).toBe(ronda.attackerLosses + ronda.defenderLosses);
              }
            } else {
              // Ningun otro comando saca ejercitos del tablero.
              expect(despues).toBeGreaterThanOrEqual(antes);
            }

            state = resultado.value.state;
          }
        },
      ),
      { numRuns: 25 },
    );
  });

  it('todo comando legal se aplica sin error', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50_000 }),
        fc.integer({ min: 2, max: 6 }),
        (seed, players) => {
          let state = makeGame({ players, seed });
          const ctx = contextFor(state);
          const bot = createRng(seed + 11);

          for (let paso = 0; paso < 60 && state.phase !== 'game-over'; paso += 1) {
            const legales = getLegalCommands(state, state.currentPlayer);
            expect(legales.length).toBeGreaterThan(0);
            for (const command of legales.slice(0, 30)) {
              const resultado = apply(state, command, state.currentPlayer, ctx);
              expect(
                resultado.ok,
                `${command.type} rechazado: ${resultado.ok ? '' : resultado.error.code}`,
              ).toBe(true);
            }
            const command = legales[bot.int(0, legales.length - 1)] as Command;
            const resultado = apply(state, command, state.currentPlayer, ctx);
            if (!resultado.ok) throw new Error(resultado.error.message);
            state = resultado.value.state;
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('una tirada forzada se refleja en el estado', () => {
    // Con dados de guion fijo, la conquista tiene que ser determinista.
    const base = makeGame({ players: 3, seed: 4 });
    const conEscenario = {
      ...base,
      phase: 'attack' as const,
      armiesToPlace: 0,
      territories: {
        ...base.territories,
        brasil: { owner: 'p1', armies: 5 },
        peru: { owner: 'p2', armies: 1 },
      },
    };

    const resultado = apply(
      conEscenario,
      { type: 'ATTACK', from: 'brasil', to: 'peru', dice: 1 },
      'p1',
      contextFor(conEscenario, scriptedRng([6, 1])),
    );

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.value.state.territories['peru']?.owner).toBe('p1');
    expect(resultado.value.state.phase).toBe('conquest-move');
  });
});
