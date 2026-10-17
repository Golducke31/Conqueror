# ADR 0013: Modo local jugable — transporte, worker y hot-seat

- Estado: aceptada
- Fecha: 2026-10-17
- Hito: 4 (modo local jugable)

## Contexto

Con el motor de reglas cerrado (Hito 3, ADR 0003) habia que convertir el
tablero en una partida jugable de punta a punta: 2 a 6 jugadores en el mismo
dispositivo (hot-seat), con bots opcionales, y una UI que no sepa si la partida
corre local o en un servidor (el online llega en el Hito 6).

Las restricciones que ya estaban tomadas y que condicionan la decision:

- La UI habla SIEMPRE contra `GameTransport` (`apps/client/src/net/transport.ts`).
- La logica de juego nunca vive en el render ni en el HUD.
- El estado publico nunca incluye tarjetas ni misiones ajenas (`publicState`).

## Decision

**1. `LocalTransport` con el motor en un Web Worker, y el mismo nucleo
(`GameCore`) disponible en el hilo principal.** El worker (`net/rulesWorker.ts`)
corre `packages/rules` fuera del hilo de render: la UI y el combate visual no
compiten con la logica ni con las partidas de los bots. `GameCore`
(`net/engineCore.ts`) envuelve el `GameState` completo —tarjetas y misiones
incluidas, que NUNCA salen del cliente— y expone solo la vista publica filtrada
por el jugador de turno, exactamente lo que el servidor autoritativo difundira
en online. Los tests usan el motor en hilo principal (`engine: 'inline'`), que
comparte el mismo nucleo.

**2. El viewer es el jugador de turno.** En hot-seat, el estado publico se
filtra por `currentPlayer`: cada jugador ve solo sus tarjetas y su mision. La
pantalla de relevo (`ui/handoff.ts`) agrega la ocultad fisica entre turno y
turno, que la UI reactiva no puede dar.

**3. El tablero alcanza al motor con la coreografia; el HUD nunca espera.**
Cuando llegan estado y eventos juntos, el HUD usa el estado real del motor y el
tablero aplica las rondas y la onda de dueño con la animacion (el
`CombatDirector` del sandbox, ahora alimentado por eventos reales). El estado
publico que llega mientras el director esta ocupado se aplica al quedar libre.
Asi el tablero nunca muestra algo que las reglas no hayan decidido, y la
animacion no bloquea la jugada.

**4. Bots nivel 1 DENTRO de `packages/rules` (`bots.ts`).** El plan pone los
bots en el paquete de reglas porque los comparten el cliente (modo local) y el
servidor (reemplazo de AFK, Hito 6). El nivel 1 elige siempre comandos legales
con criterio minimo para que la partida avance: reforzar el frente (lotes en la
cuña), colocar al azar en el despliegue (repartir al azar rompe simetrias),
atacar solo con ventaja de dados, consolidar las conquistas y reagrumer de vez
en cuando. El nivel 2 heuristico espera al Hito 7.

El bot **no garantiza terminar todas las partidas**: es nivel 1, no un
resolvedor. Lo que si garantiza es no mandar nunca un comando que el motor
rechace y avanzar siempre de fase. La garantia de terminacion de las 1000
partidas del Hito 3 la sigue dando la politica de
`test-helpers.playRandomGame`, que no se toco.

**5. Partida automatica para el e2e (`?auto=1`).** La pantalla inicial es la
configuracion local (`ui/setup.ts`); `?auto=1` arranca directo una partida con
`humanos` humanos y el resto bots, con semilla fija por defecto. Es la puerta
que usa el smoke para verificar el criterio de terminado del hito (una partida
local se juega de inicio a fin) sin depender de clics fragiles.

**6. `PublicGameState` gana `placementAllowance` y `armiesToPlace`.** El HUD
necesita el tope de la ronda de despliegue para no ofrecer colocar mas de lo
que la ronda permite, y el faltante para colocar. Son datos publicos (no
revelan nada privado) y el servidor los tendria tambien.

## Consecuencias

- El modo online (Hito 6) agrega `ColyseusTransport` contra la misma interfaz:
  el HUD, el director de combate y el relevo se reutilizan sin cambios.
- El worker agrega un chunk propio al build (28 KB) que se carga en paralelo al
  paquete principal; si no hay `Worker` (o en tests), el transporte cae al motor
  en hilo principal sin cambiOS de interfaz.
- La separacion estado-visual / estado-de-reglas agrega una variable de estado
  (`pendiente`) en `matchApp`: si el director quedara ocupado por siempre, el
  tablero quedaria atras. El skip (clic, Espacio, Esc) es la salida, y la
  calidad adaptativa ya existente acota el riesgo.
- El bot nivel 1 hace jugable la partida solo (pruebas de flujo) y servira de
  reemplazo de AFK en online; su calidad de juego es acotada a proposito.

## Alternativas descartadas

- **Motor en el hilo principal siempre:** mas simple, pero una partida de bots
  o una jugada del humano compiten con el render. El worker es el mismo nucleo
  detras de un `postMessage`; el costo de mantenimiento es una interfaz.
- **Aplicar el estado solo cuando la animacion lo permita:** mas fiel al estilo
  del sandbox, pero convierte la animacion en bloqueante, contra la regla del
  plan (seccion 6.1: "el estado ya esta actualizado; la animacion va
  desacoplada").
- **Reemplazar la politica de `test-helpers.playRandomGame` por el bot del
  cliente:** se intento, para tener una sola implementacion. La politica del
  test del Hito 3 (colocacion al azar en el despliegue, lotes en el refuerzo,
  reagruneo 1-en-4 por comando) es mas eficaz para terminar partidas que
  cualquier adaptacion razonable del bot, y cambiarla ponia en rojo un criterio
  de terminado ya cerrado. Se dejo el test como estaba.
- **Servir el mapa desde `public/`:** era el plan original, pero nadie poblaba
  la carpeta y el tablero cargaba con 404. El plugin `mapAssets` lee directo de
  `packages/map-data/generated` y lo emite en el build.
