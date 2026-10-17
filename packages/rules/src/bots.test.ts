/**
 * Tests del bot nivel 1.
 *
 * Lo que tiene que cumplir SIEMPRE:
 *   - elegir comandos que el motor acepta (nunca uno rechazado),
 *   - atacar solo con ventaja real de dados,
 *   - avanzar de fase y de turno.
 *
 * NO se le exige terminar todas las partidas: el bot es nivel 1 (accion legal
 * con criterio), no un resolvedor. La garantia de terminacion de las 1000
 * partidas la da la politica de `test-helpers.playRandomGame`, que es la del
 * test del Hito 3.
 */

import { describe, expect, it } from 'vitest';

import { apply } from './apply.js';
import { createBot } from './bots.js';
import { getLegalCommands } from './legal.js';
import { createRng } from './rng.js';
import { contextFor, makeGame } from './test-helpers.js';
import type { Command, GameState } from './types.js';

/** Corre una partida con el bot y devuelve resumen de la corrida. */
function correr(semillaPartida: number, semillaBot: number, jugadores: number) {
  let actual: GameState = makeGame({ players: jugadores, seed: semillaPartida });
  const ctx = contextFor(actual);
  const bot = createBot(createRng(semillaBot));
  let comandos = 0;

  while (actual.phase !== 'game-over' && comandos < 20_000) {
    const legales = getLegalCommands(actual, actual.currentPlayer);
    expect(legales.length).toBeGreaterThan(0);

    const elegido = bot.choose(actual) as Command;
    expect(elegido).not.toBeNull();

    const resultado = apply(actual, elegido, actual.currentPlayer, ctx);
    // El bot nunca manda un comando que el motor rechace.
    expect(resultado.ok).toBe(true);
    if (resultado.ok) actual = resultado.value.state;
    comandos += 1;
  }

  return { fase: actual.phase, comandos, turnos: actual.turn };
}

describe('bot nivel 1', () => {
  it('nunca manda un comando que el motor rechace', () => {
    for (let semilla = 0; semilla < 12; semilla += 1) {
      const jugadores = 2 + (semilla % 5);
      const r = correr(4000 + semilla * 17, 6000 + semilla * 31, jugadores);
      // Si el motor hubiera rechazado algo, el `expect` de adentro ya fallaba.
      expect(r.comandos).toBeGreaterThan(0);
    }
  }, 120_000);

  it('siempre avanza de fase y de turno', () => {
    for (let semilla = 0; semilla < 6; semilla += 1) {
      const jugadores = 2 + (semilla % 5);
      const r = correr(4000 + semilla * 17, 6000 + semilla * 31, jugadores);
      // El bot no se queda en el sitio: o gano alguien o avanzo muchos turnos.
      expect(r.fase === 'game-over' || r.turnos >= 15).toBe(true);
    }
  }, 120_000);

  it('puede terminar una partida de cada tamanio', () => {
    // No se exige que termine todas: es nivel 1 (accion legal con criterio), no
    // un resolvedor. Pero al menos una de cada cantidad de jugadores, para
    // servir de reemplazo de AFK y de prueba de flujo.
    for (const jugadores of [2, 3, 4, 5, 6] as const) {
      let termino = false;
      for (let intento = 0; intento < 6 && !termino; intento += 1) {
        const r = correr(7000 + jugadores * 13 + intento * 7, 9000 + intento, jugadores);
        if (r.fase === 'game-over') termino = true;
      }
      expect(termino).toBe(true);
    }
  }, 240_000);

  it('nunca ataca en desventaja de dados', () => {
    // El bot solo ataca cuando tira mas dados que el defensor.
    for (let semilla = 0; semilla < 40; semilla += 1) {
      const state = makeGame({ players: 2, seed: 5000 + semilla * 13 });
      const bot = createBot(createRng(2000 + semilla));
      let actual = state;
      const ctx = contextFor(state);
      let pasos = 0;
      while (actual.phase !== 'game-over' && pasos < 400) {
        const elegido = bot.choose(actual) as Command;
        if (elegido.type === 'ATTACK') {
          const atacante = actual.territories[elegido.from]?.armies ?? 0;
          const defensor = actual.territories[elegido.to]?.armies ?? 0;
          const dadosA = Math.min(actual.config.combat.maxAttackerDice, atacante - 1);
          const dadosD = Math.min(actual.config.combat.maxDefenderDice, defensor);
          expect(dadosA).toBeGreaterThan(dadosD);
        }
        const resultado = apply(actual, elegido, actual.currentPlayer, ctx);
        if (resultado.ok) actual = resultado.value.state;
        pasos += 1;
      }
    }
  }, 120_000);

  it('devuelve null cuando la partida ya termino', () => {
    const state = makeGame({ players: 3, seed: 42 });
    const terminado = { ...state, phase: 'game-over' } as const;
    expect(createBot(createRng(1)).choose(terminado)).toBeNull();
  });
});
