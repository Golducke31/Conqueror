/**
 * Composicion de escuadras.
 *
 * Convierte una cantidad de ejercitos en una lista corta de unidades visibles.
 * Es una funcion PURA y determinista: no toca el estado, no usa azar y no
 * depende del render. Los tests la cubren con tabla y con property tests.
 *
 * Regla (plan de combate, seccion 6.3):
 *   1. Descomposicion greedy con los niveles configurados (artilleria 10,
 *      caballeria 5, infanteria 1).
 *   2. Si la cantidad de unidades supera `maxUnits`, se busca el menor `k`
 *      entero tal que `ceil(armies / k)` entre en el maximo. Cada unidad visual
 *      pasa a representar `k` ejercitos y se muestra la etiqueta "x k".
 *
 * Invariantes garantizadas (testeadas):
 *   - `units.length <= maxUnits`
 *   - `k >= 1`
 *   - `representedArmies >= armies`, con excedente menor que `k`
 *   - sin unidades si `armies === 0`
 */

/** Tipos de unidad. El orden es de mayor a menor nivel. */
export type UnitType = 'artillery' | 'cavalry' | 'infantry';

/** Un nivel de la descomposicion: cuantos ejercitos vale un tipo de unidad. */
export interface SquadTier {
  readonly type: UnitType;
  readonly armies: number;
}

/** Unidades de un tipo dentro de la escuadra. */
export interface SquadUnit {
  readonly type: UnitType;
  readonly count: number;
}

/** Resultado de componer una escuadra. */
export interface SquadComposition {
  /** Ejercitos que representa cada unidad visual. */
  readonly k: number;
  /** Unidades agrupadas por tipo, de mayor a menor nivel. */
  readonly units: readonly SquadUnit[];
  /** Ejercitos representados en total (`k` por la suma de niveles). */
  readonly representedArmies: number;
  /** Ejercitos que se pidio representar. */
  readonly armies: number;
}

/** Niveles por defecto. */
export const DEFAULT_SQUAD_TIERS: readonly SquadTier[] = [
  { type: 'artillery', armies: 10 },
  { type: 'cavalry', armies: 5 },
  { type: 'infantry', armies: 1 },
];

export interface ComposeSquadOptions {
  /** Tope de unidades visuales. 16 en escritorio, 8 en movil. */
  readonly maxUnits: number;
  /** Niveles a usar. El mas chico tiene que valer 1 para que la suma sea exacta. */
  readonly tiers?: readonly SquadTier[];
}

/** Descomposicion greedy de una cantidad en los niveles dados. */
function greedyDecompose(armies: number, tiers: readonly SquadTier[]): SquadUnit[] {
  const units: SquadUnit[] = [];
  let remaining = armies;
  for (const tier of tiers) {
    if (tier.armies <= 0) continue;
    const count = Math.floor(remaining / tier.armies);
    if (count > 0) {
      units.push({ type: tier.type, count });
      remaining -= count * tier.armies;
    }
  }
  return units;
}

/** Cantidad total de unidades visuales, sumando los grupos por tipo. */
function countUnits(units: readonly SquadUnit[]): number {
  return units.reduce((sum, unit) => sum + unit.count, 0);
}

function normalizeTiers(tiers: readonly SquadTier[]): SquadTier[] {
  if (tiers.length === 0) {
    throw new Error('composeSquad: la lista de niveles no puede estar vacia');
  }
  const sorted = [...tiers].sort((a, b) => b.armies - a.armies);
  const smallest = sorted[sorted.length - 1];
  if (smallest === undefined || smallest.armies !== 1) {
    throw new Error('composeSquad: el nivel mas chico tiene que valer 1 ejercito');
  }
  return sorted;
}

/**
 * Compone la escuadra visual de una cantidad de ejercitos.
 * `armies` se redondea hacia abajo y nunca es negativo.
 */
export function composeSquad(armies: number, options: ComposeSquadOptions): SquadComposition {
  if (!Number.isFinite(options.maxUnits) || options.maxUnits < 1) {
    throw new Error('composeSquad: maxUnits tiene que ser un entero >= 1');
  }
  const maxUnits = Math.floor(options.maxUnits);
  const tiers = normalizeTiers(options.tiers ?? DEFAULT_SQUAD_TIERS);
  const total = Math.max(0, Math.floor(armies));

  let k = 1;
  let units = greedyDecompose(Math.ceil(total / k), tiers);

  // El conteo de unidades no baja de forma estrictamente monotona con k, asi que
  // se avanza de a uno. En la practica k queda en un numero chico.
  while (countUnits(units) > maxUnits) {
    k += 1;
    units = greedyDecompose(Math.ceil(total / k), tiers);
  }

  const perUnit = units.reduce((sum, unit) => {
    const tier = tiers.find((candidate) => candidate.type === unit.type);
    return sum + unit.count * (tier?.armies ?? 0);
  }, 0);

  return {
    k,
    units,
    representedArmies: k * perUnit,
    armies: total,
  };
}

/** Total de unidades visuales de una composicion. */
export function squadUnitCount(composition: SquadComposition): number {
  return composition.units.reduce((sum, unit) => sum + unit.count, 0);
}

/**
 * Orden de formacion de las unidades, de la fila de ADELANTE hacia atras.
 *
 * La infanteria va adelante y la artilleria atras, como en una linea de batalla
 * real. Esto importa mas de lo que parece: las bajas caen en la primera fila
 * (plan de combate, seccion 6.4), asi que el orden define quien muere primero.
 */
export const SQUAD_FORMATION_ORDER: readonly UnitType[] = ['infantry', 'cavalry', 'artillery'];

/**
 * Expande una composicion a la lista ordenada de unidades, una por unidad.
 * Es el orden en el que se dibujan y en el que se eligen los duelistas.
 */
export function expandSquad(composition: SquadComposition): UnitType[] {
  const out: UnitType[] = [];
  for (const type of SQUAD_FORMATION_ORDER) {
    const unit = composition.units.find((candidate) => candidate.type === type);
    if (unit === undefined) continue;
    for (let index = 0; index < unit.count; index += 1) out.push(type);
  }
  return out;
}
