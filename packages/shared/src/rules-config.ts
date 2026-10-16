/**
 * Configuracion de reglas.
 *
 * TODO-VERIFY: todo valor marcado con este comentario debe confirmarse contra el
 * reglamento oficial antes de cerrar el Hito 3. Mientras tanto se usan los
 * valores clasicos ya validados en el tablero de 50 territorios.
 *
 * Regla del proyecto: NINGUNA regla se escribe hardcodeada en el motor. Todo
 * valor ajustable vive aca.
 */

import type { ContinentId, TerritoryId } from './ids.js';

/** Cantidad de ejercitos con la que arranca cada jugador segun cuantos sean. */
export type StartingArmiesByPlayerCount = Readonly<Record<number, number>>;

export interface RulesConfig {
  /** Cantidad de jugadores admitida. */
  readonly players: {
    readonly min: number;
    readonly max: number;
  };

  /** Despliegue inicial. */
  readonly initialPlacement: {
    /**
     * Ejercitos que se colocan por turno de despliegue.
     * En el juego clasico se colocan 5 en la primera ronda de cada jugador y 3
     * en las siguientes, hasta agotar el total.
     */
    readonly firstRound: number;
    readonly laterRounds: number;
    /** Total de ejercitos iniciales por cantidad de jugadores. */
    readonly totalByPlayerCount: StartingArmiesByPlayerCount;
  };

  /** Refuerzos al inicio de cada turno. */
  readonly reinforcement: {
    /**
     * Divisor de territorios: `floor(territorios / divisor)`.
     * Clasico = 3 (un ejercito cada tres territorios). // TODO-VERIFY
     */
    readonly divisor: number;
    /** Minimo de ejercitos por turno, aunque el calculo de menos. */
    readonly minimum: number;
  };

  /** Bonus por dominar un continente completo. */
  readonly continentBonuses: Readonly<Record<ContinentId, number>>;

  /** Combate con dados. */
  readonly combat: {
    /** Dados maximos del atacante. */
    readonly maxAttackerDice: number;
    /** Dados maximos del defensor. */
    readonly maxDefenderDice: number;
    /** En caso de empate, gana el defensor. */
    readonly tiesGoToDefender: boolean;
    /** Ejercitos minimos que deben quedar en cualquier territorio con dueno. */
    readonly minArmiesPerTerritory: number;
  };

  /** Movimiento tras conquistar. */
  readonly conquest: {
    /**
     * Ejercitos minimos que se mueven al territorio conquistado.
     * `'attacker-dice'` = tantos como dados uso el atacante. // TODO-VERIFY
     */
    readonly minMove: number | 'attacker-dice';
  };

  /** Reagrupamiento al final del turno. */
  readonly regroup: {
    /** Movimientos permitidos por cada par origen/destino. */
    readonly maxMovesPerPair: number;
    /** Exigir camino de territorios propios entre origen y destino. */
    readonly requireOwnPath: boolean;
  };

  /** Tarjetas y canjes. */
  readonly cards: {
    /** Se roba una tarjeta al cerrar el turno si se conquisto al menos un territorio. */
    readonly drawOnConquest: boolean;
    /** Cantidad de comodines en el mazo. */
    readonly wildcards: number;
    /** A partir de esta cantidad de tarjetas el canje es obligatorio. */
    readonly forcedTradeAt: number;
    /** Escala de canje: valor base por tipo. */
    readonly tradeValue: {
      readonly allSame: number;
      readonly allDifferent: number;
    };
    /** Incremento por cada canje ya realizado en la partida. // TODO-VERIFY */
    readonly escalatingStep: number;
    /** Ejercitos extra por cada tarjeta canjeada de un territorio propio. */
    readonly ownTerritoryBonus: number;
  };

  /** Condicion de victoria. */
  readonly victory: {
    readonly strategy: 'secret-missions' | 'common-objective';
    /** Territorios necesarios para ganar con objetivo comun. */
    readonly commonObjectiveTerritories: number;
    /**
     * Si una mision secreta es imposible o ya esta cumplida, cae a conquistar
     * esta cantidad de territorios.
     */
    readonly missionFallbackTerritories: number;
    /** Misiones secretas que se reparten. */
    readonly missionDeck: readonly SecretMission[];
  };

  /** Eliminacion de jugadores. */
  readonly elimination: {
    /** Quien elimina a otro se queda con sus tarjetas. */
    readonly inheritCards: boolean;
    /** Las tarjetas heredadas entran en el canje del turno siguiente. */
    readonly inheritedCardsAreTradeable: boolean;
  };

  /** Turnos y tiempos. */
  readonly turn: {
    /** Segundos por turno en modo online. `null` = sin limite. */
    readonly timerSeconds: number | null;
    /** Turnos sin accion tras los cuales el jugador es reemplazado por un bot. */
    readonly afkTurnsBeforeBot: number;
  };
}

/** Tipos de mision secreta. */
export type SecretMission =
  | {
      readonly kind: 'conquer-continents';
      readonly continents: readonly ContinentId[];
      readonly extraTerritories: number;
    }
  | { readonly kind: 'eliminate-player'; readonly targetColor: string }
  | { readonly kind: 'conquer-territories'; readonly count: number }
  | { readonly kind: 'own-territories'; readonly territories: readonly TerritoryId[] };

/**
 * Configuracion por defecto.
 * Valores clasicos del tablero de 50 territorios y 6 continentes.
 */
export const DEFAULT_RULES_CONFIG: RulesConfig = {
  players: { min: 2, max: 6 },

  initialPlacement: {
    firstRound: 5,
    laterRounds: 3,
    totalByPlayerCount: { 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 },
  },

  reinforcement: {
    divisor: 3,
    minimum: 3,
  },

  continentBonuses: {
    america_del_sur: 3,
    america_del_norte: 5,
    europa: 5,
    asia: 7,
    africa: 3,
    oceania: 2,
  },

  combat: {
    maxAttackerDice: 3,
    maxDefenderDice: 2,
    tiesGoToDefender: true,
    minArmiesPerTerritory: 1,
  },

  conquest: {
    minMove: 'attacker-dice',
  },

  regroup: {
    maxMovesPerPair: 1,
    requireOwnPath: true,
  },

  cards: {
    drawOnConquest: true,
    wildcards: 2,
    forcedTradeAt: 5,
    tradeValue: { allSame: 7, allDifferent: 10 },
    escalatingStep: 2,
    ownTerritoryBonus: 2,
  },

  victory: {
    strategy: 'secret-missions',
    commonObjectiveTerritories: 30,
    missionFallbackTerritories: 30,
    missionDeck: [],
  },

  elimination: {
    inheritCards: true,
    inheritedCardsAreTradeable: true,
  },

  turn: {
    timerSeconds: null,
    afkTurnsBeforeBot: 2,
  },
};
