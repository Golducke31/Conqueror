/**
 * @conqueror/map-data/node
 * Entrypoint exclusivo para Node: carga la config desde disco.
 * No debe importarse desde el cliente.
 */

export { loadMapConfig, parseMapConfig } from './load-config.js';
export { mapConfigSchema } from './config-schema.js';
