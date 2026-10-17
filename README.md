# Conqueror

Juego de conquista mundial por turnos para **2 a 6 jugadores**, con tablero 3D
sobre el **mapa real del mundo**, modo **local (hot-seat)** y modo **online**
(servidor autoritativo).

Proyecto en construccion por hitos. Estado actual: **Hitos 0 a 3 cerrados**
(base del proyecto, datos del mapa, tablero 3D interactivo y motor de reglas
puro y determinista) y **Hitos C0 a C6 del plan de combate cerrados** (sandbox
de combate, fichas y composicion, coreografia de ronda, conquista y cruce
maritimo, mapa vivo, audio y arte final).

## Requisitos

- Node 22.12 o superior
- pnpm 11

## Puesta en marcha

```bash
pnpm install
pnpm map:fetch        # baja Natural Earth 50m a data/ne/ (una sola vez)
pnpm map:build        # genera la geometria, el grafo y las anclas de frente
pnpm dev              # levanta el cliente en http://127.0.0.1:5173
```

Para ver el mapa generado sin abrir el juego:

```bash
pnpm map:preview      # escribe packages/map-data/generated/map-preview.svg
```

### Pantallas de desarrollo

| Ruta            | Que es                                                                         |
| --------------- | ------------------------------------------------------------------------------ |
| `/`             | Tablero interactivo con datos de prueba. `?jugadores=2..6` cambia la cantidad. |
| `/?debug=1`     | Lo mismo, con el overlay de FPS, draw calls y unidades visibles.               |
| `/debug/combat` | Sandbox de combate: dispara rondas entre dos territorios vecinos.              |
| `/debug/sounds` | Prueba de sonidos: un botón por slot del manifiesto.                           |
| `/debug/models` | Prueba de modelos: los cuatro tipos, en los cuatro colores de jugador.         |

## Comandos

| Comando                             | Que hace                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------- |
| `pnpm dev`                          | Cliente en modo desarrollo (Vite).                                         |
| `pnpm dev:server`                   | Servidor minimo con `/health` (Colyseus llega en el Hito 6).               |
| `pnpm build`                        | Build de produccion del cliente (tablero + sandbox).                       |
| `pnpm typecheck`                    | Chequeo de tipos de todos los paquetes y de `scripts/`.                    |
| `pnpm lint` / `pnpm lint:fix`       | ESLint.                                                                    |
| `pnpm format` / `pnpm format:check` | Prettier.                                                                  |
| `pnpm test`                         | Tests unitarios (Vitest).                                                  |
| `pnpm smoke`                        | Smoke test del cliente con Chromium. Requiere `pnpm build`.                |
| `pnpm map:fetch`                    | Descarga Natural Earth 50m a `data/ne/`.                                   |
| `pnpm map:build`                    | Genera `territories.json`, `adjacency.json`, `fronts.json` y el TopoJSON.  |
| `pnpm map:build --suggest`          | Igual, pero en vez de fallar imprime las entradas para pegar en la config. |
| `pnpm map:validate`                 | Valida el tablero generado. Falla el build si algo no cierra.              |
| `pnpm map:balance`                  | Informe de balance por continente y propuesta de bonos.                    |
| `pnpm map:all`                      | `map:build` + `map:validate` + `map:balance`.                              |
| `pnpm map:preview`                  | Vista previa del tablero en SVG.                                           |

## Estructura

```
apps/
  client/            Vite + TypeScript + Tailwind v4 + Three.js
    debug/           paginas de desarrollo (sandbox de combate)
    src/app/         bootstrap, i18n, paleta, datos de prueba
    src/map/         proyeccion, geometria del tablero, picking, camara
    src/render/      renderer bajo demanda, materiales, unidades, combate
    src/scenes/      escena del tablero
  server/            servidor HTTP minimo (Colyseus en el Hito 6)
packages/
  shared/            identificadores, tipos y RulesConfig
  rules/             motor de reglas puro + composeSquad
  map-data/          config del tablero, matriz clasica y artefactos generados
scripts/             fetch-map-data, build-map, validate-map, balance-report, preview, smoke
docs/adr/            decisiones de arquitectura
docs/art-spec.md     especificacion para los modelos finales
```

Regla de dependencias: `rules` no importa `three`, DOM, Colyseus ni Node.
`client` y `server` dependen de `rules`, nunca al reves.

## El tablero

- **50 territorios** en 6 continentes, agrupando paises y regiones reales.
- Geometria real de **Natural Earth 50m**, con las subdivisiones de primer nivel
  que el tablero necesita (Alaska, California, Siberia, Kamchatka, Gobi...).
- **89 fronteras** (62 terrestres y 27 enlaces) con **ancla de frente** cada una:
  punto, normal y longitud, calculadas en `pnpm map:build`.
- El grafo de adyacencia se **deriva de la geometria** y se verifica contra la
  matriz clasica del tablero: si no coincide, `pnpm map:validate` falla.
- TopoJSON: ~300 KB sin comprimir. Draw calls del tablero en reposo: **9**.

## Fichas y combate

- Las fichas del mapa se componen con `composeSquad` (funcion pura y testeada):
  10 ejercitos son una pieza de artilleria, 5 una de caballeria, 1 un soldado de
  infanteria. Un `InstancedMesh` por tipo: las 50 fichas cuestan 3 draw calls.
- La presentacion **no decide nada**: solo cuenta el evento `BATTLE_ROUND_RESOLVED`
  que ya viene resuelto por el motor (local) o el servidor (online).
- Niveles de espectaculo: **Rapido**, **Tactico** (por defecto) y **Cinematico**.
  `prefers-reduced-motion` fuerza Rapido.
- Siempre saltable: clic, Espacio o Esc.
- Ver `docs/adr/0005-fichas-instanciadas-y-composicion.md` y
  `docs/adr/0006-combate-visual-no-decide.md`.

## Motor de reglas

- `packages/rules` es un motor **puro, determinista y sin dependencias** de DOM,
  Three.js, Colyseus ni Node.
- `apply(state, command, playerId, { rng, config })` devuelve un **nuevo** estado
  (nunca muta el de entrada) y los eventos que la UI anima. `getLegalCommands`
  lista las jugadas validas para la UI y los bots.
- **8 comandos**: `PLACE_ARMIES`, `TRADE_CARDS`, `ATTACK`, `MOVE_AFTER_CONQUEST`,
  `REGROUP`, `END_PHASE`, `END_TURN`, `SURRENDER`. Fases: `setup-placement`,
  `reinforce`, `attack`, `conquest-move`, `regroup`, `game-over`.
- El RNG se **inyecta** (mulberry32) y es serializable (`snapshot()`): una
  partida se reproduce con `(seed, lista de comandos)`.
- **Nada hardcodeado**: todo numero ajustable vive en `RulesConfig`
  (`packages/shared`).
- Cubierto por property tests, un test de odds contra un resolvedor de Bellman
  independiente y una simulacion de 1000 partidas con bot legal-aleatorio que
  demuestra que el motor no tiene callejones sin salida.
- Ver `docs/adr/0003-motor-de-reglas-puro-y-determinista.md`.

## Idiomas

`es-AR` es el idioma principal y `en` el secundario. Ningun texto de UI se
escribe hardcodeado: todo pasa por `apps/client/src/app/i18n.ts`.

## Documentacion

- `docs/adr/` — decisiones de arquitectura (monorepo y stack, nombre y propiedad
  intelectual, motor de reglas, datos del mapa, fichas y composicion, combate
  visual, geometria del tablero).
- `docs/art-spec.md` — especificacion para los modelos finales.
- `docs/CREDITS.md` — licencias, atribuciones y la tabla de slots de audio.
