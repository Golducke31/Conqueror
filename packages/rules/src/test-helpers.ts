/**
 * Utilidades para los tests del motor. No es un modulo de la libreria: solo lo
 * importan los `*.test.ts` (y por eso no sale en `index.ts`).
 */

import type { PlayerColorId, PlayerId } from '@conqueror/shared';
import { DEFAULT_RULES_CONFIG, PLAYER_COLOR_ORDER, type RulesConfig } from '@conqueror/shared';

import { apply, RULE_ERROR } from './apply.js';
import { armiesOf } from './queries.js';
import { getLegalCommands } from './legal.js';
import { createRng, shuffle } from './rng.js';
import { createGameState, type PlayerSetup } from './state.js';
import type { ApplyContext, Command, GameEvent, GameState, Rng } from './types.js';

/** Colores para N jugadores, en orden de turno (cicla si piden mas de seis). */
export function colorsFor(count: number): readonly PlayerColorId[] {
  return Array.from(
    { length: count },
    (_, index) => PLAYER_COLOR_ORDER[index % PLAYER_COLOR_ORDER.length] as PlayerColorId,
  );
}

/** Jugadores de prueba: `p1`, `p2`, ... con los colores del orden de turno. */
export function playersFor(count: number): readonly PlayerSetup[] {
  return colorsFor(count).map((color, index) => ({
    id: `p${index + 1}`,
    name: `Jugador ${index + 1}`,
    color,
  }));
}

export interface GameOptions {
  readonly players?: number;
  readonly seed?: number;
  readonly config?: Partial<RulesConfig>;
}

/** Config con los ajustes que pida el test encima de la de por defecto. */
export function configWith(overrides: Partial<RulesConfig> = {}): RulesConfig {
  return { ...DEFAULT_RULES_CONFIG, ...overrides };
}

/** Arma una partida de prueba. */
export function makeGame(options: GameOptions = {}): GameState {
  const jugadores = options.players ?? 3;
  return createGameState({
    players: playersFor(jugadores),
    config: configWith(options.config),
    seed: options.seed ?? 1234,
  });
}

/** Contexto de aplicacion reanudado desde el estado (reproducible). */
export function contextFor(state: GameState, rng?: Rng): ApplyContext {
  return { rng: rng ?? createRng(state.rngState), config: state.config };
}

/** Aplica un comando y falla el test si el motor lo rechaza. */
export function applyOk(
  state: GameState,
  command: Command,
  playerId: PlayerId,
  ctx: ApplyContext,
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const resultado = apply(state, command, playerId, ctx);
  if (!resultado.ok) {
    throw new Error(`comando rechazado (${resultado.error.code}): ${resultado.error.message}`);
  }
  return resultado.value;
}

/** Aplica y devuelve el estado nuevo, tirando el resto. */
export function stateAfter(
  state: GameState,
  command: Command,
  playerId: PlayerId,
  ctx: ApplyContext,
): GameState {
  return applyOk(state, command, playerId, ctx).state;
}

/** Aplica un comando esperando que falle, y devuelve el codigo de error. */
export function errorOf(
  state: GameState,
  command: Command,
  playerId: PlayerId,
  ctx: ApplyContext,
): string {
  const resultado = apply(state, command, playerId, ctx);
  if (resultado.ok) throw new Error(`se esperaba un error y el comando paso: ${command.type}`);
  return resultado.error.code;
}

/** Coloca un ejercito en el primer territorio propio que sirva. */
export function placeSomewhere(state: GameState, ctx: ApplyContext): GameState {
  const territorio = state.board.territories.find(
    (candidate) => state.territories[candidate]?.owner === state.currentPlayer,
  );
  if (territorio === undefined) throw new Error('el jugador no tiene territorios');
  return stateAfter(
    state,
    { type: 'PLACE_ARMIES', territory: territorio, count: 1 },
    state.currentPlayer,
    ctx,
  );
}

/** Termina el despliegue inicial colocando todo lo que falta. */
export function finishSetup(state: GameState, ctx: ApplyContext): GameState {
  let actual = state;
  let guardia = 0;
  while (actual.phase === 'setup-placement') {
    actual = placeSomewhere(actual, ctx);
    guardia += 1;
    if (guardia > 10_000) throw new Error('el despliegue inicial no termino');
  }
  return actual;
}

/** Coloca los refuerzos del turno actual. */
export function placeReinforcements(state: GameState, ctx: ApplyContext): GameState {
  let actual = state;
  let guardia = 0;
  while (actual.phase === 'reinforce' && actual.armiesToPlace > 0) {
    actual = placeSomewhere(actual, ctx);
    guardia += 1;
    if (guardia > 10_000) throw new Error('no se pudieron colocar los refuerzos');
  }
  return actual;
}

/**
 * Reparte refuerzos concentrando en una **cuña de frente**: el territorio
 * propio que tiene vecino enemigo y mas ejercitos (y, a igualdad, el que mas
 * vecinos enemigos tiene). Asi el bot acumula masa de ataque justo donde puede
 * romper la linea.
 *
 * Ponerlos en el territorio con mas ejercitos sin mirar el frente (un territorio
 * del interior, sin vecinos enemigos) dejaba el frente sin refuerzos: el bot no
 * podia atacar, la partida no avanzaba y el test corria hasta el limite de
 * comandos.
 */
export function stackReinforcements(state: GameState, ctx: ApplyContext): GameState {
  let actual = state;
  let guardia = 0;
  while (actual.phase === 'reinforce' && actual.armiesToPlace > 0) {
    const propios = actual.board.territories.filter(
      (territory) => actual.territories[territory]?.owner === actual.currentPlayer,
    );
    if (propios.length === 0) throw new Error('el jugador no tiene territorios');

    const enemigosDe = (territory: string): number =>
      (actual.board.neighbors[territory] ?? []).filter(
        (vecino) => actual.territories[vecino]?.owner !== actual.currentPlayer,
      ).length;

    // Frente = territorios propios con al menos un vecino enemigo. Si no hay
    // frente (el jugador ya gano el tablero) se queda con todos los propios.
    const frente = propios.filter((territory) => enemigosDe(territory) > 0);
    const candidatos = frente.length > 0 ? frente : propios;

    const elegido = candidatos.reduce((mejor, territorio) => {
      const ejercitos = armiesOf(actual, territorio);
      const mejorEjercitos = armiesOf(actual, mejor);
      if (ejercitos !== mejorEjercitos) return ejercitos > mejorEjercitos ? territorio : mejor;
      return enemigosDe(territorio) > enemigosDe(mejor) ? territorio : mejor;
    }, candidatos[0] as string);

    actual = stateAfter(
      actual,
      { type: 'PLACE_ARMIES', territory: elegido, count: Math.min(3, actual.armiesToPlace) },
      actual.currentPlayer,
      ctx,
    );
    guardia += 1;
    if (guardia > 10_000) throw new Error('no se pudieron colocar los refuerzos');
  }
  return actual;
}

export interface BotOptions {
  /** Semilla del bot (independiente de la del juego). */
  readonly seed?: number;
  /** Maximo de comandos antes de rendirse (evita tests colgados). */
  readonly maxCommands?: number;
  /** Cuantos refuerzos apilar antes de atacar. */
  readonly stack?: boolean;
}

export interface BotResult {
  readonly state: GameState;
  readonly commands: number;
  readonly turns: number;
}

/**
 * Prioridad de los comandos para el bot: atacar primero y cerrar el turno
 * antes que reagrupar. Sin esto, un bot uniforme puede pasar el turno o mover
 * ejercitos de un lado al otro para siempre y la partida no termina nunca.
 * Dentro de la misma prioridad elige al azar.
 */
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

/** Uno de cada N turnos el bot reagrupa, para ejercitar esa fase. */
const REGROUP_CHANCE = 4;

/**
 * Juega una partida completa con un bot que elige comandos legales al azar.
 * Es la base del test de las 1000 partidas: si el motor tiene un callejon sin
 * salida, esto se cuelga o tira.
 */
export function playRandomGame(
  state: GameState,
  ctx: ApplyContext,
  options: BotOptions = {},
): BotResult {
  const bot = createRng(options.seed ?? 777);
  const maximo = options.maxCommands ?? 20_000;
  let actual = state;
  let comandos = 0;

  while (actual.phase !== 'game-over' && comandos < maximo) {
    // El bot coloca refuerzos de forma util; el resto lo elige al azar.
    if (actual.phase === 'reinforce' && actual.armiesToPlace > 0) {
      actual =
        options.stack === false ? placeSomewhere(actual, ctx) : stackReinforcements(actual, ctx);
      comandos += 1;
      continue;
    }

    const legales = getLegalCommands(actual, actual.currentPlayer);
    if (legales.length === 0) {
      throw new Error(`sin comandos legales en la fase ${actual.phase}`);
    }

    // Se queda con la clase de mayor prioridad y elige al azar dentro de ella.
    const mejor = Math.min(...legales.map((command) => PRIORIDAD[command.type]));
    let candidatos = legales.filter((command) => PRIORIDAD[command.type] === mejor);

    // Estrategia de ataque: solo ataca cuando el atacante tira mas dados que el
    // defensor. Con 4+ ejercitos tira 3 dados contra los 2 maximos del rival
    // (4 contra 4 incluido: 3 vs 2, ventaja real), y con 3 atacando a uno de 1
    // tira 2 contra 1. Atacar 2 contra 1 o 3 contra 2 es un empate a dados que
    // gana el defensor: el atacante nunca avanza y la frontera oscila sin fin.
    // Dentro de los ataques con ventaja elige el de mayor margen (atacante mas
    // fuerte contra defensa mas debil) para concentrar el fuego y romper la linea
    // de una vez, en vez de picar frentes iguales que se recompensan. El azar de
    // los dados rompe cualquier simetria de la disposicion inicial. Si no hay
    // ataque con ventaja, acumula (cierra la fase) y los refuerzos crecen el frente.
    if (mejor === PRIORIDAD.ATTACK) {
      const ejercitos = (territory: string): number => actual.territories[territory]?.armies ?? 0;
      const masDados = (command: Command): boolean => {
        if (command.type !== 'ATTACK') return false;
        const a = ejercitos(command.from);
        const d = ejercitos(command.to);
        const dadosA = Math.min(3, a - 1);
        const dadosD = Math.min(2, d);
        return dadosA > dadosD;
      };
      const conVentaja = candidatos.filter(masDados);
      if (conVentaja.length > 0) {
        const margen = (command: Command): number =>
          command.type === 'ATTACK'
            ? ejercitos(command.from) - ejercitos(command.to)
            : Number.NEGATIVE_INFINITY;
        const mejorMargen = Math.max(...conVentaja.map(margen));
        // Tolerancia de 1 para no volver la eleccion totalmente deterministica.
        candidatos = conVentaja.filter((command) => margen(command) >= mejorMargen - 1);
      } else {
        candidatos = legales.filter((command) => command.type === 'END_PHASE');
      }
    }

    // Despues de conquistar, consolida: mueve la maxima cantidad al territorio
    // tomado para que la cuña avance. Mover poco deja una avanzada debil que el
    // rival recaptura y la partida oscila sin terminar nunca.
    if (mejor === PRIORIDAD.MOVE_AFTER_CONQUEST) {
      const maxCount = Math.max(
        ...candidatos.map((command) =>
          command.type === 'MOVE_AFTER_CONQUEST' ? command.count : 0,
        ),
      );
      candidatos = candidatos.filter(
        (command) => command.type === 'MOVE_AFTER_CONQUEST' && command.count === maxCount,
      );
    }

    // De vez en cuando reagrupa en lugar de cerrar el turno, para que la fase
    // de reagrupe tambien corra en la simulacion. Es al azar: no intentamos
    // "optimizar" el reagrupe, eso era lo que empantanaba la partida.
    if (
      mejor === PRIORIDAD.END_TURN &&
      bot.int(1, REGROUP_CHANCE) === 1 &&
      legales.some((command) => command.type === 'REGROUP')
    ) {
      candidatos = legales.filter((command) => command.type === 'REGROUP');
    }

    const elegido = candidatos[bot.int(0, candidatos.length - 1)] as Command;

    const resultado = apply(actual, elegido, actual.currentPlayer, ctx);
    if (!resultado.ok) {
      throw new Error(
        `comando legal rechazado (${resultado.error.code}): ${resultado.error.message}`,
      );
    }
    actual = resultado.value.state;
    comandos += 1;
  }

  if (actual.phase !== 'game-over') {
    throw new Error(`la partida no termino en ${maximo} comandos (fase ${actual.phase})`);
  }
  return { state: actual, commands: comandos, turns: actual.turn };
}

/** Un comando legal al azar, para los tests de comandos ilegales. */
export function randomLegal(state: GameState, rng: Rng): Command {
  const legales = getLegalCommands(state, state.currentPlayer);
  if (legales.length === 0) throw new Error('sin comandos legales');
  return legales[rng.int(0, legales.length - 1)] as Command;
}

/** Mezcla determinista, para tests que necesitan orden variable. */
export function shuffled<T>(items: readonly T[], seed: number): readonly T[] {
  return shuffle(items, createRng(seed));
}

/** Codigo de error esperado cuando el comando no es del jugador de turno. */
export const ERROR_NOT_YOUR_TURN = RULE_ERROR.NOT_YOUR_TURN;

/**
 * RNG de guion fijo: devuelve los valores dados, en orden y en ciclo. Sirve para
 * forzar una tirada concreta en los tests de combate.
 */
export function scriptedRng(valores: readonly number[]): Rng {
  let cursor = 0;
  const siguiente = (): number => {
    const valor = valores[cursor % valores.length] as number;
    cursor += 1;
    return valor;
  };
  return {
    rollDie: siguiente,
    int(min: number, max: number): number {
      return Math.max(min, Math.min(max, siguiente()));
    },
    snapshot(): number {
      return cursor;
    },
  };
}

/** Estado con un territorio pisado a mano (para armar escenarios). */
export function setTerritory(
  state: GameState,
  territory: string,
  owner: PlayerId | null,
  armies: number,
): GameState {
  return {
    ...state,
    territories: { ...state.territories, [territory]: { owner, armies } },
  };
}

/** Estado con muchos territorios pisados de una vez: `{ territorio: [dueno, ejercitos] }`. */
export function setTerritories(
  state: GameState,
  cambios: Readonly<Record<string, readonly [PlayerId | null, number]>>,
): GameState {
  const territorios = { ...state.territories };
  for (const [territory, [owner, armies]] of Object.entries(cambios)) {
    territorios[territory] = { owner, armies };
  }
  return { ...state, territories: territorios };
}

/** Estado con un jugador pisado a mano. */
export function setPlayer(
  state: GameState,
  playerId: PlayerId,
  patch: Partial<GameState['players'][number]>,
): GameState {
  return {
    ...state,
    players: state.players.map((player) =>
      player.id === playerId ? { ...player, ...patch } : player,
    ),
  };
}

/**
 * Deja la partida sin victoria posible a corto plazo: objetivo comun en 50
 * territorios y sin misiones repartidas.
 *
 * Los escenarios armados a mano suelen darle medio tablero a un jugador; sin
 * esto, el chequeo de victoria que corre al final de cada comando terminaria la
 * partida en medio del test.
 */
export function neutralVictory(state: GameState): GameState {
  return {
    ...state,
    config: {
      ...state.config,
      victory: {
        ...state.config.victory,
        strategy: 'common-objective',
        commonObjectiveTerritories: 50,
      },
    },
    players: state.players.map((player) => ({ ...player, mission: null })),
  };
}

/** Le da todos los territorios del tablero a un jugador. */
export function giveAllTo(state: GameState, playerId: PlayerId): GameState {
  const cambios: Record<string, readonly [PlayerId, number]> = {};
  for (const territory of state.board.territories) cambios[territory] = [playerId, 1];
  return setTerritories(state, cambios);
}

/** Le da todos los territorios de un continente a un jugador. */
export function giveContinent(state: GameState, continent: string, playerId: PlayerId): GameState {
  const territorios = state.board.territoriesByContinent[continent] ?? [];
  const cambios: Record<string, readonly [PlayerId, number]> = {};
  for (const territory of territorios) cambios[territory] = [playerId, 3];
  return setTerritories(state, cambios);
}
