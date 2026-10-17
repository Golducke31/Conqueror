/**
 * Tests puros de la matriz clasica del tablero.
 * No dependen de los datos de Natural Earth: validan el grafo de reglas.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES_CONFIG } from '@conqueror/shared';
import { loadMapConfig, parseMapConfig } from './load-config.js';
import {
  CLASSIC_BOARD_CONTINENTS,
  CLASSIC_BOARD_NEIGHBORS,
  CLASSIC_BOARD_TERRITORIES_BY_CONTINENT,
  CONTINENT_ORDER,
  TERRITORY_IDS,
  classicBoardEdges,
  edgesToNeighbors,
  normalizePair,
  pairKey,
} from './classic-board.js';

const CONFIG_PATH = fileURLToPath(new URL('../territories.config.json', import.meta.url));
const config = loadMapConfig(CONFIG_PATH);

/** Recorrido en anchura sobre un mapa de vecinos. */
function connectedComponent(
  start: string,
  neighbors: Readonly<Record<string, readonly string[]>>,
): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const next of neighbors[current] ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

describe('matriz clasica del tablero', () => {
  it('declara exactamente 50 territorios', () => {
    expect(TERRITORY_IDS).toHaveLength(50);
  });

  it('la adyacencia es simetrica', () => {
    const asimetricos: string[] = [];
    for (const [from, vecinos] of Object.entries(CLASSIC_BOARD_NEIGHBORS)) {
      for (const to of vecinos) {
        const vuelta = CLASSIC_BOARD_NEIGHBORS[to];
        expect(vuelta, `vecino desconocido: ${to}`).toBeDefined();
        if (vuelta !== undefined && !vuelta.includes(from)) {
          asimetricos.push(`${from} -> ${to}`);
        }
      }
    }
    expect(asimetricos).toEqual([]);
  });

  it('no tiene autolazos ni vecinos duplicados', () => {
    for (const [from, vecinos] of Object.entries(CLASSIC_BOARD_NEIGHBORS)) {
      expect(vecinos).not.toContain(from);
      expect(new Set(vecinos).size).toBe(vecinos.length);
    }
  });

  it('no repite aristas al normalizar', () => {
    const edges = classicBoardEdges();
    const keys = edges.map(([a, b]) => pairKey(a, b));
    expect(new Set(keys).size).toBe(keys.length);
    for (const [a, b] of edges) {
      expect(normalizePair(a, b)).toEqual([a, b]);
    }
  });

  it('el grafo completo es conexo', () => {
    const neighbors = edgesToNeighbors(classicBoardEdges());
    const first = TERRITORY_IDS[0];
    expect(first).toBeDefined();
    const component = connectedComponent(first ?? '', neighbors);
    expect(component.size).toBe(50);
  });

  it('cada continente es contiguo usando solo sus propias fronteras', () => {
    const neighbors = edgesToNeighbors(classicBoardEdges());
    const byContinent = new Map<string, string[]>();
    for (const territory of config.territories) {
      const list = byContinent.get(territory.continent) ?? [];
      list.push(territory.id);
      byContinent.set(territory.continent, list);
    }

    for (const continent of CONTINENT_ORDER) {
      const members = byContinent.get(continent) ?? [];
      expect(members.length, `continente sin territorios: ${continent}`).toBeGreaterThan(0);
      const memberSet = new Set(members);
      const intra: Record<string, string[]> = {};
      for (const id of members) {
        intra[id] = (neighbors[id] ?? []).filter((n) => memberSet.has(n));
      }
      const component = connectedComponent(members[0] ?? '', intra);
      expect(component.size, `continente no contiguo: ${continent}`).toBe(members.length);
    }
  });
});

describe('territories.config.json', () => {
  it('declara los mismos ids que la matriz clasica', () => {
    const ids = config.territories.map((t) => t.id).sort();
    expect(ids).toEqual([...TERRITORY_IDS].sort());
  });

  it('declara los 6 continentes con nombre en es-AR y en', () => {
    expect(config.continents.map((c) => c.id).sort()).toEqual([...CONTINENT_ORDER].sort());
    for (const continent of config.continents) {
      expect(continent.names['es-AR'].length).toBeGreaterThan(0);
      expect(continent.names.en.length).toBeGreaterThan(0);
    }
  });

  it('todo territorio tiene nombre en ambos idiomas y un continente valido', () => {
    const continentIds = new Set(config.continents.map((c) => c.id));
    for (const territory of config.territories) {
      expect(territory.names['es-AR'].length, territory.id).toBeGreaterThan(0);
      expect(territory.names.en.length, territory.id).toBeGreaterThan(0);
      expect(
        continentIds.has(territory.continent),
        `${territory.id} -> ${territory.continent}`,
      ).toBe(true);
    }
  });

  it('no repite paises ni subdivisiones entre territorios', () => {
    const used = new Map<string, string>();
    const claim = (key: string, owner: string): void => {
      const previous = used.get(key);
      expect(previous, `${key} reclamado por ${previous} y ${owner}`).toBeUndefined();
      used.set(key, owner);
    };
    for (const territory of config.territories) {
      for (const code of territory.source.countries ?? []) {
        claim(`adm0:${code}`, territory.id);
      }
      for (const [code, names] of Object.entries(territory.source.subdivisions ?? {})) {
        for (const name of names) claim(`adm1:${code}:${name}`, territory.id);
      }
    }
  });

  it('los seaLinks y las exclusiones apuntan a territorios existentes', () => {
    const ids = new Set(TERRITORY_IDS);
    for (const territory of config.territories) {
      for (const link of territory.seaLinks ?? []) {
        expect(ids.has(link), `${territory.id} -> seaLink ${link}`).toBe(true);
      }
      for (const ignored of territory.ignoreLandBorders ?? []) {
        expect(ids.has(ignored), `${territory.id} -> ignore ${ignored}`).toBe(true);
      }
    }
  });

  it('la config no reclama el mismo pais entero y subdividido a la vez', () => {
    for (const territory of config.territories) {
      const countries = new Set(territory.source.countries ?? []);
      for (const code of Object.keys(territory.source.subdivisions ?? {})) {
        expect(countries.has(code), `${territory.id} reclama ${code} entero y subdividido`).toBe(
          false,
        );
      }
    }
  });
});

describe('validacion de la config', () => {
  it('rechaza una config sin territorios', () => {
    const raw: unknown = { ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')), territories: [] };
    expect(() => parseMapConfig(raw)).toThrow();
  });

  it('rechaza un territorio sin nombre en ingles', () => {
    const base = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as {
      territories: { names: Record<string, string> }[];
    };
    const first = base.territories[0];
    expect(first).toBeDefined();
    if (first !== undefined) delete first.names.en;
    expect(() => parseMapConfig(base)).toThrow();
  });
});

describe('continentes del tablero clasico', () => {
  it('cada territorio del config tiene su continente en la matriz', () => {
    for (const territory of config.territories) {
      expect(
        CLASSIC_BOARD_CONTINENTS[territory.id],
        `${territory.id} falta en CLASSIC_BOARD_CONTINENTS`,
      ).toBe(territory.continent);
    }
  });

  it('la matriz no declara continentes de territorios que no existen', () => {
    expect(Object.keys(CLASSIC_BOARD_CONTINENTS).sort()).toEqual([...TERRITORY_IDS].sort());
  });

  it('los territorios por continente cubren el tablero sin repetir', () => {
    const vistos = new Set<string>();
    for (const continent of CONTINENT_ORDER) {
      const territorios = CLASSIC_BOARD_TERRITORIES_BY_CONTINENT[continent] ?? [];
      expect(territorios.length, `${continent} sin territorios`).toBeGreaterThan(0);
      for (const territorio of territorios) {
        expect(vistos.has(territorio), `${territorio} en dos continentes`).toBe(false);
        vistos.add(territorio);
      }
    }
    expect(vistos.size).toBe(TERRITORY_IDS.length);
  });

  it('los bonos por defecto cubren los seis continentes', () => {
    for (const continent of CONTINENT_ORDER) {
      expect(DEFAULT_RULES_CONFIG.continentBonuses[continent]).toBeGreaterThan(0);
    }
  });
});
