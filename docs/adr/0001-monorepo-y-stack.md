# ADR 0001 — Monorepo, stack y limites entre paquetes

- Estado: aceptada
- Fecha: 2026-10-16
- Hito: 0

## Contexto

El juego necesita tres cosas que suelen tirarse para lados distintos: un motor de
reglas que no puede depender del navegador, un cliente 3D que consume mucha CPU y
un servidor autoritativo que tiene que resolver exactamente las mismas reglas que
el cliente. Si la logica vive en el render o en la UI, el modo online se vuelve
imposible de mantener porque el servidor no puede reusar nada.

Tambien hay que elegir entre un stack con build y un stack de scripts clasicos
sin build. La version anterior del proyecto era scripts clasicos (funcionaba
desde `file://`), pero eso obligo a usar un namespace global y a renunciar a
tipos.

## Decision

1. **Monorepo con pnpm workspaces.** Paquetes: `packages/shared`, `packages/rules`,
   `packages/map-data`; aplicaciones: `apps/client`, `apps/server`; mas
   `scripts/` para las herramientas de datos.
2. **Regla de dependencias estricta:**
   `rules` no importa `three`, DOM, Colyseus ni `node:*`.
   `client` y `server` dependen de `rules`; nunca al reves.
   La logica de juego **nunca** vive en codigo de render, UI o red.
3. **TypeScript en modo `strict`**, con `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes` y `verbatimModuleSyntax`. Prohibido `any` sin
   justificacion comentada (regla de ESLint en `error`).
4. **Vite** para el cliente, **tsx** para los scripts de Node.
5. **Vitest** para tests unitarios. **Playwright** para el smoke test del cliente.
6. **ESLint con el preset `recommended` SIN informacion de tipos.** El chequeo de
   tipos lo hace `tsc --noEmit` en el script `typecheck`. Motivo: el lint
   type-aware obliga a que cada archivo pertenezca a un `tsconfig`, lo que
   agrega fricción y rompe el CI por razones que no son errores reales. Se
   corren los dos: `lint` y `typecheck`.
7. **Colyseus se instala en el Hito 6, no antes.** El Hito 0 deja un servidor
   HTTP minimo con `/health` para poder levantar y verificar el proceso sin
   arrastrar dependencias que todavia no se usan.
8. **TailwindCSS v4 con configuracion CSS-first** (`@theme` en
   `apps/client/src/styles/main.css`), sin archivo `tailwind.config.js`.

## Consecuencias

- Positivas: el motor de reglas es testeable sin navegador y el servidor del
  Hito 6 va a poder ejecutar exactamente el mismo codigo que el cliente. Los
  paquetes exponen su codigo fuente TypeScript directamente (`exports: "./src/index.ts"`),
  asi que no hay paso de compilacion intermedio en desarrollo.
- Negativas: sin build de paquetes, un consumidor externo (fuera del monorepo)
  no puede importar `@conqueror/rules` como paquete npm publicable. Si algun dia
  hace falta, se agrega `tsc` de emision en cada paquete.
- El smoke test necesita `pnpm build` antes: sirve `apps/client/dist` con un
  servidor estatico propio, para no depender de adivinar el puerto del dev server.
- Se renuncia explicitamente a `file://`: el proyecto ya no se abre con doble
  clic. Requiere `pnpm dev` o servir `dist/`.
