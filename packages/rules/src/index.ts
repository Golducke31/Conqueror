/**
 * @conqueror/rules
 * Motor de reglas del juego: puro, determinista y sin dependencias de DOM,
 * Three.js, Colyseus ni Node.
 *
 * Hito 3: implementado. `apply` es el unico lugar donde cambian las reglas y
 * `getLegalCommands` la unica lista de jugadas validas. Todo valor ajustable
 * sale de `RulesConfig`: aca no hay numeros de reglas escritos a mano.
 *
 * Ver docs/adr/0003-motor-de-reglas-puro-y-determinista.md
 */

export * from './types.js';
export * from './rng.js';
export * from './board.js';
export * from './queries.js';
export * from './cards.js';
export * from './objectives.js';
export * from './combat.js';
export * from './state.js';
export * from './apply.js';
export * from './legal.js';
export * from './bots.js';
// Nucleo compartido (cliente y servidor online): envuelve el GameState completo.
export * from './core.js';
// Protocolo del modo online (Hito 6): mensajes cliente <-> servidor.
export * from './protocol.js';

// Modulos que ya existian y no son parte del motor de reglas.
export * from './battle-odds.js';
export * from './compose-squad.js';
