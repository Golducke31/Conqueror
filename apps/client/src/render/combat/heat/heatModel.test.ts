import { describe, expect, it } from 'vitest';

import type { BattleRoundResolved, GameEvent } from '@conqueror/rules';
import { createHeatModel, DEFAULT_HEAT_PARAMS } from './heatModel.js';

/** Ronda de prueba: sin bajas, los numeros despues no importan para el calor. */
function ronda(from: string, to: string): BattleRoundResolved {
  return {
    type: 'BATTLE_ROUND_RESOLVED',
    from,
    to,
    attackerDice: [6],
    defenderDice: [1],
    comparisons: [{ attackerDie: 6, defenderDie: 1, winner: 'attacker' }],
    attackerLosses: 0,
    defenderLosses: 1,
    attackerArmiesAfter: 10,
    defenderArmiesAfter: 3,
  };
}

const turno: GameEvent = { type: 'TURN_CHANGED', player: 'p2' };

describe('heatModel', () => {
  it('arranca en cero', () => {
    const model = createHeatModel();
    expect(model.entries()).toEqual([]);
    expect(model.get('brasil')).toBe(0);
  });

  it('una ronda calienta los dos lados del frente; el atacado mas', () => {
    const model = createHeatModel();
    model.apply([ronda('argentina', 'brasil')]);
    expect(model.get('argentina')).toBeCloseTo(DEFAULT_HEAT_PARAMS.risePerRound, 10);
    expect(model.get('brasil')).toBeCloseTo(
      DEFAULT_HEAT_PARAMS.risePerRound + DEFAULT_HEAT_PARAMS.risePerRoundTarget,
      10,
    );
    expect(model.get('brasil')).toBeGreaterThan(model.get('argentina'));
  });

  it('el calor se acumula ronda a ronda', () => {
    const model = createHeatModel();
    model.apply([ronda('argentina', 'brasil'), ronda('argentina', 'brasil')]);
    expect(model.get('argentina')).toBeCloseTo(2 * DEFAULT_HEAT_PARAMS.risePerRound, 10);
  });

  it('el calor nunca pasa de 1', () => {
    const model = createHeatModel();
    const rondas = Array.from({ length: 50 }, () => ronda('a', 'b'));
    model.apply(rondas);
    expect(model.get('a')).toBe(1);
    expect(model.get('b')).toBe(1);
  });

  it('una conquista es un pico', () => {
    const model = createHeatModel();
    model.apply([{ type: 'TERRITORY_CONQUERED', territory: 'chile' }]);
    expect(model.get('chile')).toBeCloseTo(DEFAULT_HEAT_PARAMS.risePerConquest, 10);
  });

  it('cada cambio de turno enfria todos los territorios', () => {
    const model = createHeatModel();
    model.apply([ronda('a', 'b')]);
    model.apply([turno]);
    expect(model.get('a')).toBeCloseTo(
      DEFAULT_HEAT_PARAMS.risePerRound * DEFAULT_HEAT_PARAMS.decayPerTurn,
      10,
    );
    model.apply([turno]);
    expect(model.get('a')).toBeCloseTo(
      DEFAULT_HEAT_PARAMS.risePerRound * DEFAULT_HEAT_PARAMS.decayPerTurn ** 2,
      10,
    );
  });

  it('el calor que decae a casi cero se olvida (no quedan entradas sucias)', () => {
    const model = createHeatModel();
    model.apply([ronda('a', 'b')]);
    for (let index = 0; index < 12; index += 1) model.apply([turno]);
    expect(model.entries()).toEqual([]);
  });

  it('los parametros se pueden ajustar', () => {
    const model = createHeatModel({ risePerRound: 0.5, decayPerTurn: 1 });
    model.apply([ronda('a', 'b'), turno]);
    // decayPerTurn = 1: el turno no enfria nada.
    expect(model.get('a')).toBeCloseTo(0.5, 10);
  });

  it('apply avisa si algo cambio', () => {
    const model = createHeatModel();
    expect(model.apply([{ type: 'ARMIES_PLACED', territory: 'a', count: 3 }])).toBe(false);
    expect(model.apply([ronda('a', 'b')])).toBe(true);
    expect(model.apply([turno])).toBe(true);
  });

  it('recalcular desde el log completo da el mismo estado que aplicarlo de a poco', () => {
    const log: GameEvent[] = [
      ronda('argentina', 'brasil'),
      ronda('argentina', 'brasil'),
      { type: 'TERRITORY_CONQUERED', territory: 'brasil' },
      turno,
      ronda('chile', 'argentina'),
      { type: 'CARD_DRAWN', player: 'p1' },
      turno,
    ];

    const incremental = createHeatModel();
    for (const event of log) incremental.apply([event]);

    const recomputado = createHeatModel();
    recomputado.apply(log);

    for (const [territory, value] of incremental.entries()) {
      expect(recomputado.get(territory)).toBeCloseTo(value, 12);
    }
    expect(recomputado.entries()).toEqual(incremental.entries());
  });

  it('reset vuelve todo a cero', () => {
    const model = createHeatModel();
    model.apply([ronda('a', 'b'), { type: 'TERRITORY_CONQUERED', territory: 'b' }]);
    model.reset();
    expect(model.entries()).toEqual([]);
  });
});
