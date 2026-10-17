import { describe, expect, it } from 'vitest';

import { buildClassicBoard } from './board.js';
import {
  buildMissionDeck,
  createObjectiveProvider,
  describeMission,
  isMissionUsable,
  missionAchieved,
} from './objectives.js';
import { territoryCount } from './queries.js';
import { createRng } from './rng.js';
import {
  configWith,
  giveAllTo,
  giveContinent,
  makeGame,
  setTerritories,
  setTerritory,
} from './test-helpers.js';
import type { SecretMission } from './types.js';

const board = buildClassicBoard();

describe('misiones secretas', () => {
  describe('mazo generado', () => {
    it('incluye un par de continentes por cada combinacion', () => {
      const state = makeGame({ players: 3 });
      const mazo = buildMissionDeck(state, state.config);
      const pares = mazo.filter((mission) => mission.kind === 'conquer-continents');
      // 6 continentes: 15 pares.
      expect(pares).toHaveLength(15);
    });

    it('incluye eliminar a cada color presente y el objetivo comun', () => {
      const state = makeGame({ players: 4 });
      const mazo = buildMissionDeck(state, state.config);
      expect(mazo.filter((mission) => mission.kind === 'eliminate-player')).toHaveLength(4);
      const conquistas = mazo.filter((mission) => mission.kind === 'conquer-territories');
      expect(conquistas).toHaveLength(1);
    });
  });

  describe('reparto', () => {
    it('todos los jugadores reciben una mision usable', () => {
      const state = makeGame({ players: 5 });
      const proveedor = createObjectiveProvider('secret-missions');
      const rng = createRng(31);
      const misiones = proveedor.assign(state, state.config, rng);

      expect(Object.keys(misiones)).toHaveLength(5);
      for (const player of state.players) {
        const mision = misiones[player.id] as SecretMission;
        expect(mision, player.id).toBeDefined();
        expect(isMissionUsable(state, player.id, mision), player.id).toBe(true);
      }
    });

    it('no reparte la misma mision a dos jugadores', () => {
      const state = makeGame({ players: 6 });
      const misiones = createObjectiveProvider('secret-missions').assign(
        state,
        state.config,
        createRng(7),
      );
      const usadas = Object.values(misiones).map((mision) => JSON.stringify(mision));
      expect(new Set(usadas).size).toBe(usadas.length);
    });

    it('usa el mazo de la config cuando trae misiones', () => {
      const propias: SecretMission[] = [
        { kind: 'conquer-territories', count: 11 },
        { kind: 'conquer-territories', count: 12 },
        { kind: 'conquer-territories', count: 13 },
      ];
      const config = configWith({
        victory: { ...configWith().victory, missionDeck: propias },
      });
      const state = makeGame({ players: 3, config: { victory: config.victory } });
      const misiones = createObjectiveProvider('secret-missions').assign(
        state,
        config,
        createRng(3),
      );
      for (const player of state.players) {
        expect(misiones[player.id]?.kind).toBe('conquer-territories');
      }
    });

    it('cae al objetivo de respaldo si la mision ya estaba cumplida', () => {
      // La mision es "ocupar estos dos territorios", que p1 ya tiene.
      const base = makeGame({ players: 3, seed: 8 });
      const propios = board.territories.filter(
        (territory) => base.territories[territory]?.owner === 'p1',
      );
      const mision: SecretMission = {
        kind: 'own-territories',
        territories: [propios[0] as string, propios[1] as string],
      };
      const config = configWith({
        victory: { ...configWith().victory, missionDeck: [mision] },
      });

      expect(isMissionUsable(base, 'p1', mision)).toBe(false);
      const misiones = createObjectiveProvider('secret-missions').assign(
        base,
        config,
        createRng(4),
      );
      expect(misiones['p1']).toEqual({
        kind: 'conquer-territories',
        count: config.victory.missionFallbackTerritories,
      });
    });

    it('una mision de eliminar a un color que no juega no es usable', () => {
      const state = makeGame({ players: 2 });
      expect(
        isMissionUsable(state, 'p1', { kind: 'eliminate-player', targetColor: 'magenta' }),
      ).toBe(false);
    });

    it('no se puede eliminar a uno mismo', () => {
      const state = makeGame({ players: 3 });
      expect(isMissionUsable(state, 'p1', { kind: 'eliminate-player', targetColor: 'rojo' })).toBe(
        false,
      );
    });
  });

  describe('cumplimiento', () => {
    it('conquistar continentes', () => {
      const base = makeGame({ players: 3 });
      const mision: SecretMission = {
        kind: 'conquer-continents',
        continents: ['oceania'],
        extraTerritories: 0,
      };
      expect(missionAchieved(base, 'p1', mision)).toBe(false);
      const conOceania = giveContinent(base, 'oceania', 'p1');
      expect(missionAchieved(conOceania, 'p1', mision)).toBe(true);
    });

    it('conquistar continentes exige tambien los territorios extra', () => {
      // p1 solo tiene Oceania: nada fuera del continente.
      const soloOceania = giveContinent(giveAllTo(makeGame({ players: 3 }), 'p2'), 'oceania', 'p1');
      const mision: SecretMission = {
        kind: 'conquer-continents',
        continents: ['oceania'],
        extraTerritories: 2,
      };
      expect(missionAchieved(soloOceania, 'p1', mision)).toBe(false);

      const ajenos = board.territories.filter(
        (territory) => soloOceania.territories[territory]?.owner !== 'p1',
      );
      const conExtra = setTerritories(
        soloOceania,
        Object.fromEntries(ajenos.slice(0, 2).map((territory) => [territory, ['p1', 1]])),
      );
      expect(missionAchieved(conExtra, 'p1', mision)).toBe(true);
    });

    it('eliminar a un jugador', () => {
      const base = makeGame({ players: 3 });
      const mision: SecretMission = { kind: 'eliminate-player', targetColor: 'azul' };
      expect(missionAchieved(base, 'p1', mision)).toBe(false);
      const conMuerto = {
        ...base,
        players: base.players.map((player) =>
          player.color === 'azul' ? { ...player, alive: false } : player,
        ),
      };
      expect(missionAchieved(conMuerto, 'p1', mision)).toBe(true);
    });

    it('conquistar N territorios', () => {
      const base = makeGame({ players: 3 });
      const mision: SecretMission = { kind: 'conquer-territories', count: 20 };
      expect(missionAchieved(base, 'p1', mision)).toBe(false);

      const ajenos = board.territories.filter(
        (territory) => base.territories[territory]?.owner !== 'p1',
      );
      const necesarios = 20 - territoryCount(base, 'p1');
      const conVeinte = setTerritories(
        base,
        Object.fromEntries(ajenos.slice(0, necesarios).map((territory) => [territory, ['p1', 1]])),
      );
      expect(territoryCount(conVeinte, 'p1')).toBe(20);
      expect(missionAchieved(conVeinte, 'p1', mision)).toBe(true);
    });

    it('ocupar territorios concretos', () => {
      // p1 no tiene nada: la mision depende solo de los dos territorios.
      const base = giveAllTo(makeGame({ players: 3 }), 'p2');
      const mision: SecretMission = { kind: 'own-territories', territories: ['brasil', 'peru'] };
      expect(missionAchieved(base, 'p1', mision)).toBe(false);
      expect(missionAchieved(setTerritory(base, 'brasil', 'p1', 1), 'p1', mision)).toBe(false);
      const completo = setTerritory(setTerritory(base, 'brasil', 'p1', 1), 'peru', 'p1', 1);
      expect(missionAchieved(completo, 'p1', mision)).toBe(true);
    });
  });

  describe('objetivo comun', () => {
    it('no reparte misiones', () => {
      const state = makeGame({ players: 3 });
      const misiones = createObjectiveProvider('common-objective').assign(
        state,
        state.config,
        createRng(1),
      );
      for (const player of state.players) expect(misiones[player.id]).toBeNull();
    });

    it('se gana con la cantidad de territorios configurada', () => {
      const base = makeGame({ players: 3 });
      const objetivo = base.config.victory.commonObjectiveTerritories;
      const proveedor = createObjectiveProvider('common-objective');
      expect(proveedor.achieved(base, 'p1', base.config)).toBe(false);

      const ajenos = board.territories.filter(
        (territory) => base.territories[territory]?.owner !== 'p1',
      );
      const necesarios = objetivo - territoryCount(base, 'p1');
      const ganador = setTerritories(
        base,
        Object.fromEntries(ajenos.slice(0, necesarios).map((territory) => [territory, ['p1', 1]])),
      );
      expect(proveedor.achieved(ganador, 'p1', base.config)).toBe(true);
    });
  });

  describe('descripcion', () => {
    it('nombra continentes y territorios', () => {
      const nombres = { oceania: 'Oceanía', asia: 'Asia', rojo: 'Rojo', brasil: 'Brasil' };
      expect(
        describeMission(
          { kind: 'conquer-continents', continents: ['oceania', 'asia'], extraTerritories: 0 },
          nombres,
        ),
      ).toBe('Conquistar Oceanía y Asia');
      expect(
        describeMission(
          { kind: 'conquer-continents', continents: ['asia'], extraTerritories: 2 },
          nombres,
        ),
      ).toBe('Conquistar Asia y 2 territorios mas');
      expect(describeMission({ kind: 'eliminate-player', targetColor: 'rojo' }, nombres)).toBe(
        'Eliminar al jugador Rojo',
      );
      expect(describeMission({ kind: 'conquer-territories', count: 30 }, nombres)).toBe(
        'Conquistar 30 territorios',
      );
      expect(describeMission({ kind: 'own-territories', territories: ['brasil'] }, nombres)).toBe(
        'Ocupar Brasil',
      );
    });
  });
});
