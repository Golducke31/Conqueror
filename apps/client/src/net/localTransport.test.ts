/**
 * Tests del transporte local (motor en el cliente).
 *
 * Corren con el motor en el hilo principal (`engine: 'inline'`): el worker es
 * la misma logica detras de un `postMessage`, yACA se prueba el contrato
 * completo: estado publico filtrado por jugador, eventos, errores de regla y
 * el juego automatico de los bots.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_RULES_CONFIG, PLAYER_COLOR_ORDER, type PlayerColorId } from '@conqueror/shared';
import type { GameEvent } from '@conqueror/rules';

import { LocalTransport } from './localTransport.js';

function jugadores(cantidad: number): {
  id: string;
  name: string;
  color: PlayerColorId;
}[] {
  return Array.from({ length: cantidad }, (_, indice) => ({
    id: `p${indice + 1}`,
    name: `Jugador ${indice + 1}`,
    color: (PLAYER_COLOR_ORDER[indice] ?? 'rojo') as PlayerColorId,
  }));
}

/** Coloca todos los ejércitos del jugador de turno, de a tandas de 3. */
async function desplegar(transport: LocalTransport): Promise<void> {
  let estado = transport.getState();
  let guardia = 0;
  while (estado !== null && estado.phase === 'setup-placement' && guardia < 500) {
    const propios = Object.entries(estado.territories)
      .filter(([, valor]) => valor.owner === estado?.activePlayer)
      .map(([id]) => id);
    const tope = estado.placementAllowance ?? 3;
    const count = Math.max(1, Math.min(3, estado.armiesToPlace, tope));
    await transport.send({ type: 'PLACE_ARMIES', territory: propios[0] as string, count });
    estado = transport.getState();
    guardia += 1;
  }
}

/** Coloca los refuerzos del jugador de turno. */
async function reforzar(transport: LocalTransport): Promise<void> {
  let estado = transport.getState();
  let guardia = 0;
  while (
    estado !== null &&
    estado.phase === 'reinforce' &&
    estado.armiesToPlace > 0 &&
    guardia < 200
  ) {
    const propios = Object.entries(estado.territories)
      .filter(([, valor]) => valor.owner === estado?.activePlayer)
      .map(([id]) => id);
    await transport.send({
      type: 'PLACE_ARMIES',
      territory: propios[0] as string,
      count: Math.min(3, estado.armiesToPlace),
    });
    estado = transport.getState();
    guardia += 1;
  }
}

describe('LocalTransport', () => {
  it('arma la partida y expone el estado publico del primer jugador', async () => {
    const transport = await LocalTransport.create({
      engine: 'inline',
      spec: { players: jugadores(3), config: DEFAULT_RULES_CONFIG, seed: 1234 },
    });

    const inicial = transport.getState();
    expect(inicial).not.toBeNull();
    expect(inicial?.phase).toBe('setup-placement');
    expect(inicial?.activePlayer).toBe('p1');
    expect(inicial?.players).toHaveLength(3);
    expect(inicial?.ownCards).toEqual([]);
    // La mision es privada: llega solo la del jugador que mira.
    expect(inicial?.ownMission).not.toBeUndefined();

    // Cada jugador arranca con territorios repartidos y 1 ejercito.
    const conDueno = Object.values(inicial?.territories ?? {}).filter((t) => t.owner !== null);
    expect(conDueno).toHaveLength(50);
    for (const territorio of conDueno) expect(territorio.armies).toBe(1);

    transport.dispose();
  });

  it('aplica comandos, emite eventos y pasa de fase', async () => {
    const transport = await LocalTransport.create({
      engine: 'inline',
      spec: { players: jugadores(3), config: DEFAULT_RULES_CONFIG, seed: 99 },
    });

    const eventos: GameEvent[] = [];
    transport.onEvents((nuevos) => eventos.push(...nuevos));

    await desplegar(transport);

    const estado = transport.getState();
    expect(estado?.phase).toBe('reinforce');
    expect(estado?.activePlayer).toBe('p1');
    expect(estado?.armiesToPlace).toBeGreaterThan(0);
    expect(eventos.some((evento) => evento.type === 'ARMIES_PLACED')).toBe(true);

    // Refuerzos completos y a atacar.
    await reforzar(transport);
    expect(transport.getState()?.armiesToPlace).toBe(0);
    await transport.send({ type: 'END_PHASE' });
    expect(transport.getState()?.phase).toBe('attack');

    await transport.send({ type: 'END_TURN' });
    expect(transport.getState()?.activePlayer).toBe('p2');
    expect(transport.getState()?.phase).toBe('reinforce');

    transport.dispose();
  });

  it('rechaza comandos ilegales y avisa por onError', async () => {
    const transport = await LocalTransport.create({
      engine: 'inline',
      spec: { players: jugadores(3), config: DEFAULT_RULES_CONFIG, seed: 7 },
    });

    const errores: string[] = [];
    transport.onError((mensaje) => errores.push(mensaje));

    const inicial = transport.getState();
    const ajeno = Object.entries(inicial?.territories ?? {}).find(
      ([, valor]) => valor.owner !== inicial?.activePlayer,
    );

    // Territorio de otro jugador: el motor lo rechaza.
    await transport.send({ type: 'PLACE_ARMIES', territory: ajeno?.[0] as string, count: 1 });
    expect(errores.length).toBe(1);

    // Territorio que no existe.
    await transport.send({ type: 'PLACE_ARMIES', territory: 'atlantida', count: 1 });
    expect(errores.length).toBe(2);

    // Cantidad mayor a la que queda por colocar.
    await transport.send({ type: 'PLACE_ARMIES', territory: ajeno?.[0] as string, count: 999 });
    expect(errores.length).toBe(3);

    // El estado no cambio con los comandos rechazados.
    expect(transport.getState()?.phase).toBe('setup-placement');
    expect(transport.getState()?.activePlayer).toBe('p1');

    transport.dispose();
  });

  it('los bots juegan solos su turno', async () => {
    const transport = await LocalTransport.create({
      engine: 'inline',
      spec: {
        players: jugadores(2),
        config: DEFAULT_RULES_CONFIG,
        seed: 5,
        botPlayers: ['p2'],
        botSeed: 77,
      },
      botDelayMs: 0,
    });

    await desplegar(transport);
    expect(transport.getState()?.activePlayer).toBe('p1');

    // p1 (humana) refuerza y termina el turno sin atacar.
    await reforzar(transport);
    await transport.send({ type: 'END_PHASE' });
    await transport.send({ type: 'END_TURN' });
    expect(transport.getState()?.activePlayer).toBe('p2');

    // El bot de p2 juega solo: hay que esperar a que avance.
    const espera = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    for (let intento = 0; intento < 40; intento += 1) {
      const actual = transport.getState();
      if (actual?.activePlayer === 'p1') break;
      await espera(25);
    }
    expect(transport.getState()?.activePlayer).toBe('p1');

    transport.dispose();
  }, 15_000);
});
