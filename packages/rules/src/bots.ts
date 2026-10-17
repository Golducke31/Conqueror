/**
 * Bots.
 *
 * Nivel 1 (el unico del Hito 4): elegir SIEMPRE un comando legal, con un
 * criterio minimo para que la partida avance y no oscile:
 *   - reforzar concentrando en el frente,
 *   - atacar solo con ventaja de dados,
 *   - consolidar las conquistas moviendo el maximo,
 *   - cerrar el turno antes que reagrupar.
 * El azar (con semilla propia) decide dentro de cada criterio.
 *
 * Los bots viven en el motor (plan, seccion 5) porque los comparten el cliente
 * (modo local) y el servidor (reemplazo de AFK, Hito 6).
 *
 * Nivel 2 (heuristico: completar continentes, atacar con ventaja numerica,
 * reforzar fronteras expuestas) llega en el Hito 7.
 */

import type { PlayerId } from '@conqueror/shared';

import { getLegalCommands } from './legal.js';
import { armiesOf } from './queries.js';
import type { Command, GameState, Rng } from './types.js';

/** Prioridad de los comandos para el bot: atacar primero y cerrar el turno. */
const PRIORIDAD: Readonly<Record<Command['type'], number>> = {
  ATTACK: 0,
  MOVE_AFTER_CONQUEST: 1,
  TRADE_CARDS: 2,
  PLACE_ARMIES: 3,
  END_PHASE: 4,
  END_TURN: 5,
  REGROUP: 6,
  SURRENDER: 7,
};

/** Cuantos ejercitos colocar por comando (el resto espera al siguiente). */
const LOTE_COLOCADO = 3;

/** Un bot: elige el siguiente comando para el jugador de turno. */
export interface Bot {
  /** Comando elegido, o `null` si no hay nada legal (no deberia pasar). */
  choose(state: GameState): Command | null;
}

/**
 * Territorio propio donde conviene colocar refuerzos: el del frente con mas
 * ejercitos (a igualdad, el que mas vecinos enemigos tiene). Concentrar en el
 * frente es lo que permite atacar; colocarlos en el interior deja la partida
 * estancada.
 */
function destinoRefuerzo(
  state: GameState,
  playerId: PlayerId,
): { territory: string; enemigos: number } | null {
  const propios = state.board.territories.filter(
    (territory) => state.territories[territory]?.owner === playerId,
  );
  if (propios.length === 0) return null;

  const enemigosDe = (territory: string): number =>
    (state.board.neighbors[territory] ?? []).filter(
      (vecino) => state.territories[vecino]?.owner !== playerId,
    ).length;

  const frente = propios.filter((territory) => enemigosDe(territory) > 0);
  const candidatos = frente.length > 0 ? frente : propios;

  let mejor = candidatos[0] as string;
  for (const territorio of candidatos) {
    const ejercitos = armiesOf(state, territorio);
    const mejorEjercitos = armiesOf(state, mejor);
    if (ejercitos !== mejorEjercitos) {
      if (ejercitos > mejorEjercitos) mejor = territorio;
      continue;
    }
    if (enemigosDe(territorio) > enemigosDe(mejor)) mejor = territorio;
  }

  return { territory: mejor, enemigos: enemigosDe(mejor) };
}

/**
 * Comando de colocacion: lotes de `LOTE_COLOCADO` al destino de refuerzo, sin
 * pasarse de lo que queda ni del tope de la ronda.
 *
 * `getLegalCommands` expone la colocacion de a uno (la UI elige la cantidad con
 * un deslizador sobre ese comando base), pero `apply` acepta hasta el tope: el
 * bot coloca en lotes porque es lo que hace avanzar la partida. Quien verifique
 * legalidad tiene que usar `apply`, no la lista.
 */
function comandoColocar(state: GameState): Command | null {
  const jugador = state.currentPlayer;
  const destino = destinoRefuerzo(state, jugador);
  if (destino === null) return null;
  const tope = state.placementRoundAllowance ?? Number.POSITIVE_INFINITY;
  const count = Math.min(LOTE_COLOCADO, state.armiesToPlace, tope);
  if (count < 1) return null;
  return { type: 'PLACE_ARMIES', territory: destino.territory, count };
}

/**
 * Si un ataque tiene ventaja real de dados. Atacar 2 contra 1 o 3 contra 2 es
 * un empate que gana el defensor: el atacante nunca avanza y la frontera oscila
 * sin fin. Los topes salen de la config.
 */
function conVentaja(state: GameState, comando: Command): boolean {
  if (comando.type !== 'ATTACK') return false;
  const atacante = state.territories[comando.from]?.armies ?? 0;
  const defensor = state.territories[comando.to]?.armies ?? 0;
  const dadosA = Math.min(state.config.combat.maxAttackerDice, atacante - 1);
  const dadosD = Math.min(state.config.combat.maxDefenderDice, defensor);
  return dadosA > dadosD;
}

/** Uno de cada N turnos el bot reagrupa, para romper simetrias. */
const REGROUP_CHANCE = 4;

/**
 * Crea un bot nivel 1. El Rng es propio del bot (semilla propia, estado en
 * memoria): la partida sigue siendo reproducible desde su propia semilla y el
 * bot aporta su azar sin tocar el RNG del juego.
 */
export function createBot(rng: Rng): Bot {
  return {
    choose(state: GameState): Command | null {
      if (state.phase === 'game-over') return null;
      const legales = getLegalCommands(state, state.currentPlayer);
      if (legales.length === 0) return null;

      // La colocacion de refuerzos es la unica fase donde el bot decide por
      // cuenta propia: concentra lotes en la cuna de frente. En el despliegue
      // inicial coloca al azar (como cualquier otro comando): repartir al azar
      // rompe las simetrias iniciales, que si no dejan la partida oscilando.
      if (state.phase === 'reinforce' && state.armiesToPlace > 0) {
        const colocar = comandoColocar(state);
        if (colocar !== null) return colocar;
      }

      const mejor = Math.min(...legales.map((comando) => PRIORIDAD[comando.type]));
      let candidatos = legales.filter((comando) => PRIORIDAD[comando.type] === mejor);

      if (mejor === PRIORIDAD.ATTACK) {
        const conVentajaLista = candidatos.filter((comando) => conVentaja(state, comando));
        if (conVentajaLista.length > 0) {
          const margen = (comando: Command): number =>
            comando.type === 'ATTACK'
              ? (state.territories[comando.from]?.armies ?? 0) -
                (state.territories[comando.to]?.armies ?? 0)
              : Number.NEGATIVE_INFINITY;
          const mejorMargen = Math.max(...conVentajaLista.map(margen));
          // Tolerancia de 1 para no volver la eleccion totalmente deterministica.
          candidatos = conVentajaLista.filter((comando) => margen(comando) >= mejorMargen - 1);
        } else {
          // Sin ventaja no se ataca: se acumula y se espera el proximo refuerzo.
          candidatos = legales.filter((comando) => comando.type === 'END_PHASE');
        }
      }

      if (mejor === PRIORIDAD.MOVE_AFTER_CONQUEST) {
        // Consolidar: mover el maximo para que la cuna avance.
        const maximo = Math.max(
          ...candidatos.map((comando) =>
            comando.type === 'MOVE_AFTER_CONQUEST' ? comando.count : 0,
          ),
        );
        candidatos = candidatos.filter(
          (comando) => comando.type === 'MOVE_AFTER_CONQUEST' && comando.count === maximo,
        );
      }

      // Reagruneo ocasional: una de cada N veces, en lugar de cerrar el turno,
      // mueve ejercitos entre territorios propios. Rompe las simetrias de
      // disposicion que si no dejan la partida oscilando sin terminar nunca.
      if (mejor === PRIORIDAD.END_TURN && rng.int(1, REGROUP_CHANCE) === 1) {
        const reagrupes = legales.filter((comando) => comando.type === 'REGROUP');
        if (reagrupes.length > 0) candidatos = reagrupes;
      }

      if (candidatos.length === 0) return null;
      return candidatos[rng.int(0, candidatos.length - 1)] ?? null;
    },
  };
}
