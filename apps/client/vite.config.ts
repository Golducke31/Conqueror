import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

/**
 * Artefactos del tablero que genera `pnpm map:build`, servidos bajo `/map/`.
 * Los nombres son los de `@conqueror/map-data`
 * (TERRITORIES_TOPOLOGY_FILE, TERRITORIES_INDEX_FILE, ADJACENCY_FILE,
 * FRONTS_FILE): se repiten aca porque el config corre en Node puro y no puede
 * importar el paquete, que es TypeScript.
 */
const MAP_FILES: readonly string[] = [
  'territories.topojson.json',
  'territories.json',
  'adjacency.json',
  'fronts.json',
];

/** Carpeta donde `map:build` deja los artefactos. */
const MAP_GENERATED = resolve(import.meta.dirname, '../../packages/map-data/generated');

/**
 * Sirve los artefactos del tablero bajo `/map/`, sin duplicarlos en el repo:
 * en dev y preview se leen de `packages/map-data/generated`, y en el build se
 * emiten como assets de `dist/map/`.
 *
 * Antes vivian (mal) en `public/`, que nadie poblaba: el juego cargaba con 404.
 * Ver docs/adr/0004-datos-de-mapa-natural-earth.md.
 */
function mapAssets(): Plugin {
  return {
    name: 'conqueror-map-assets',
    configureServer(server) {
      server.middlewares.use('/map', (request, response, next) => {
        const file = (request.url ?? '').split('?')[0]?.replace(/^\/+/, '') ?? '';
        if (!MAP_FILES.includes(file)) {
          next();
          return;
        }
        try {
          const content = readFileSync(resolve(MAP_GENERATED, file));
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          response.end(content);
        } catch {
          next();
        }
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use('/map', (request, response, next) => {
        const file = (request.url ?? '').split('?')[0]?.replace(/^\/+/, '') ?? '';
        if (!MAP_FILES.includes(file)) {
          next();
          return;
        }
        try {
          const content = readFileSync(resolve(MAP_GENERATED, file));
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          response.end(content);
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const file of MAP_FILES) {
        let source: Buffer;
        try {
          source = readFileSync(resolve(MAP_GENERATED, file));
        } catch {
          this.error(`falta el artefacto del mapa ${file}: corre \`pnpm map:build\``);
          return;
        }
        this.emitFile({
          type: 'asset',
          fileName: `map/${file}`,
          source,
        });
      }
    },
  };
}

/**
 * Permite entrar al sandbox con `/debug/combat` (sin `.html`), como pide el
 * plan de combate, tanto en `dev` como en `preview`.
 */
function debugRoutes(): Plugin {
  const rewrite = (url: string | undefined): string | undefined => {
    if (url === undefined) return url;
    if (url === '/debug/combat' || url === '/debug/combat/') return '/debug/combat.html';
    if (url === '/debug/sounds' || url === '/debug/sounds/') return '/debug/sounds.html';
    if (url === '/debug/models' || url === '/debug/models/') return '/debug/models.html';
    return url;
  };

  return {
    name: 'conqueror-debug-routes',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const rewritten = rewrite(request.url);
        if (rewritten !== undefined) request.url = rewritten;
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, _response, next) => {
        const rewritten = rewrite(request.url);
        if (rewritten !== undefined) request.url = rewritten;
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), mapAssets(), debugRoutes()],
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
  preview: {
    port: 4173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Presupuesto del plan: JS inicial < 300 KB gzip sin datos del mapa.
    // Se avisa (no se rompe el build) si se pasa.
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      input: {
        main: 'index.html',
        combat: 'debug/combat.html',
        sounds: 'debug/sounds.html',
        models: 'debug/models.html',
      },
    },
  },
});
