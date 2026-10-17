import { describe, expect, it } from 'vitest';

import {
  buildDeck,
  buildShuffledDeck,
  cardSymbol,
  cardTerritory,
  CARD_SYMBOLS,
  drawCard,
  isWildcard,
  isValidTrade,
  legalTrades,
  ownTerritoryCards,
  tradeValue,
  WILDCARD_PREFIX,
} from './cards.js';
import { buildClassicBoard } from './board.js';
import { createRng } from './rng.js';
import { configWith, makeGame, setPlayer, setTerritories, setTerritory } from './test-helpers.js';

const board = buildClassicBoard();
const config = configWith();

describe('tarjetas', () => {
  describe('mazo', () => {
    it('tiene una tarjeta por territorio mas los comodines', () => {
      const mazo = buildDeck(board, config);
      expect(mazo).toHaveLength(50 + config.cards.wildcards);
      expect(mazo.filter((cardId) => isWildcard(cardId))).toHaveLength(config.cards.wildcards);
    });

    it('respeta la cantidad de comodines de la config', () => {
      const sinComodines = configWith({ cards: { ...config.cards, wildcards: 0 } });
      expect(buildDeck(board, sinComodines)).toHaveLength(50);
    });

    it('el mazo mezclado es una permutacion del mazo', () => {
      const mezclado = buildShuffledDeck(board, config, createRng(5));
      expect([...mezclado].sort()).toEqual([...buildDeck(board, config)].sort());
    });
  });

  describe('simbolos', () => {
    it('cada tarjeta de territorio tiene un simbolo del juego', () => {
      for (const territory of board.territories) {
        const simbolo = cardSymbol(territory, board);
        expect(simbolo, territory).not.toBeNull();
        expect(CARD_SYMBOLS).toContain(simbolo);
      }
    });

    it('los tres simbolos quedan repartidos de forma pareja', () => {
      const conteo = new Map<string, number>();
      for (const territory of board.territories) {
        const simbolo = cardSymbol(territory, board) as string;
        conteo.set(simbolo, (conteo.get(simbolo) ?? 0) + 1);
      }
      for (const simbolo of CARD_SYMBOLS) {
        const veces = conteo.get(simbolo) ?? 0;
        expect(veces, `${simbolo}: ${veces}`).toBeGreaterThanOrEqual(15);
        expect(veces, `${simbolo}: ${veces}`).toBeLessThanOrEqual(18);
      }
    });

    it('el comodin no tiene simbolo ni territorio', () => {
      const comodin = `${WILDCARD_PREFIX}1`;
      expect(cardSymbol(comodin, board)).toBeNull();
      expect(cardTerritory(comodin)).toBeNull();
      expect(isWildcard(comodin)).toBe(true);
    });

    it('una tarjeta de territorio conoce su territorio', () => {
      expect(cardTerritory('brasil')).toBe('brasil');
      expect(isWildcard('brasil')).toBe(false);
    });
  });

  describe('canje', () => {
    /** Tres territorios con el mismo simbolo. */
    function mismoSimbolo(): [string, string, string] {
      const primero = board.territories[0] as string;
      const simbolo = cardSymbol(primero, board);
      const iguales = board.territories.filter(
        (territory) => cardSymbol(territory, board) === simbolo,
      );
      return [iguales[0] as string, iguales[1] as string, iguales[2] as string];
    }

    /** Uno de cada simbolo. */
    function unoDeCada(): [string, string, string] {
      const elegidos = CARD_SYMBOLS.map(
        (simbolo) =>
          board.territories.find((territory) => cardSymbol(territory, board) === simbolo) as string,
      );
      return [elegidos[0] as string, elegidos[1] as string, elegidos[2] as string];
    }

    it('acepta tres iguales', () => {
      expect(isValidTrade(mismoSimbolo(), board)).toBe(true);
    });

    it('acepta una de cada simbolo', () => {
      expect(isValidTrade(unoDeCada(), board)).toBe(true);
    });

    it('rechaza dos iguales y una distinta', () => {
      const [a, b] = mismoSimbolo();
      const distinta = board.territories.find(
        (territory) => cardSymbol(territory, board) !== cardSymbol(a, board),
      ) as string;
      expect(isValidTrade([a, b, distinta], board)).toBe(false);
    });

    it('rechaza la misma tarjeta repetida', () => {
      const [a] = mismoSimbolo();
      expect(isValidTrade([a, a, a], board)).toBe(false);
    });

    it('rechaza cualquier cosa que no sean tres tarjetas', () => {
      const [a, b] = mismoSimbolo();
      expect(isValidTrade([a, b], board)).toBe(false);
      expect(isValidTrade([a, b, a, b], board)).toBe(false);
      expect(isValidTrade([], board)).toBe(false);
    });

    it('acepta comodines completando el canje', () => {
      const [a, b] = mismoSimbolo();
      expect(isValidTrade([a, b, `${WILDCARD_PREFIX}1`], board)).toBe(true);

      const [x, y] = unoDeCada();
      expect(isValidTrade([x, y, `${WILDCARD_PREFIX}2`], board)).toBe(true);
    });

    it('acepta tres comodines', () => {
      expect(
        isValidTrade([`${WILDCARD_PREFIX}1`, `${WILDCARD_PREFIX}2`, `${WILDCARD_PREFIX}3`], board),
      ).toBe(true);
    });

    it('lista solo los canjes validos de una mano', () => {
      const [a, b, c] = mismoSimbolo();
      const mano = [a, b, c, ...unoDeCada()];
      const canjes = legalTrades(mano, board);
      expect(canjes.length).toBeGreaterThan(0);
      for (const trio of canjes) expect(isValidTrade(trio, board)).toBe(true);
    });

    it('una mano sin canje no devuelve nada', () => {
      const [a, b] = mismoSimbolo();
      const distinta = board.territories.find(
        (territory) => cardSymbol(territory, board) !== cardSymbol(a, board),
      ) as string;
      expect(legalTrades([a, b, distinta], board)).toEqual([]);
    });
  });

  describe('valor del canje', () => {
    /** Estado donde p1 no tiene ningun territorio: el valor es solo la base. */
    function sinTerritoriosDeP1(): ReturnType<typeof makeGame> {
      const state = makeGame();
      const cambios: Record<string, readonly ['p2', number]> = {};
      for (const territory of state.board.territories) cambios[territory] = ['p2', 1];
      return setTerritories(state, cambios);
    }

    const tresIguales = board.territories.filter(
      (territory) => cardSymbol(territory, board) === CARD_SYMBOLS[0],
    ) as unknown as [string, string, string];

    const unoDeCada = CARD_SYMBOLS.map(
      (simbolo) =>
        board.territories.find((territory) => cardSymbol(territory, board) === simbolo) as string,
    ) as unknown as [string, string, string];

    it('tres iguales vale el valor base de la config', () => {
      const state = sinTerritoriosDeP1();
      expect(tradeValue(tresIguales, state, 'p1', config)).toBe(config.cards.tradeValue.allSame);
    });

    it('una de cada simbolo vale el valor de distintas', () => {
      const state = sinTerritoriosDeP1();
      expect(tradeValue(unoDeCada, state, 'p1', config)).toBe(config.cards.tradeValue.allDifferent);
    });

    it('escala con los canjes ya hechos', () => {
      const base = sinTerritoriosDeP1();
      const conCanjes = { ...base, trades: 3 };
      const esperado = config.cards.tradeValue.allDifferent + config.cards.escalatingStep * 3;
      expect(tradeValue(unoDeCada, conCanjes, 'p1', config)).toBe(esperado);
    });

    it('suma por cada tarjeta cuyo territorio es del jugador', () => {
      const base = sinTerritoriosDeP1();
      const [a, b, c] = unoDeCada;

      const sinBonus = tradeValue([a, b, c], base, 'p1', config);
      const conUno = tradeValue([a, b, c], setTerritory(base, a, 'p1', 3), 'p1', config);
      const conDos = tradeValue(
        [a, b, c],
        setTerritory(setTerritory(base, a, 'p1', 3), b, 'p1', 3),
        'p1',
        config,
      );

      expect(conUno - sinBonus).toBe(config.cards.ownTerritoryBonus);
      expect(conDos - sinBonus).toBe(config.cards.ownTerritoryBonus * 2);
      expect(ownTerritoryCards([a, b, c], setTerritory(base, a, 'p1', 3), 'p1')).toBe(1);
    });

    it('el comodin no suma bonus de territorio', () => {
      const state = sinTerritoriosDeP1();
      expect(ownTerritoryCards([`${WILDCARD_PREFIX}1`], state, 'p1')).toBe(0);
    });
  });

  describe('robo', () => {
    it('saca la primera del mazo', () => {
      const robo = drawCard(['brasil', 'peru'], [], createRng(1));
      expect(robo.card).toBe('brasil');
      expect(robo.deck).toEqual(['peru']);
    });

    it('rebaraja los descartes cuando el mazo se agoto', () => {
      const robo = drawCard([], ['brasil', 'peru'], createRng(1));
      expect(robo.card).not.toBeNull();
      expect(robo.discard).toEqual([]);
      expect(robo.deck).toHaveLength(1);
    });

    it('sin mazo ni descartes no roba nada (no es un error)', () => {
      const robo = drawCard([], [], createRng(1));
      expect(robo.card).toBeNull();
    });

    it('el robo no toca las listas de entrada', () => {
      const mazo = ['brasil', 'peru'];
      const descartes = ['chile'];
      drawCard(mazo, descartes, createRng(1));
      expect(mazo).toEqual(['brasil', 'peru']);
      expect(descartes).toEqual(['chile']);
    });
  });

  describe('mano del jugador', () => {
    it('el estado arranca sin tarjetas', () => {
      const state = makeGame();
      for (const player of state.players) expect(player.cards).toEqual([]);
    });

    it('se pueden pisar las tarjetas de un jugador para un escenario', () => {
      const state = setPlayer(makeGame(), 'p1', { cards: ['brasil', 'peru', 'chile'] });
      expect(state.players[0]?.cards).toHaveLength(3);
    });
  });
});
