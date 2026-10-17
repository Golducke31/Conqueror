import { describe, expect, it } from 'vitest';

import { buildClassicBoard } from './board.js';
import { buildDeck } from './cards.js';
import {
  armyCount,
  armiesOf,
  continentBonus,
  hasOwnPath,
  nextAlivePlayer,
  ownedContinents,
  ownerOf,
  reinforcementsFor,
  territoryCount,
  totalArmies,
  unownedCount,
} from './queries.js';
import {
  createGameState,
  initialArmiesForPlayerCount,
  placementAllowanceForRound,
  publicState,
} from './state.js';
import { configWith, makeGame, playersFor, setTerritories, setTerritory } from './test-helpers.js';

const board = buildClassicBoard();

describe('armado de la partida', () => {
  it('reparte los 50 territorios, cada uno con 1 ejercito', () => {
    const state = makeGame({ players: 3 });
    expect(Object.keys(state.territories)).toHaveLength(50);
    expect(unownedCount(state)).toBe(0);
    for (const territory of board.territories) {
      expect(armiesOf(state, territory)).toBe(1);
      expect(ownerOf(state, territory)).not.toBeNull();
    }
  });

  it('reparte parejo entre los jugadores', () => {
    for (const cantidad of [2, 3, 4, 5, 6]) {
      const state = makeGame({ players: cantidad, seed: cantidad * 13 });
      const conteos = state.players.map((player) => territoryCount(state, player.id));
      const maximo = Math.max(...conteos);
      const minimo = Math.min(...conteos);
      expect(maximo - minimo, `${cantidad} jugadores: ${conteos.join(',')}`).toBeLessThanOrEqual(1);
      expect(conteos.reduce((sum, value) => sum + value, 0)).toBe(50);
    }
  });

  it('arranca en la fase de despliegue con el total de ejercitos por jugador', () => {
    const state = makeGame({ players: 4 });
    expect(state.phase).toBe('setup-placement');
    expect(state.armiesToPlace).toBe(initialArmiesForPlayerCount(4, state.config));
    expect(state.placementRound).toBe(1);
    expect(state.placementRoundAllowance).toBe(state.config.initialPlacement.firstRound);
    expect(state.currentPlayer).toBe('p1');
    expect(state.winner).toBeNull();
  });

  it('arma el mazo completo y sin repartir', () => {
    const state = makeGame({ players: 3 });
    expect(state.deck).toHaveLength(buildDeck(board, state.config).length);
    expect(state.discard).toEqual([]);
    for (const player of state.players) expect(player.cards).toEqual([]);
  });

  it('la misma semilla reparte lo mismo', () => {
    const una = makeGame({ players: 4, seed: 99 });
    const otra = makeGame({ players: 4, seed: 99 });
    expect(una.territories).toEqual(otra.territories);
    expect(una.deck).toEqual(otra.deck);
    expect(una.players.map((player) => player.mission)).toEqual(
      otra.players.map((player) => player.mission),
    );
  });

  it('semillas distintas reparten distinto', () => {
    const una = makeGame({ players: 3, seed: 1 });
    const otra = makeGame({ players: 3, seed: 2 });
    expect(una.territories).not.toEqual(otra.territories);
  });

  it('rechaza cantidades de jugadores fuera de la config', () => {
    expect(() =>
      createGameState({ players: playersFor(1), config: configWith(), seed: 1 }),
    ).toThrow();
    expect(() =>
      createGameState({ players: playersFor(7), config: configWith(), seed: 1 }),
    ).toThrow();
  });

  it('rechaza ids y colores repetidos', () => {
    const jugadores = playersFor(3);
    const repetidos = [
      jugadores[0],
      { ...jugadores[1], id: jugadores[0]?.id ?? 'p1' },
      jugadores[2],
    ] as typeof jugadores;
    expect(() => createGameState({ players: repetidos, config: configWith(), seed: 1 })).toThrow();

    const mismoColor = [
      jugadores[0],
      { ...jugadores[1], color: jugadores[0]?.color ?? 'rojo' },
      jugadores[2],
    ] as typeof jugadores;
    expect(() => createGameState({ players: mismoColor, config: configWith(), seed: 1 })).toThrow();
  });

  it('rechaza un tablero vacio', () => {
    const vacio = { ...board, territories: [], neighbors: {} };
    expect(() =>
      createGameState({ players: playersFor(2), config: configWith(), seed: 1, board: vacio }),
    ).toThrow();
  });

  it('respeta la cantidad de jugadores de la config', () => {
    const soloDos = configWith({ players: { min: 2, max: 2 } });
    expect(() => createGameState({ players: playersFor(3), config: soloDos, seed: 1 })).toThrow();
    expect(
      createGameState({ players: playersFor(2), config: soloDos, seed: 1 }).players,
    ).toHaveLength(2);
  });
});

describe('rondas del despliegue inicial', () => {
  it('la primera ronda coloca 5 y las siguientes 3', () => {
    const config = configWith();
    expect(placementAllowanceForRound(1, config)).toBe(5);
    expect(placementAllowanceForRound(2, config)).toBe(3);
    expect(placementAllowanceForRound(9, config)).toBe(3);
  });

  it('los totales por cantidad de jugadores salen de la config', () => {
    const config = configWith();
    expect(initialArmiesForPlayerCount(2, config)).toBe(40);
    expect(initialArmiesForPlayerCount(6, config)).toBe(20);
    expect(initialArmiesForPlayerCount(4, config)).toBe(30);
  });

  it('con la config por defecto se llega al total con las rondas', () => {
    const config = configWith();
    for (const cantidad of [2, 3, 4, 5, 6]) {
      const total = initialArmiesForPlayerCount(cantidad, config);
      let colocado = placementAllowanceForRound(1, config);
      let ronda = 1;
      while (colocado < total && ronda < 100) {
        ronda += 1;
        colocado += placementAllowanceForRound(ronda, config);
      }
      expect(colocado, `${cantidad} jugadores`).toBeGreaterThanOrEqual(total);
    }
  });
});

describe('consultas', () => {
  it('cuenta territorios y ejercitos de cada jugador', () => {
    const state = makeGame({ players: 3 });
    for (const player of state.players) {
      expect(armyCount(state, player.id)).toBe(territoryCount(state, player.id));
    }
    expect(totalArmies(state)).toBe(50);
  });

  it('detecta los continentes dominados y su bonus', () => {
    const state = setTerritories(
      makeGame({ players: 3 }),
      Object.fromEntries(
        (board.territoriesByContinent['oceania'] ?? []).map((territory) => [territory, ['p1', 2]]),
      ),
    );
    expect(ownedContinents(state, 'p1')).toContain('oceania');
    expect(continentBonus(state, 'p1', state.config)).toBe(
      state.config.continentBonuses['oceania'],
    );
  });

  it('el refuerzo es el mayor entre el minimo y los territorios divididos', () => {
    const state = makeGame({ players: 3 });
    const config = state.config;
    for (const player of state.players) {
      const territorios = territoryCount(state, player.id);
      const esperado = Math.max(
        config.reinforcement.minimum,
        Math.floor(territorios / config.reinforcement.divisor),
      );
      expect(reinforcementsFor(state, player.id, config)).toBe(esperado);
    }
  });

  it('el refuerzo suma los continentes completos', () => {
    const base = makeGame({ players: 3 });
    const oceania = board.territoriesByContinent['oceania'] ?? [];
    const state = setTerritories(
      base,
      Object.fromEntries(oceania.map((territory) => [territory, ['p1', 1]])),
    );
    const sinBonus = reinforcementsFor(base, 'p1', base.config);
    const conBonus = reinforcementsFor(state, 'p1', state.config);
    expect(conBonus - sinBonus).toBeGreaterThanOrEqual(
      state.config.continentBonuses['oceania'] as number,
    );
  });

  it('encuentra caminos por territorios propios', () => {
    const base = makeGame({ players: 3 });
    // Todo el continente de Oceania es de p1.
    const oceania = board.territoriesByContinent['oceania'] ?? [];
    const state = setTerritories(
      base,
      Object.fromEntries(oceania.map((territory) => [territory, ['p1', 2]])),
    );

    const [primero, segundo] = oceania as [string, string];
    expect(hasOwnPath(state, 'p1', primero, segundo)).toBe(true);
    // Un territorio de otro jugador no sirve de puente.
    const ajeno = board.territories.find(
      (territory) => ownerOf(state, territory) !== 'p1',
    ) as string;
    expect(hasOwnPath(state, 'p1', primero, ajeno)).toBe(false);
  });

  it('el siguiente jugador saltea a los eliminados', () => {
    const state = makeGame({ players: 4 });
    const conMuerto = {
      ...state,
      players: state.players.map((player) =>
        player.id === 'p2' ? { ...player, alive: false } : player,
      ),
    };
    expect(nextAlivePlayer(conMuerto, 'p1')).toBe('p3');
    expect(nextAlivePlayer(conMuerto, 'p4')).toBe('p1');
  });
});

describe('vista publica', () => {
  it('no expone tarjetas ni misiones ajenas', () => {
    const base = makeGame({ players: 3 });
    const state = {
      ...base,
      players: base.players.map((player, index) => ({
        ...player,
        cards: index === 0 ? ['brasil'] : ['peru', 'chile'],
      })),
    };

    const publico = publicState(state, 'p1');
    expect(publico.ownCards).toEqual(['brasil']);
    expect(publico.ownMission).toEqual(state.players[0]?.mission);

    const p2 = publico.players.find((player) => player.id === 'p2');
    expect(p2?.cardCount).toBe(2);
    // El objeto publico no tiene el campo `cards`: no hay forma de filtrarlo mal.
    expect(Object.keys(p2 ?? {})).not.toContain('cards');
    expect(Object.keys(p2 ?? {})).not.toContain('mission');
  });

  it('resume territorios y ejercitos por jugador', () => {
    const state = makeGame({ players: 3 });
    const publico = publicState(state, 'p1');
    for (const player of state.players) {
      const resumen = publico.players.find((candidato) => candidato.id === player.id);
      expect(resumen?.territories).toBe(territoryCount(state, player.id));
      expect(resumen?.armies).toBe(armyCount(state, player.id));
    }
    expect(Object.keys(publico.territories)).toHaveLength(50);
  });

  it('refleja la fase, el turno y el ganador', () => {
    const state = setTerritory(makeGame({ players: 3 }), 'brasil', 'p1', 5);
    const publico = publicState(state, 'p1');
    expect(publico.phase).toBe('setup-placement');
    expect(publico.activePlayer).toBe('p1');
    expect(publico.winner).toBeNull();
    expect(publico.territories['brasil']).toEqual({ owner: 'p1', armies: 5 });
  });
});
