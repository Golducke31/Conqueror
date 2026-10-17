/**
 * Tarjetas: mazo, robo y canje.
 *
 * Reglas clasicas (todas configurables en `RulesConfig.cards`):
 *   - El mazo tiene una tarjeta por territorio mas los comodines.
 *   - Se roba UNA al cerrar el turno si se conquisto al menos un territorio.
 *   - El canje es de tres tarjetas: tres iguales o una de cada simbolo.
 *   - El valor base depende del tipo de canje, sube con cada canje ya hecho y
 *     suma un bonus por cada tarjeta cuyo territorio el jugador domina.
 *
 * El simbolo de cada tarjeta de territorio se DERIVA del orden del tablero
 * (`indice % 3`): el reparto real del tablero fisico no esta disponible y asi
 * queda determinista, parejo entre los tres simbolos y testeable.
 */

import type { CardId, CardSymbol, PlayerId, RulesConfig } from '@conqueror/shared';

import { shuffle } from './rng.js';
import type { Board, GameState, Rng } from './types.js';

/** Simbolo de una tarjeta de territorio. */
export const CARD_SYMBOLS: readonly CardSymbol[] = ['barco', 'canion', 'globo'];

/** Prefijo de los comodines. */
export const WILDCARD_PREFIX = 'comodin:';

/** Si una tarjeta es comodin (vale por cualquier simbolo). */
export function isWildcard(cardId: CardId): boolean {
  return cardId.startsWith(WILDCARD_PREFIX);
}

/** Territorio de una tarjeta, o `null` si es comodin. */
export function cardTerritory(cardId: CardId): string | null {
  return isWildcard(cardId) ? null : cardId;
}

/** Simbolo de una tarjeta, o `null` si es comodin (vale por cualquiera). */
export function cardSymbol(cardId: CardId, board: Board): CardSymbol | null {
  if (isWildcard(cardId)) return null;
  const indice = board.territories.indexOf(cardId);
  if (indice < 0) return null;
  return CARD_SYMBOLS[indice % CARD_SYMBOLS.length] ?? null;
}

/** Arma el mazo: una tarjeta por territorio mas los comodines de la config. */
export function buildDeck(board: Board, config: RulesConfig): CardId[] {
  const cartas: CardId[] = [...board.territories];
  for (let index = 0; index < config.cards.wildcards; index += 1) {
    cartas.push(`${WILDCARD_PREFIX}${index + 1}`);
  }
  return cartas;
}

/** Mazo mezclado y listo para repartir. */
export function buildShuffledDeck(board: Board, config: RulesConfig, rng: Rng): CardId[] {
  return shuffle(buildDeck(board, config), rng);
}

/**
 * Si tres tarjetas forman un canje valido: tres iguales o una de cada simbolo.
 * Los comodines valen por cualquier simbolo.
 */
export function isValidTrade(cardIds: readonly CardId[], board: Board): boolean {
  if (cardIds.length !== 3) return false;
  if (new Set(cardIds).size !== 3) return false; // no se repite la misma tarjeta

  const simbolos: CardSymbol[] = [];
  for (const cardId of cardIds) {
    const simbolo = cardSymbol(cardId, board);
    if (simbolo !== null) simbolos.push(simbolo);
  }

  const distintos = new Set(simbolos).size;
  const comodines = cardIds.length - simbolos.length;
  // Tres iguales (los comodines completan) o una de cada simbolo (los comodines
  // hacen de los que falten).
  return distintos <= 1 || distintos + comodines === 3;
}

/**
 * Cuantas cartas del canje corresponden a territorios del jugador: cada una
 * suma `config.cards.ownTerritoryBonus` ejercitos.
 */
export function ownTerritoryCards(
  cardIds: readonly CardId[],
  state: GameState,
  playerId: PlayerId,
): number {
  return cardIds.filter((cardId) => {
    const territory = cardTerritory(cardId);
    if (territory === null) return false;
    return state.territories[territory]?.owner === playerId;
  }).length;
}

/**
 * Ejercitos que otorga un canje: valor base del tipo de canje, mas la escalada
 * por los canjes ya hechos, mas el bonus por territorio propio.
 */
export function tradeValue(
  cardIds: readonly CardId[],
  state: GameState,
  playerId: PlayerId,
  config: RulesConfig,
): number {
  const simbolos = cardIds
    .map((cardId) => cardSymbol(cardId, state.board))
    .filter((simbolo): simbolo is CardSymbol => simbolo !== null);
  const todosIguales = new Set(simbolos).size <= 1;

  const base = todosIguales
    ? config.cards.tradeValue.allSame
    : config.cards.tradeValue.allDifferent;
  const escalada = config.cards.escalatingStep * state.trades;
  const bonus = config.cards.ownTerritoryBonus * ownTerritoryCards(cardIds, state, playerId);
  return base + escalada + bonus;
}

/**
 * Roba una tarjeta del mazo. Si se agoto, rebaraja los descartes; si tampoco
 * hay, devuelve `null` (no es un error: el juego sigue).
 */
export function drawCard(
  deck: readonly CardId[],
  discard: readonly CardId[],
  rng: Rng,
): {
  readonly card: CardId | null;
  readonly deck: readonly CardId[];
  readonly discard: readonly CardId[];
} {
  if (deck.length === 0) {
    if (discard.length === 0) return { card: null, deck, discard };
    const rebarajado = shuffle(discard, rng);
    const [primera, ...resto] = rebarajado;
    return {
      card: primera ?? null,
      deck: resto,
      discard: [],
    };
  }

  const [primera, ...resto] = deck;
  return { card: primera ?? null, deck: resto, discard };
}

/** Todas las combinaciones de tres tarjetas de una mano que son canje valido. */
export function legalTrades(
  cards: readonly CardId[],
  board: Board,
): readonly (readonly CardId[])[] {
  const combinaciones: CardId[][] = [];
  for (let a = 0; a < cards.length; a += 1) {
    for (let b = a + 1; b < cards.length; b += 1) {
      for (let c = b + 1; c < cards.length; c += 1) {
        const trio = [cards[a] as CardId, cards[b] as CardId, cards[c] as CardId];
        if (isValidTrade(trio, board)) combinaciones.push(trio);
      }
    }
  }
  return combinaciones;
}
