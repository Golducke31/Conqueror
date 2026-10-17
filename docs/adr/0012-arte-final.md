# ADR 0012 — Arte final: modelos glTF cargados en diferido, con primitivas de respaldo

- Estado: aceptada
- Fecha: 2026-10-16
- Hito: C6 (arte final: modelos glTF reales, teñido por jugador, optimización,
  presupuestos)

## Contexto

C0–C5 dejaron el combate coreografiado, con mapa vivo y audio. Las unidades
siguen siendo **primitivas** (`tokens/unitMeshes.ts`, `units/shipMesh.ts`): lo
que el plan llama la "fase placeholder", donde importa que las siluetas se
distingan.

La sección 14 del plan es explícita: **los modelos los aporta el usuario** (los
modela o consigue un pack CC0 y registra su licencia en `docs/CREDITS.md`). La
sección 12 fija además los presupuestos: ≤ 30 draw calls extra por batalla,
≤ 16 unidades por bando (8 en móvil), 60 fps en un móvil de gama media, y la
carga de modelos **en diferido al iniciar la partida**, con las primitivas como
respaldo si algo falla.

Es la misma situación que el audio en C5 (ADR 0011): el sistema se entrega
completo y **sin contenido**, y el juego tiene que andar igual.

## Decisión

### 1. El manifiesto es la única fuente de verdad de los modelos

`apps/client/public/models/combat/manifest.json` mapea **tipo de unidad**
(`infantry`, `cavalry`, `artillery`, `ship`) a su archivo y ajustes:

- Las rutas son **relativas al manifiesto** (o sea, a `models/combat/`); la
  convención es `public/models/combat/<tipo>.glb`. La ruta del manifiesto en sí
  va **absoluta desde la raíz** (`/models/combat/manifest.json`): una ruta
  relativa se resolvería contra la página y en `/debug/models` (sin barra final)
  `document.baseURI` es `/debug/models`, así que terminaría pidiendo
  `/debug/models/...`.
- El manifiesto que se entrega **no declara ningún tipo** (y trae un
  `_comentario` con las instrucciones): el juego usa las primitivas. Un tipo
  ausente del manifiesto es válido y sigue con su primitiva mientras los demás
  usan el modelo final.
- Un manifiesto inválido se rechaza **entero** (todos con primitiva) y los
  problemas se listan en consola y en `/debug/models`. Las claves que empiezan
  con `_` se ignoran: JSON no tiene comentarios y el usuario que edita el
  archivo a mano los necesita.

### 2. Un contrato de atributos, no un formato nuevo

El material de unidades ya espera `aColor` (vec3) y `aMask` (float). Los
modelos finales se **normalizan** a ese contrato al cargarlos
(`unitGeometry.ts`, función pura):

- Color base: `COLOR_0` del glTF (que three renombra a `color`). Si falta, se
  usa el `baseColor` del manifiesto.
- Máscara de uniforme: atributo propio `_MASK` (1 = se tiñe con el color del
  jugador). Si falta, se usa el `maskValue` del manifiesto.
- Escala y `yOffset` del manifiesto; normales calculadas si el modelo no las
  trae; y los volúmenes (bounding box/sphere) recalculados, porque las
  posiciones cambiaron y el recorte por frustum de las instancias los usa.

El plan permite además que la máscara esté pintada en **un canal del atlas**. En
vez de leer píxeles (imposible con KTX2 sin decodificar y sin DOM), el shader
toma la máscara del canal declarado en `maskChannel` (`none|r|g|b|a`). Así el
mismo material sirve para las dos variantes y sigue siendo una sola pasada.

### 3. Carga diferida con `import()` dinámico y respaldo total

- `UnitModels` (`unitModels.ts`) es el contenedor: pide los modelos **una sola
  vez**, avisa a quien esté suscrito cuando llegan y no bloquea nada. La escena
  del mapa lo dispara recién cuando el tablero está armado; el sandbox lo
  comparte entre el mapa y la batalla para no pedirlo dos veces.
- El cargador de glTF entra con `await import('./gltfModels.js')`: `GLTFLoader`,
  el decodificador Meshopt y el transcoder KTX2 **no están en el paquete
  inicial** (juntos son ~45 KB gzip, más el wasm del transcoder, que solo se
  descarga si hay una textura KTX2).
- `loadUnitModels` **nunca lanza**: devuelve un reporte por tipo
  (`loaded | absent | missing | invalid | error`) con triángulos, presupuesto y
  motivo. Un tipo que falla no arrastra a los demás: cada uno se queda con su
  primitiva.
- La geometría inyectada **no la dispone el lote**: la comparten las capas
  (mapa y batalla). El lote solo dispone las primitivas que creó él.

### 4. El presupuesto se mide, no se estima

`triangleCount` es puro y se compara contra `TRIANGLE_BUDGET` por tipo (500
infantería, 500 caballería, 800 artillería, 1200 navío). Se verifica en tres
lugares:

- Un test (`combat/budget.test.ts`) que mide las primitivas contra el
  presupuesto y cuenta los draw calls de una batalla (una malla instanciada por
  tipo, nunca una por soldado).
- El reporte de carga, que marca en rojo un modelo pasado de triángulos (se
  carga igual: la decisión es del usuario, no del cargador).
- La página `/debug/models`, que muestra triángulos contra tope y el **alto
  real** de la geometría en uso, para verificar la escala unitaria.

Los 60 fps en un móvil de gama media no se pueden medir en un test: quedan a
cargo del overlay de depuración (`?debug=1`) y del ajuste adaptativo de calidad
de C4.

## Consecuencias

- Todo el arte final vive en `apps/client/src/render/tokens/models/`
  (`manifest.ts`, `unitGeometry.ts`, `modelLoader.ts`, `gltfModels.ts`,
  `unitModels.ts`) y se prueba con un cargador falso inyectado: sin red, sin
  WebGL y sin DOM.
- Las primitivas **siguen siendo el camino por defecto** y ahora respetan el
  presupuesto de triángulos: la teselación de las cápsulas bajó (la infantería
  pasó de 636 a 300 triángulos) porque el respaldo no puede ser más caro que el
  arte final.
- El material ganó atlas y canal de máscara sin costo cuando no hay textura
  (`uHasMap = 0` deja el resultado idéntico al de la fase placeholder).
- Un modelo con texturas KTX2 mal exportadas puede fallar al cargar: se reporta
  como `error` y ese tipo sigue con su primitiva. Es la degradación buscada.
