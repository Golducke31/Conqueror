# ADR 0011 — Audio: Web Audio propio y manifiesto del usuario

- Estado: aceptada
- Fecha: 2026-10-16
- Hito: C5 (audio: `AudioManager`, manifiesto, señales en la coreografía,
  `/debug/sounds`, plantilla de `CREDITS.md`)

## Contexto

C4 dejó el combate completamente coreografiado y mudo. El plan de combate
(sección 13) pide el sistema de sonido completo, con una restricción fuerte:
**no se generan ni se descargan sonidos**. Los archivos los aporta el usuario
después, y el juego tiene que correr **en silencio total** mientras no
existan, sin un solo error.

La pregunta que el plan manda decidir acá: `AudioManager` sobre Web Audio
directo o con una librería (Howler.js).

## Decisión

### 1. Web Audio propio, sin dependencias

Se implementa sobre la Web Audio API nativa. Las razones:

- Lo que se necesita —buses de mezcla, tope de voces por slot, cooldown,
  variación de tono, paneo estéreo, loops de ambiente con crossfade— son
  operaciones básicas de Web Audio (`GainNode`, `StereoPannerNode`,
  `AudioBufferSourceNode`), no extensiones.
- El proyecto ya eligió depender lo menos posible (i18n propio, ADR del Hito
  0). Howler.js agregaría peso al bundle por funciones que no se usan
  (sprites, desbloqueos específicos por plataforma).
- La política de autoplay se resuelve con `context.resume()` en el primer
  gesto del usuario, sin capas intermedias.

### 2. El manifiesto es la única fuente de verdad de los sonidos

`apps/client/public/audio/combat/manifest.json` mapea cada _slot_
(`grupo.nombre`) a sus archivos y ajustes. Convenciones:

- Las rutas de `files` son **relativas al manifiesto** (o sea, a
  `audio/combat/`). La convención de nombres del plan es
  `public/audio/combat/<slot_con_guion_bajo>_<n>.mp3`.
- El manifiesto que se entrega trae **todos los slots con `files: []`**: el
  juego arranca en silencio y el usuario va agregando archivos y editando el
  JSON.
- Un slot sin archivos nunca produce error: la señal se descarta con un
  `console.debug` si `?debug=1`.

### 3. Silencio total como estado de primera clase

- Manifiesto ausente (404), archivo ausente, o contexto de audio bloqueado:
  el juego sigue. No hay try/catch que explote en la coreografía.
- `validateManifest` es pura y devuelve `Result`: un manifiesto inválido se
  ignora completo (silencio) y los problemas se listan en consola y en la
  página `/debug/sounds`.

### 4. La coreografía emite, el manager reproduce

`BattleScene` recibe un receptor opcional (`AudioSink`) y emite señales desde
los callbacks del timeline GSAP, en el mismo instante en que ocurre el
evento visual (dados, duelos por tipo, marchas, desembarco, estandarte,
conquista). **La presentación no decide nada**: el sonido es consecuencia del
mismo evento que mueve las fichas, y saltar la secuencia salta también los
sonidos pendientes.

El ambiente de batalla (`battle.ambience.low/mid/high`) lo maneja la
aplicación, no la escena: cruza las capas según `battleHeat` (ADR 0010), que
es el mismo modelo puro que alimenta el shader del tablero.

### 5. Paneo por proyector inyectado

El `AudioManager` no conoce Three.js. Recibe una función inyectada
`panOf(mundo) → -1..1`; la escena la arma proyectando la posición del mundo
con la cámara del renderer (`RendererHandle.camera`). Así el paneo se puede
testear sin WebGL y el manager queda reutilizable.

### 6. Volúmenes persistentes por bus

Dos buses (`effects` y `ambience`) con volumen y mute que se guardan en
`localStorage` bajo `conqueror:audio:*`. El ajuste fino del jugador llega con
su pantalla de configuración; C5 deja la persistencia y los controles en la
página `/debug/sounds`.

## Consecuencias

- Todo el audio vive en `apps/client/src/render/combat/audio/`
  (`manifest.ts`, `audioManager.ts`) y se prueba con un `AudioContext` falso
  inyectado: archivo ausente, tope de voces, cooldown, paneo y crossfade de
  ambiente se verifican sin navegador.
- El costo de no usar Howler es implementar el desbloqueo manual; el
  beneficio es un bundle sin dependencias de audio y control total sobre el
  descarte de señales.
- Si en el futuro hicieran falta sprites de audio o formatos exóticos, se
  reevalúa la decisión (no se descarta Howler, se difiere).
