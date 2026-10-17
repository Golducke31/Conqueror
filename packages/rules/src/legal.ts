/**
 * Comandos legales.
 *
 * La UI los usa para resaltar las opciones y los bots para decidir. Es una lista
 * de comandos VALIDOS, no de jugadas buenas: puede ser larga (colocar ejercitos
 * se devuelve de a uno por territorio y los ataques, uno por cantidad de dados).
 *
 * Los topes salen de `state.config`: aca no hay ningun valor de regla escrito a
 * mano.
 */

import type { PlayerId, TerritoryId } from '@conqueror/shared';

import { maxAttackerDice } from './combat.js';
import { legalTrades } from './cards.js';
import { armiesOf, enemyNeighbors, ownerOf, regroupKey, territoriesOfPlayer } from './queries.js';
import { neighborsOf } from './board.js';
import type { Command, GameState } from './types.js';

/** Limite de comandos devueltos, para que la lista no explote. */
const MAX_COMMANDS = 600;

export function getLegalCommands(state: GameState, playerId: PlayerId): readonly Command[] {
  if (state.phase === 'game-over') return [];
  const jugador = state.players.find((player) => player.id === playerId);
  if (jugador === undefined || !jugador.alive) return [];
  if (state.currentPlayer !== playerId) return [];

  const comandos: Command[] = [];

  switch (state.phase) {
    case 'setup-placement': {
      // Un comando por territorio propio, de a un ejercito: la UI elige cuanto
      // con un deslizador y el bot repite hasta agotar.
      if (state.armiesToPlace > 0) {
        for (const territory of territoriesOfPlayer(state, playerId)) {
          comandos.push({ type: 'PLACE_ARMIES', territory, count: 1 });
        }
      }
      break;
    }

    case 'reinforce': {
      if (state.armiesToPlace > 0) {
        for (const territory of territoriesOfPlayer(state, playerId)) {
          comandos.push({ type: 'PLACE_ARMIES', territory, count: 1 });
        }
      }
      for (const trio of legalTrades(jugador.cards, state.board)) {
        const [a, b, c] = trio;
        if (a === undefined || b === undefined || c === undefined) continue;
        comandos.push({ type: 'TRADE_CARDS', cardIds: [a, b, c] });
      }
      // Cerrar el refuerzo solo cuando no queda nada por colocar y no hay canje
      // obligatorio pendiente.
      const canjeObligatorio =
        state.config.cards.forcedTradeAt > 0 &&
        jugador.cards.length >= state.config.cards.forcedTradeAt;
      if (state.armiesToPlace === 0 && !canjeObligatorio) comandos.push({ type: 'END_PHASE' });
      break;
    }

    case 'attack': {
      comandos.push(...ataquesLegales(state, playerId));
      comandos.push({ type: 'END_PHASE' });
      comandos.push({ type: 'END_TURN' });
      break;
    }

    case 'conquest-move': {
      const pendiente = state.pendingConquest;
      if (pendiente !== null) {
        for (let count = pendiente.min; count <= pendiente.max; count += 1) {
          if (count < 1) continue;
          comandos.push({ type: 'MOVE_AFTER_CONQUEST', count });
        }
      }
      break;
    }

    case 'regroup': {
      comandos.push(...reagrupesLegales(state, playerId));
      comandos.push({ type: 'END_TURN' });
      break;
    }

    default:
      break;
  }

  return comandos.slice(0, MAX_COMMANDS);
}

/** Ataques legales: cada origen propio con 2+ ejercitos contra cada vecino ajeno. */
function ataquesLegales(state: GameState, playerId: PlayerId): Command[] {
  const comandos: Command[] = [];
  for (const from of territoriesOfPlayer(state, playerId)) {
    const ejercitos = armiesOf(state, from);
    const tope = maxAttackerDice(ejercitos, state.config);
    if (tope < 1) continue;
    for (const to of enemyNeighbors(state, playerId, from)) {
      for (let dice = 1; dice <= tope; dice += 1) {
        comandos.push({ type: 'ATTACK', from, to, dice: dice as 1 | 2 | 3 });
      }
    }
  }
  return comandos;
}

/**
 * Reagrupes legales: pares propios alcanzables por territorios propios.
 *
 * Los pares se sacan de las componentes conexas de territorios propios, que se
 * calculan UNA vez: hacer un BFS por par costaba O(n^3) y la simulacion de 1000
 * partidas lo pagaba.
 */
function reagrupesLegales(state: GameState, playerId: PlayerId): Command[] {
  const comandos: Command[] = [];
  const propios = territoriesOfPlayer(state, playerId);
  const alcanzables = state.config.regroup.requireOwnPath
    ? componentesPropias(state, playerId)
    : null;

  for (const from of propios) {
    const disponibles = armiesOf(state, from) - state.config.combat.minArmiesPerTerritory;
    if (disponibles < 1) continue;

    for (const to of propios) {
      if (to === from) continue;
      if (alcanzables !== null && alcanzables.get(from) !== alcanzables.get(to)) continue;
      // Los pares que ya agotaron sus movimientos no se ofrecen: `apply` los
      // rechazaria y la lista tiene que ser de comandos validos.
      const usados = state.regroupMoves[regroupKey(from, to)] ?? 0;
      if (usados >= state.config.regroup.maxMovesPerPair) continue;
      comandos.push({ type: 'REGROUP', from, to, count: disponibles });
    }
  }
  return comandos;
}

/** Componente conexa de cada territorio propio, moviendose solo por propios. */
function componentesPropias(state: GameState, playerId: PlayerId): Map<TerritoryId, number> {
  const componente = new Map<TerritoryId, number>();
  let siguiente = 0;

  for (const inicio of state.board.territories) {
    if (ownerOf(state, inicio) !== playerId || componente.has(inicio)) continue;
    const cola: TerritoryId[] = [inicio];
    componente.set(inicio, siguiente);
    while (cola.length > 0) {
      const actual = cola.shift() as TerritoryId;
      for (const vecino of neighborsOf(state.board, actual)) {
        if (componente.has(vecino) || ownerOf(state, vecino) !== playerId) continue;
        componente.set(vecino, siguiente);
        cola.push(vecino);
      }
    }
    siguiente += 1;
  }
  return componente;
}

/** Si un territorio puede ser atacado desde alguno propio. Lo usa el HUD. */
export function canAttackFrom(state: GameState, playerId: PlayerId, from: TerritoryId): boolean {
  if (ownerOf(state, from) !== playerId) return false;
  return (
    maxAttackerDice(armiesOf(state, from), state.config) >= 1 &&
    enemyNeighbors(state, playerId, from).length > 0
  );
}
