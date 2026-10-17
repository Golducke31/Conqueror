import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

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
  plugins: [tailwindcss(), debugRoutes()],
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
