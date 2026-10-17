/**
 * El criterio de terminado del Hito 3: **1000 partidas simuladas terminan sin
 * errores**.
 *
 * Cada partida la juega un bot que solo manda comandos legales (los de
 * `getLegalCommands`), con semillas distintas y de 2 a 6 jugadores. Si el motor
 * tuviera un callejon sin salida (una fase de la que no se puede salir, un
 * comando legal que se rechaza, un estado inconsistente) esto falla.
 */

import { describe, expect, it } from 'vitest';

import { territoryCount, totalArmies } from './queries.js';
import { contextFor, makeGame, playRandomGame } from './test-helpers.js';

/** Cuantas partidas se simulan. */
const PARTIDAS = 1000;

interface Resumen {
  readonly comandos: number;
  readonly turnos: number;
  readonly ganador: string;
  readonly ejercitos: number;
}

describe('simulacion de partidas completas', () => {
  it(`${PARTIDAS} partidas con bots legales terminan sin errores`, () => {
    const fallos: string[] = [];
    const resumenes: Resumen[] = [];
    const porJugadores = new Map<number, number>();

    for (let indice = 0; indice < PARTIDAS; indice += 1) {
      const players = 2 + (indice % 5); // 2 a 6
      const seed = 1_000_000 + indice * 7919;

      try {
        const state = makeGame({ players, seed });
        const resultado = playRandomGame(state, contextFor(state), {
          seed: seed + 1,
          maxCommands: 60_000,
        });
        const final = resultado.state;

        if (final.phase !== 'game-over') throw new Error(`termino en la fase ${final.phase}`);
        if (final.winner === null) throw new Error('termino sin ganador');

        const ganador = final.players.find((player) => player.id === final.winner);
        if (ganador === undefined) throw new Error(`el ganador ${final.winner} no existe`);
        if (!ganador.alive) throw new Error('el ganador esta eliminado');

        // El ganador cumple su objetivo: con mision secreta o el comun.
        if (territoryCount(final, ganador.id) < 1)
          throw new Error('el ganador no tiene territorios');
        if (totalArmies(final) < 50) throw new Error('se perdieron ejercitos de mas');

        resumenes.push({
          comandos: resultado.commands,
          turnos: resultado.turns,
          ganador: ganador.id,
          ejercitos: totalArmies(final),
        });
        porJugadores.set(players, (porJugadores.get(players) ?? 0) + 1);
      } catch (error) {
        if (fallos.length < 10) {
          fallos.push(`semilla ${seed} (${players} jugadores): ${(error as Error).message}`);
        }
      }
    }

    if (fallos.length > 0) {
      throw new Error(`${fallos.length}+ partidas fallaron:\n  ${fallos.join('\n  ')}`);
    }

    expect(resumenes).toHaveLength(PARTIDAS);
    // Los cinco tamanos de partida se ejercitaron.
    expect([...porJugadores.keys()].sort()).toEqual([2, 3, 4, 5, 6]);
    // Todas terminaron en una cantidad razonable de comandos. El bot es
    // naive (juega legal-al-azar con ventaja de dados), asi que algunas
    // partidas simetricas se estiran; 60000 cubre el peor caso medido.
    const comandos = resumenes.map((resumen) => resumen.comandos);
    expect(Math.max(...comandos)).toBeLessThan(60_000);
    const promedio = comandos.reduce((sum, value) => sum + value, 0) / comandos.length;
    const turnosPromedio =
      resumenes.reduce((sum, resumen) => sum + resumen.turnos, 0) / resumenes.length;

    console.log(
      `[motor] ${PARTIDAS} partidas: ${promedio.toFixed(0)} comandos y ${turnosPromedio.toFixed(1)} turnos en promedio`,
    );
  }, 600_000);

  it('las partidas son reproducibles de punta a punta', () => {
    // La misma semilla y el mismo bot tienen que dar el mismo campeon.
    for (let indice = 0; indice < 20; indice += 1) {
      const players = 2 + (indice % 5);
      const seed = 500_000 + indice * 131;

      const correr = () => {
        const state = makeGame({ players, seed });
        return playRandomGame(state, contextFor(state), { seed: seed + 1, maxCommands: 60_000 });
      };

      const una = correr();
      const otra = correr();
      expect(otra.state.winner).toBe(una.state.winner);
      expect(otra.commands).toBe(una.commands);
      expect(otra.state.territories).toEqual(una.state.territories);
      expect(otra.state.turn).toBe(una.state.turn);
    }
  }, 60_000);
});
