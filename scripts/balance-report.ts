/**
 * Informe de balance por continente.
 *
 * Imprime, por continente: cantidad de territorios, fronteras internas,
 * fronteras externas (a defender) y grado promedio, y propone un bono.
 *
 * IMPORTANTE: la propuesta es un insumo, NO una decision. Los bonos finales los
 * define el humano. El valor propuesto se calcula con una formula simple y
 * documentada, y se compara contra el valor clasico del tablero.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADJACENCY_FILE } from '@conqueror/map-data';
import { loadMapConfig } from '@conqueror/map-data/node';
import type { AdjacencyFile, ContinentBalance } from '@conqueror/map-data';
import { DEFAULT_RULES_CONFIG } from '@conqueror/shared';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = join(REPO_ROOT, 'packages', 'map-data', 'territories.config.json');
const GENERATED_DIR = join(REPO_ROOT, 'packages', 'map-data', 'generated');

/**
 * Formula de propuesta, documentada a proposito para poder discutirla:
 *   bono = redondear(territorios / 3 + fronterasExternas / 6), acotado a [2, 8]
 *
 * Intuicion: cuanto mas grande el continente, mas ejercitos rinde; cuantas mas
 * fronteras externas, mas caro es sostenerlo. El clasico sube un punto por
 * encima en America del Norte y Europa porque son continentes "tapados" por el
 * mar y con vecinos debiles.
 */
const DIVISOR_TERRITORIOS = 3;
const DIVISOR_FRONTERAS = 6;
const BONO_MINIMO = 2;
const BONO_MAXIMO = 8;

function proponerBono(territorios: number, fronterasExternas: number): number {
  const crudo = territorios / DIVISOR_TERRITORIOS + fronterasExternas / DIVISOR_FRONTERAS;
  return Math.min(BONO_MAXIMO, Math.max(BONO_MINIMO, Math.round(crudo)));
}

async function main(): Promise<void> {
  const config = loadMapConfig(CONFIG_PATH);
  const adjacency = JSON.parse(
    await readFile(join(GENERATED_DIR, ADJACENCY_FILE), 'utf8'),
  ) as AdjacencyFile;

  const continentOf = new Map(config.territories.map((t) => [t.id, t.continent]));
  const degrees = new Map<string, number>(config.territories.map((t) => [t.id, 0]));

  const balances: ContinentBalance[] = config.continents.map((continent) => ({
    continent: continent.id,
    names: continent.names,
    territories: config.territories.filter((t) => t.continent === continent.id).length,
    internalBorders: 0,
    externalBorders: 0,
    averageDegree: 0,
    externalNeighbours: [],
  }));

  const byId = new Map(balances.map((balance) => [balance.continent, balance]));
  const externalNeighbours = new Map<string, Set<string>>(
    balances.map((balance) => [balance.continent, new Set<string>()]),
  );

  const mutable = new Map(
    balances.map((balance) => [balance.continent, { internal: 0, external: 0 }]),
  );

  for (const [a, b] of adjacency.edges) {
    degrees.set(a, (degrees.get(a) ?? 0) + 1);
    degrees.set(b, (degrees.get(b) ?? 0) + 1);
    const continentA = continentOf.get(a);
    const continentB = continentOf.get(b);
    if (continentA === undefined || continentB === undefined) continue;
    if (continentA === continentB) {
      const entry = mutable.get(continentA);
      if (entry !== undefined) entry.internal += 1;
    } else {
      const entryA = mutable.get(continentA);
      const entryB = mutable.get(continentB);
      if (entryA !== undefined) entryA.external += 1;
      if (entryB !== undefined) entryB.external += 1;
      externalNeighbours.get(continentA)?.add(b);
      externalNeighbours.get(continentB)?.add(a);
    }
  }

  for (const balance of balances) {
    const entry = mutable.get(balance.continent);
    const members = config.territories.filter((t) => t.continent === balance.continent);
    const total = members.reduce((sum, t) => sum + (degrees.get(t.id) ?? 0), 0);
    const updated: ContinentBalance = {
      ...balance,
      internalBorders: entry?.internal ?? 0,
      externalBorders: entry?.external ?? 0,
      averageDegree: members.length === 0 ? 0 : total / members.length,
      externalNeighbours: [...(externalNeighbours.get(balance.continent) ?? [])].sort(),
    };
    byId.set(balance.continent, updated);
  }

  const ordered = config.continents
    .map((continent) => byId.get(continent.id))
    .filter((balance): balance is ContinentBalance => balance !== undefined);

  console.log('');
  console.log('INFORME DE BALANCE POR CONTINENTE');
  console.log('='.repeat(78));
  console.log(
    [
      'continente'.padEnd(18),
      'terr'.padStart(5),
      'int'.padStart(5),
      'ext'.padStart(5),
      'grado'.padStart(7),
      'actual'.padStart(7),
      'propuesto'.padStart(10),
    ].join(' '),
  );
  console.log('-'.repeat(78));

  for (const balance of ordered) {
    const actual = DEFAULT_RULES_CONFIG.continentBonuses[balance.continent] ?? 0;
    const propuesto = proponerBono(balance.territories, balance.externalBorders);
    console.log(
      [
        balance.names['es-AR'].padEnd(18),
        String(balance.territories).padStart(5),
        String(balance.internalBorders).padStart(5),
        String(balance.externalBorders).padStart(5),
        balance.averageDegree.toFixed(2).padStart(7),
        String(actual).padStart(7),
        String(propuesto).padStart(10),
      ].join(' '),
    );
  }

  console.log('-'.repeat(78));
  console.log('');
  console.log('Fronteras externas por continente (lo que hay que defender):');
  for (const balance of ordered) {
    console.log(
      `  ${balance.names['es-AR'].padEnd(18)} -> ${
        balance.externalNeighbours.length > 0
          ? balance.externalNeighbours.join(', ')
          : '(ninguna: isla cerrada)'
      }`,
    );
  }

  console.log('');
  console.log('Formula de propuesta:');
  console.log(
    `  bono = redondear(territorios / ${DIVISOR_TERRITORIOS} + fronterasExternas / ${DIVISOR_FRONTERAS}), acotado a [${BONO_MINIMO}, ${BONO_MAXIMO}]`,
  );
  console.log('');
  console.log('Los bonos finales los define el humano. Para aplicarlos, editar');
  console.log('`continentBonuses` en packages/shared/src/rules-config.ts.');
  console.log('');
}

main().catch((error: unknown) => {
  console.error('[map:balance] error:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
