/**
 * `apply`: el unico lugar donde cambian las reglas.
 *
 * Funcion PURA: recibe el estado, devuelve uno nuevo (nunca muta el de entrada)
 * y los eventos que la UI usa para animar. El RNG entra inyectado, asi que una
 * partida se reproduce entera con `(semilla, lista de comandos)`.
 *
 * Todo valor ajustable sale de `RulesConfig`: aca no hay numeros de reglas
 * escritos a mano (ADR 0003).
 */

import type { PlayerId, TerritoryId } from '@conqueror/shared';

import { isAdjacent } from './board.js';
import { drawCard, isValidTrade, tradeValue } from './cards.js';
import { maxAttackerDice, resolveRound } from './combat.js';
import { createObjectiveProvider } from './objectives.js';
import {
  alivePlayers,
  armiesOf,
  hasOwnPath,
  nextAlivePlayer,
  ownerOf,
  regroupKey,
  reinforcementsFor,
  territoryCount,
} from './queries.js';
import { placementAllowanceForRound } from './state.js';
import type {
  ApplyContext,
  Command,
  GameEvent,
  GameState,
  PlayerState,
  Result,
  RuleError,
  TerritoryState,
} from './types.js';

/** Codigos de error de regla (estables, para i18n). */
export const RULE_ERROR = {
  GAME_OVER: 'GAME_OVER',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  PLAYER_OUT: 'PLAYER_OUT',
  UNKNOWN_TERRITORY: 'UNKNOWN_TERRITORY',
  NOT_OWNER: 'NOT_OWNER',
  NOT_ENEMY: 'NOT_ENEMY',
  NOT_ADJACENT: 'NOT_ADJACENT',
  INVALID_COUNT: 'INVALID_COUNT',
  INVALID_DICE: 'INVALID_DICE',
  NOT_ENOUGH_ARMIES: 'NOT_ENOUGH_ARMIES',
  ROUND_LIMIT: 'ROUND_LIMIT',
  MUST_PLACE_ARMIES: 'MUST_PLACE_ARMIES',
  MUST_TRADE: 'MUST_TRADE',
  PENDING_CONQUEST: 'PENDING_CONQUEST',
  CARDS_NOT_OWNED: 'CARDS_NOT_OWNED',
  INVALID_TRADE: 'INVALID_TRADE',
  NO_OWN_PATH: 'NO_OWN_PATH',
  REGROUP_LIMIT: 'REGROUP_LIMIT',
  WRONG_PHASE: 'WRONG_PHASE',
} as const;

export type RuleErrorCode = (typeof RULE_ERROR)[keyof typeof RULE_ERROR];

function falla(code: RuleErrorCode, message: string): Result<never, RuleError> {
  return { ok: false, error: { code, message } };
}

function ok(
  state: GameState,
  events: readonly GameEvent[],
): Result<{ state: GameState; events: readonly GameEvent[] }, RuleError> {
  return { ok: true, value: { state, events } };
}

/** Estado con un territorio pisado (inmutable). */
function conTerritorio(
  state: GameState,
  territory: TerritoryId,
  patch: Partial<TerritoryState>,
): GameState {
  const actual = state.territories[territory] ?? { owner: null, armies: 0 };
  return { ...state, territories: { ...state.territories, [territory]: { ...actual, ...patch } } };
}

/** Estado con varios territorios pisados de una sola vez. */
function conTerritorios(
  state: GameState,
  cambios: Readonly<Record<TerritoryId, Partial<TerritoryState>>>,
): GameState {
  const territorios = { ...state.territories };
  for (const [territory, patch] of Object.entries(cambios)) {
    const actual = territorios[territory] ?? { owner: null, armies: 0 };
    territorios[territory] = { ...actual, ...patch };
  }
  return { ...state, territories: territorios };
}

/** Estado con un jugador pisado (inmutable). */
function conJugador(state: GameState, playerId: PlayerId, patch: Partial<PlayerState>): GameState {
  return {
    ...state,
    players: state.players.map((player) =>
      player.id === playerId ? { ...player, ...patch } : player,
    ),
  };
}

/** Sella el estado con el RNG y la config vigente. */
function sellar(state: GameState, ctx: ApplyContext): GameState {
  return { ...state, rngState: ctx.rng.snapshot(), config: ctx.config };
}

/**
 * Si alguien gano. Se corre al final de cada comando: una conquista, una
 * eliminacion o una rendicion pueden cumplir el objetivo de cualquiera.
 */
function resolverVictoria(state: GameState, ctx: ApplyContext, events: GameEvent[]): GameState {
  if (state.phase === 'game-over') return state;

  const vivos = alivePlayers(state);
  const proveedor = createObjectiveProvider(ctx.config.victory.strategy);

  for (const player of vivos) {
    if (proveedor.achieved(state, player.id, ctx.config)) {
      events.push({ type: 'GAME_WON', player: player.id });
      events.push({ type: 'PHASE_CHANGED', phase: 'game-over' });
      return { ...state, phase: 'game-over', winner: player.id };
    }
  }

  // Ultimo jugador en pie: gana aunque no haya cumplido la mision.
  if (vivos.length === 1) {
    const ganador = vivos[0] as PlayerState;
    events.push({ type: 'GAME_WON', player: ganador.id });
    events.push({ type: 'PHASE_CHANGED', phase: 'game-over' });
    return { ...state, phase: 'game-over', winner: ganador.id };
  }

  return state;
}

/**
 * Aplica un comando. No muta el estado de entrada.
 */
export function apply(
  state: GameState,
  command: Command,
  playerId: PlayerId,
  ctx: ApplyContext,
): Result<{ state: GameState; events: readonly GameEvent[] }, RuleError> {
  if (state.phase === 'game-over') {
    return falla(RULE_ERROR.GAME_OVER, 'La partida ya termino');
  }

  const jugador = state.players.find((player) => player.id === playerId);
  if (jugador === undefined) {
    return falla(RULE_ERROR.PLAYER_OUT, `El jugador «${playerId}» no esta en la partida`);
  }
  if (!jugador.alive) {
    return falla(RULE_ERROR.PLAYER_OUT, `El jugador «${playerId}» quedo fuera de la partida`);
  }
  if (state.currentPlayer !== playerId) {
    return falla(RULE_ERROR.NOT_YOUR_TURN, `No es el turno de «${playerId}»`);
  }

  switch (command.type) {
    case 'PLACE_ARMIES':
      return aplicarPlace(state, command, playerId, ctx);
    case 'TRADE_CARDS':
      return aplicarTrade(state, command, playerId, ctx);
    case 'ATTACK':
      return aplicarAttack(state, command, playerId, ctx);
    case 'MOVE_AFTER_CONQUEST':
      return aplicarMoveAfterConquest(state, command, playerId, ctx);
    case 'REGROUP':
      return aplicarRegroup(state, command, playerId, ctx);
    case 'END_PHASE':
      return aplicarEndPhase(state, ctx);
    case 'END_TURN':
      return aplicarEndTurn(state, ctx);
    case 'SURRENDER':
      return aplicarSurrender(state, playerId, ctx);
    default:
      return falla(RULE_ERROR.WRONG_PHASE, 'Comando desconocido');
  }
}

// ---------------------------------------------------------------------------
// Despliegue y refuerzo
// ---------------------------------------------------------------------------

function aplicarPlace(
  state: GameState,
  command: Extract<Command, { type: 'PLACE_ARMIES' }>,
  playerId: PlayerId,
  ctx: ApplyContext,
): Result<{ state: GameState; events: readonly GameEvent[] }, RuleError> {
  if (state.phase !== 'setup-placement' && state.phase !== 'reinforce') {
    return falla(RULE_ERROR.WRONG_PHASE, 'No se pueden colocar ejercitos en esta fase');
  }
  if (state.territories[command.territory] === undefined) {
    return falla(RULE_ERROR.UNKNOWN_TERRITORY, `El territorio «${command.territory}» no existe`);
  }
  if (ownerOf(state, command.territory) !== playerId) {
    return falla(RULE_ERROR.NOT_OWNER, 'Solo se colocan ejercitos en territorios propios');
  }
  if (!Number.isInteger(command.count) || command.count < 1) {
    return falla(RULE_ERROR.INVALID_COUNT, 'La cantidad tiene que ser un entero mayor que 0');
  }
  if (command.count > state.armiesToPlace) {
    return falla(
      RULE_ERROR.NOT_ENOUGH_ARMIES,
      `Quedan ${state.armiesToPlace} ejercitos por colocar`,
    );
  }
  if (state.placementRoundAllowance !== null && command.count > state.placementRoundAllowance) {
    return falla(
      RULE_ERROR.ROUND_LIMIT,
      `En esta ronda se pueden colocar hasta ${state.placementRoundAllowance} ejercitos`,
    );
  }

  const events: GameEvent[] = [
    { type: 'ARMIES_PLACED', territory: command.territory, count: command.count },
  ];

  let siguiente = conTerritorio(state, command.territory, {
    armies: armiesOf(state, command.territory) + command.count,
  });
  siguiente = {
    ...siguiente,
    armiesToPlace: siguiente.armiesToPlace - command.count,
    placementRoundAllowance:
      siguiente.placementRoundAllowance === null
        ? null
        : siguiente.placementRoundAllowance - command.count,
  };

  if (state.phase === 'setup-placement') {
    siguiente = avanzarDespliegue(siguiente, ctx, events);
  }

  siguiente = sellar(siguiente, ctx);
  siguiente = resolverVictoria(siguiente, ctx, events);
  return ok(siguiente, events);
}

/**
 * Pasa al siguiente jugador del despliegue inicial, o arranca la partida si ya
 * no queda nada por colocar.
 *
 * Invariante: todos los jugadores tienen el mismo total inicial, asi que
 * colocan la misma cantidad en cada ronda y terminan a la vez.
 */
function avanzarDespliegue(state: GameState, ctx: ApplyContext, events: GameEvent[]): GameState {
  if (state.armiesToPlace === 0) {
    // Se termino el despliegue: arranca el primer jugador con su refuerzo.
    const primero = state.players[0] as PlayerState;
    events.push({ type: 'TURN_CHANGED', player: primero.id });
    events.push({ type: 'PHASE_CHANGED', phase: 'reinforce' });
    return {
      ...state,
      currentPlayer: primero.id,
      phase: 'reinforce',
      placementRound: 0,
      placementRoundAllowance: null,
      armiesToPlace: reinforcementsFor(state, primero.id, ctx.config),
    };
  }

  if (state.placementRoundAllowance !== null && state.placementRoundAllowance > 0) {
    return state;
  }

  const siguienteId = nextAlivePlayer(state, state.currentPlayer);
  const primeroVivo = alivePlayers(state)[0] as PlayerState;
  const vueltas = siguienteId === primeroVivo.id;
  const ronda = vueltas ? state.placementRound + 1 : state.placementRound;
  const cupo = Math.min(placementAllowanceForRound(ronda, ctx.config), state.armiesToPlace);

  events.push({ type: 'TURN_CHANGED', player: siguienteId });
  return {
    ...state,
    currentPlayer: siguienteId,
    placementRound: ronda,
    placementRoundAllowance: cupo,
  };
}

// ---------------------------------------------------------------------------
// Tarjetas
// ---------------------------------------------------------------------------

function aplicarTrade(
  state: GameState,
  command: Extract<Command, { type: 'TRADE_CARDS' }>,
  playerId: PlayerId,
  ctx: ApplyContext,
): Result<{ state: GameState; events: readonly GameEvent[] }, RuleError> {
  if (state.phase !== 'reinforce') {
    return falla(RULE_ERROR.WRONG_PHASE, 'El canje se hace al empezar el turno');
  }

  const jugador = state.players.find((player) => player.id === playerId) as PlayerState;
  const trio = command.cardIds;
  if (trio.some((cardId) => !jugador.cards.includes(cardId))) {
    return falla(RULE_ERROR.CARDS_NOT_OWNED, 'Alguna de las tarjetas no esta en tu mano');
  }
  if (!isValidTrade(trio, state.board)) {
    return falla(RULE_ERROR.INVALID_TRADE, 'El canje tiene que ser tres iguales o una de cada una');
  }

  const ejercitos = tradeValue(trio, state, playerId, ctx.config);
  const events: GameEvent[] = [{ type: 'CARDS_TRADED', armies: ejercitos }];

  let siguiente = conJugador(state, playerId, {
    cards: jugador.cards.filter((cardId) => !trio.includes(cardId)),
  });
  siguiente = {
    ...siguiente,
    discard: [...siguiente.discard, ...trio],
    trades: siguiente.trades + 1,
    armiesToPlace: siguiente.armiesToPlace + ejercitos,
  };

  siguiente = sellar(siguiente, ctx);
  siguiente = resolverVictoria(siguiente, ctx, events);
  return ok(siguiente, events);
}

// ---------------------------------------------------------------------------
// Ataque
// ---------------------------------------------------------------------------

function aplicarAttack(
  state: GameState,
  command: Extract<Command, { type: 'ATTACK' }>,
  playerId: PlayerId,
  ctx: ApplyContext,
): Result<{ state: GameState; events: readonly GameEvent[] }, RuleError> {
  if (state.phase !== 'attack') {
    return falla(RULE_ERROR.WRONG_PHASE, 'No se puede atacar en esta fase');
  }
  if (
    state.territories[command.from] === undefined ||
    state.territories[command.to] === undefined
  ) {
    return falla(RULE_ERROR.UNKNOWN_TERRITORY, 'Alguno de los territorios no existe');
  }
  if (!isAdjacent(state.board, command.from, command.to)) {
    return falla(RULE_ERROR.NOT_ADJACENT, 'Los territorios no son adyacentes');
  }
  if (ownerOf(state, command.from) !== playerId) {
    return falla(RULE_ERROR.NOT_OWNER, 'El territorio de origen no es tuyo');
  }
  if (ownerOf(state, command.to) === playerId) {
    return falla(RULE_ERROR.NOT_ENEMY, 'El territorio atacado ya es tuyo');
  }

  const ejercitosAtacante = armiesOf(state, command.from);
  const topeDados = maxAttackerDice(ejercitosAtacante, ctx.config);
  if (topeDados < 1) {
    return falla(RULE_ERROR.NOT_ENOUGH_ARMIES, 'Hacen falta al menos 2 ejercitos para atacar');
  }
  if (!Number.isInteger(command.dice) || command.dice < 1 || command.dice > topeDados) {
    return falla(
      RULE_ERROR.INVALID_DICE,
      `Con ${ejercitosAtacante} ejercitos se tiran entre 1 y ${topeDados} dados`,
    );
  }

  const ejercitosDefensor = armiesOf(state, command.to);
  const ronda = resolveRound({
    from: command.from,
    to: command.to,
    attackerArmies: ejercitosAtacante,
    defenderArmies: ejercitosDefensor,
    dice: command.dice,
    config: ctx.config,
    rng: ctx.rng,
  });

  const events: GameEvent[] = [ronda];
  let siguiente = conTerritorios(state, {
    [command.from]: { armies: ronda.attackerArmiesAfter },
    [command.to]: { armies: ronda.defenderArmiesAfter },
  });

  if (ronda.defenderArmiesAfter > 0) {
    siguiente = sellar(siguiente, ctx);
    siguiente = resolverVictoria(siguiente, ctx, events);
    return ok(siguiente, events);
  }

  // --- Conquista -------------------------------------------------------------
  const minimoConfig = ctx.config.conquest.minMove;
  const topeMovimiento = Math.max(0, ronda.attackerArmiesAfter - 1);
  const minimoBase = minimoConfig === 'attacker-dice' ? command.dice : minimoConfig;
  const minimo = Math.min(minimoBase, topeMovimiento);

  const defensorAntes = ownerOf(state, command.to);
  siguiente = conTerritorio(siguiente, command.to, { owner: playerId, armies: 0 });
  siguiente = {
    ...siguiente,
    phase: 'conquest-move',
    pendingConquest: { from: command.from, to: command.to, min: minimo, max: topeMovimiento },
    conqueredThisTurn: true,
    conqueredTerritories: [...siguiente.conqueredTerritories, command.to],
  };

  events.push({ type: 'TERRITORY_CONQUERED', territory: command.to });
  events.push({ type: 'PHASE_CHANGED', phase: 'conquest-move' });

  // Eliminacion del defensor: se queda sin territorios.
  if (defensorAntes !== null && territoryCount(siguiente, defensorAntes) === 0) {
    events.push({ type: 'PLAYER_ELIMINATED', player: defensorAntes });
    siguiente = conJugador(siguiente, defensorAntes, { alive: false });

    if (ctx.config.elimination.inheritCards) {
      const cartas = siguiente.players.find((player) => player.id === defensorAntes)?.cards ?? [];
      siguiente = conJugador(siguiente, defensorAntes, { cards: [] });
      const atacante = siguiente.players.find((player) => player.id === playerId) as PlayerState;
      siguiente = conJugador(siguiente, playerId, { cards: [...atacante.cards, ...cartas] });
    }
  }

  siguiente = sellar(siguiente, ctx);
  siguiente = resolverVictoria(siguiente, ctx, events);
  return ok(siguiente, events);
}

function aplicarMoveAfterConquest(
  state: GameState,
  command: Extract<Command, { type: 'MOVE_AFTER_CONQUEST' }>,
  playerId: PlayerId,
  ctx: ApplyContext,
): Result<{ state: GameState; events: readonly GameEvent[] }, RuleError> {
  if (state.phase !== 'conquest-move' || state.pendingConquest === null) {
    return falla(RULE_ERROR.WRONG_PHASE, 'No hay ninguna conquista pendiente de mover');
  }
  const pendiente = state.pendingConquest;
  if (ownerOf(state, pendiente.from) !== playerId || ownerOf(state, pendiente.to) !== playerId) {
    return falla(RULE_ERROR.NOT_OWNER, 'La conquista pendiente no es de este jugador');
  }
  if (
    !Number.isInteger(command.count) ||
    command.count < pendiente.min ||
    command.count > pendiente.max
  ) {
    return falla(
      RULE_ERROR.INVALID_COUNT,
      `Hay que mover entre ${pendiente.min} y ${pendiente.max} ejercitos`,
    );
  }

  const events: GameEvent[] = [
    { type: 'ARMIES_MOVED', from: pendiente.from, to: pendiente.to, count: command.count },
    { type: 'PHASE_CHANGED', phase: 'attack' },
  ];

  let siguiente = conTerritorios(state, {
    [pendiente.from]: { armies: armiesOf(state, pendiente.from) - command.count },
    [pendiente.to]: { armies: armiesOf(state, pendiente.to) + command.count },
  });
  siguiente = { ...siguiente, phase: 'attack', pendingConquest: null };

  siguiente = sellar(siguiente, ctx);
  siguiente = resolverVictoria(siguiente, ctx, events);
  return ok(siguiente, events);
}

// ---------------------------------------------------------------------------
// Reagrupe
// ---------------------------------------------------------------------------

function aplicarRegroup(
  state: GameState,
  command: Extract<Command, { type: 'REGROUP' }>,
  playerId: PlayerId,
  ctx: ApplyContext,
): Result<{ state: GameState; events: readonly GameEvent[] }, RuleError> {
  if (state.phase !== 'regroup') {
    return falla(RULE_ERROR.WRONG_PHASE, 'El reagrupe es al final del turno');
  }
  if (
    state.territories[command.from] === undefined ||
    state.territories[command.to] === undefined
  ) {
    return falla(RULE_ERROR.UNKNOWN_TERRITORY, 'Alguno de los territorios no existe');
  }
  if (command.from === command.to) {
    return falla(RULE_ERROR.INVALID_COUNT, 'El origen y el destino tienen que ser distintos');
  }
  if (ownerOf(state, command.from) !== playerId || ownerOf(state, command.to) !== playerId) {
    return falla(RULE_ERROR.NOT_OWNER, 'El reagrupe es entre territorios propios');
  }
  if (ctx.config.regroup.requireOwnPath && !hasOwnPath(state, playerId, command.from, command.to)) {
    return falla(RULE_ERROR.NO_OWN_PATH, 'No hay camino de territorios propios hasta el destino');
  }

  const clave = regroupKey(command.from, command.to);
  const usados = state.regroupMoves[clave] ?? 0;
  if (usados >= ctx.config.regroup.maxMovesPerPair) {
    return falla(
      RULE_ERROR.REGROUP_LIMIT,
      `Ya se movieron ejercitos entre esos territorios (${ctx.config.regroup.maxMovesPerPair} por par)`,
    );
  }

  const disponibles = armiesOf(state, command.from) - ctx.config.combat.minArmiesPerTerritory;
  if (!Number.isInteger(command.count) || command.count < 1 || command.count > disponibles) {
    return falla(
      RULE_ERROR.INVALID_COUNT,
      `Se pueden mover entre 1 y ${Math.max(0, disponibles)} ejercitos`,
    );
  }

  const events: GameEvent[] = [
    { type: 'ARMIES_MOVED', from: command.from, to: command.to, count: command.count },
  ];

  let siguiente = conTerritorios(state, {
    [command.from]: { armies: armiesOf(state, command.from) - command.count },
    [command.to]: { armies: armiesOf(state, command.to) + command.count },
  });
  siguiente = {
    ...siguiente,
    regroupMoves: { ...siguiente.regroupMoves, [clave]: usados + 1 },
  };

  siguiente = sellar(siguiente, ctx);
  siguiente = resolverVictoria(siguiente, ctx, events);
  return ok(siguiente, events);
}

// ---------------------------------------------------------------------------
// Fin de fase y de turno
// ---------------------------------------------------------------------------

function aplicarEndPhase(
  state: GameState,
  ctx: ApplyContext,
): Result<{ state: GameState; events: readonly GameEvent[] }, RuleError> {
  if (state.phase === 'reinforce') {
    if (state.armiesToPlace > 0) {
      return falla(
        RULE_ERROR.MUST_PLACE_ARMIES,
        `Quedan ${state.armiesToPlace} ejercitos por colocar`,
      );
    }
    const jugador = state.players.find(
      (player) => player.id === state.currentPlayer,
    ) as PlayerState;
    if (
      ctx.config.cards.forcedTradeAt > 0 &&
      jugador.cards.length >= ctx.config.cards.forcedTradeAt
    ) {
      return falla(
        RULE_ERROR.MUST_TRADE,
        `Con ${ctx.config.cards.forcedTradeAt} tarjetas o mas el canje es obligatorio`,
      );
    }
    const events: GameEvent[] = [{ type: 'PHASE_CHANGED', phase: 'attack' }];
    const siguiente = sellar({ ...state, phase: 'attack' }, ctx);
    return ok(resolverVictoria(siguiente, ctx, events), events);
  }

  if (state.phase === 'attack') {
    const events: GameEvent[] = [{ type: 'PHASE_CHANGED', phase: 'regroup' }];
    const siguiente = sellar({ ...state, phase: 'regroup' }, ctx);
    return ok(resolverVictoria(siguiente, ctx, events), events);
  }

  return falla(RULE_ERROR.WRONG_PHASE, 'No hay nada que terminar en esta fase');
}

function aplicarEndTurn(
  state: GameState,
  ctx: ApplyContext,
): Result<{ state: GameState; events: readonly GameEvent[] }, RuleError> {
  if (state.phase !== 'attack' && state.phase !== 'regroup') {
    return falla(RULE_ERROR.WRONG_PHASE, 'El turno se cierra despues de atacar');
  }

  const events: GameEvent[] = [];
  const jugadorId = state.currentPlayer;
  let siguiente = state;

  // Robo: una tarjeta si se conquisto al menos un territorio.
  if (ctx.config.cards.drawOnConquest && state.conqueredThisTurn) {
    const robo = drawCard(state.deck, state.discard, ctx.rng);
    if (robo.card !== null) {
      const jugador = state.players.find((player) => player.id === jugadorId) as PlayerState;
      siguiente = conJugador(siguiente, jugadorId, { cards: [...jugador.cards, robo.card] });
      events.push({ type: 'CARD_DRAWN', player: jugadorId });
    }
    siguiente = { ...siguiente, deck: robo.deck, discard: robo.discard };
  }

  const siguienteId = nextAlivePlayer(state, jugadorId);
  const primeroVivo = alivePlayers(state)[0] as PlayerState;
  const vueltas = siguienteId === primeroVivo.id;

  siguiente = {
    ...siguiente,
    currentPlayer: siguienteId,
    phase: 'reinforce',
    turn: vueltas ? state.turn + 1 : state.turn,
    armiesToPlace: reinforcementsFor(siguiente, siguienteId, ctx.config),
    placementRound: 0,
    placementRoundAllowance: null,
    pendingConquest: null,
    regroupMoves: {},
    conqueredThisTurn: false,
    conqueredTerritories: [],
  };

  events.push({ type: 'TURN_CHANGED', player: siguienteId });
  events.push({ type: 'PHASE_CHANGED', phase: 'reinforce' });

  siguiente = sellar(siguiente, ctx);
  siguiente = resolverVictoria(siguiente, ctx, events);
  return ok(siguiente, events);
}

function aplicarSurrender(
  state: GameState,
  playerId: PlayerId,
  ctx: ApplyContext,
): Result<{ state: GameState; events: readonly GameEvent[] }, RuleError> {
  const events: GameEvent[] = [{ type: 'PLAYER_ELIMINATED', player: playerId }];
  let siguiente = conJugador(state, playerId, { alive: false });

  if (state.currentPlayer === playerId) {
    const siguienteId = nextAlivePlayer({ ...siguiente }, playerId);
    siguiente = {
      ...siguiente,
      currentPlayer: siguienteId,
      phase: 'reinforce',
      armiesToPlace: reinforcementsFor(siguiente, siguienteId, ctx.config),
      placementRound: 0,
      placementRoundAllowance: null,
      pendingConquest: null,
      regroupMoves: {},
      conqueredThisTurn: false,
      conqueredTerritories: [],
    };
    events.push({ type: 'TURN_CHANGED', player: siguienteId });
    events.push({ type: 'PHASE_CHANGED', phase: 'reinforce' });
  }

  siguiente = sellar(siguiente, ctx);
  siguiente = resolverVictoria(siguiente, ctx, events);
  return ok(siguiente, events);
}
