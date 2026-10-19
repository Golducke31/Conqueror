# ADR 0016: Modo online — servidor autoritativo con Colyseus

- Estado: aceptada
- Fecha: 2026-10-18
- Hito: 6 (modo online)

## Contexto

Con el modo local cerrado (Hito 4, ADR 0013) la UI ya hablaba solo contra
`GameTransport` y el motor ya exponía `publicState`, la vista pública que el
servidor tendría que difundir. Falta el modo online: dos o más personas en
distintos dispositivos contra un servidor que hace de juez.

Las restricciones que condicionan la decisión:

- La UI NO puede cambiar: HUD, director de combate y relevo se reutilizan tal
  cual (ADR 0013).
- El motor es puro y determinista (`@conqueror/rules`) y ya sabe filtrar su
  estado por espectador (`publicState(state, viewerId)`).
- `GameCore` (núcleo compartido) vivía en el cliente; el servidor necesita
  exactamente la misma lógica de aplicar comandos.
- El plan nombraba Colyseus; ADR 0001 había dicho "no se instala Colyseus
  todavía" para no arrastrar dependencias en el Hito 0.

## Decisión

**1. Colyseus (rooms v2, `@colyeus/core` 0.18) con transporte WebSocket.**
Se instala el set modular (`@colyseus/core`, `@colyseus/ws-transport`,
`@colyseus/schema`) y NO el meta-paquete `colyseus`: este arrastra
`@colyseus/uwebsockets-transport`, que depende de `uWebSockets.js` por git y
rompe `blockExoticSubdeps` del workspace. Cliente: `@colyseus/sdk` 0.18 (el SDK
de la línea 0.18; `colyseus.js` 0.16 es de la línea anterior).

**2. `GameCore` se mueve a `@conqueror/rules` (`core.ts`).** El núcleo era
puro y sin dependencias de DOM: moverlo al paquete de reglas deja UNA sola
implementación para el worker del cliente, el hilo principal (tests) y el
servidor. Gana `vistaPara(playerId)`: en hot-seat el espectador es el jugador
de turno; en online, cada socket. `publicState` ya filtraba por espectador y
devuelve cartas/misión vacías para uno desconocido (espectador).

**3. La sala es autoritativa y no sincroniza estado por esquemas.** La
`ConquerorRoom` corre el motor completo y manda a cada cliente solo SU
`publicState`. Todo el protocolo va por mensajes tipados
(`packages/rules/src/protocol.ts`) porque la vista pública ya es JSON plano:
duplicarla en `@colyseus/schema` solo agregaría un lugar donde divergir. La
sala valida el sobre con `zod`; el motor es el validador real de comandos.

**4. El transporte online implementa la MISMA interfaz.** `ColyseusTransport`
(`apps/client/src/net/colyseusTransport.ts`) envuelve la sala detrás de
`GameTransport`: `send` manda el comando con un `id` que el servidor acusa
(`applied`) o rechaza (`rejected`, que sale por `onError`). El HUD, el
director de combate y la pantalla de relevo no se tocan; en online el relevo se
desactiva (cada cliente ve su propia vista).

**5. Bienvenida por saludo, no por empuje.** El servidor NO manda la
bienvenida al entrar: la manda como respuesta a un `hola` del cliente. Así el
cliente tiene sus handlers registrados antes de que llegue el mensaje y no hay
carrera de registro. La fase de la sala viaja en el mensaje `seats`.

**6. Asientos, bots y reconexión.** Los asientos se asignan por orden de
llegada (`p1`, `p2`, …) y el host arma la partida con los conectados + bots de
relleno. Un comando fuera de turno se rechaza con `NOT_YOUR_TURN`. Al
desconectarse, el asiento se reserva (`allowReconnection`, 120 s) y el mismo
`sessionId` lo recupera. Los bots (nivel 1, `packages/rules`) corren en el
servidor con `startAutoPlay`.

## Consecuencias

- El servidor corre en `apps/server` (antes solo `/health`); mismo puerto
  sirve Colyseus y `/health`, `HOST`/`PORT` por entorno (por defecto
  `127.0.0.1:2567`).
- El cliente llega al servidor por `/colyseus` del mismo origen: Vite hace de
  proxy en dev y en preview, así un túnel https basta para jugar con un amigo
  (el cliente usa `wss:` cuando la página es https).
- Nuevas dependencias: `@colyseus/core`, `@colyseus/ws-transport`,
  `@colyseus/schema`, `express` (peer de `ws-transport`), `@colyseus/sdk`,
  `@colyseus/testing` (dev). `msgpackr-extract` se aprueba en `allowBuilds`
  (sin el, pnpm 11 corta el install por builds ignorados).
- El estado de la sala vive en memoria: reiniciar el servidor termina las
  partidas en curso. Aceptable para el hito; la persistencia queda para más
  adelante.
- Smoke online (`pnpm smoke:online`): levanta servidor + preview y juega un
  despliegue real entre dos clientes; corre en CI.
- `GameCore` deja de ser del cliente: el worker y el transporte local lo
  importan de `@conqueror/rules` (mismo núcleo, sin cambios de comportamiento).

## Alternativas descartadas

- **Meta-paquete `colyseus`:** rompe la política de dependencias exóticas del
  workspace (uWebSockets por git). El set modular evita el transporte
  uWebSockets sin perder nada de lo que se usa.
- **Estado sincronizado con `@colyseus/schema`:** obligaria a espejar el
  `GameState` en esquemas (dos definiciones de lo mismo, riesgo de divergencia)
  para un juego donde el "estado" ya es una vista JSON que se manda entera en
  cada paso.
- **Servidor TCP/WS propio sin Colyseus:** colgaba de la decisión del
  usuario; Colyseus trae rooms, reconexión y matchmaking resueltos, que es
  justo lo que no queremos escribir a mano.
- **Bienvenida al entrar (empujada):** perdia mensajes por la carrera de
  registro; el saludo/respuesta la evita sin estado extra.
