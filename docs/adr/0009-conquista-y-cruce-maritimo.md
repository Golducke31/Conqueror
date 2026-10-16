# ADR 0009 — Conquista, cruce marítimo y marcha posterior

- Estado: aceptada
- Fecha: 2026-10-16
- Hitos: C3 (conquista y mar: onda de dueño, estandarte, marcha, navíos y desembarco)

## Contexto

C2 dejó la ronda completamente coreografiada, pero la secuencia terminaba en un
`close()` sin más: el defensor quedaba en cero y el atacante "conquistaba" por
definición, sin que nada en pantalla lo contara. El plan de combate pide que una
conquista —terrestre o marítima— se vea completa y se pueda saltar, y que
después de ella los ejércitos puedan marchar al territorio recién tomado.

Las piezas que ya existían: la escena de batalla abierta sobre el frente
(ADR 0008), la malla fusionada del tablero con `aTerritory` por vértice
(ADR 0007) y el material del tablero, que acepta una onda de cambio de dueño
(`playOwnershipWave` / `finishOwnershipWave` en `GameScene`).

## Decisión

### 1. La conquista se coreografía sobre la escena abierta

`CombatDirector.playConquest` reacciona a `TERRITORY_CONQUERED` sin reabrir el
campo de batalla. Envuelve `BattleScene.playConquest` en un `gsap.timeline` con
`timeScale: profile.conquestTimeScale` (el perfil cinemático la corre a 0.42, en
cámara lenta). La secuencia de la escena es:

1. **Avance.** La escuadra atacante marcha desde la línea de frente al ancla
   del territorio conquistado.
2. **Estandarte.** Se planta en el ancla (`BannerLayer`), mirando hacia la
   cámara, con un `back.out` de escala.
3. **Onda de cambio de dueño.** Barre el territorio desde el punto del frente
   hasta cubrirlo (`coverRadiusFrom`). La onda vive en el material del tablero,
   no en una capa aparte: son los mismos vértices que cambian de color.
4. **Sostén y fundido.** Brasas alrededor del estandarte y disolución de las
   escuadras del campo (`setOpacity` → 0, luego instancias vacías).

### 2. El estado se aplica cuando termina la ONDA, no la secuencia

El director encola `onConquered(territory)` en `plan.wave.start + plan.wave.duration`
—el instante en que el barrido termina— y recién ahí la aplicación aplica el
nuevo dueño y `setGameState` reescribe los atributos por vértice con ese mismo
color. Así el tablero nunca muestra un color que las reglas no hayan decidido
todavía: durante el barrido se ve el color nuevo llegar, y al terminar el
estado ya coincide con lo que se ve.

### 3. El estandarte sobrevive al cierre

`BattleScene.close({ instant: true, keepBanner: true })` deja el grupo vivo con
solo el estandarte plantado: marca el territorio recién conquistado hasta que
el jugador haga la marcha. `close` evalúa su estado sincrónico al llamarlo, por
eso el cierre con estandarte se hace en el `onComplete` del timeline de
conquista y no se encadena con `add()`.

### 4. La marcha la dispara la aplicación, no el director

La marcha posterior a la conquista es una acción del jugador (botón en el
sandbox, flujo de turno en el juego). `BattleScene.playMarch` es la única
timeline que la escena expone para disparo externo:

- **Unidades por encima de las fichas.** Escala 2.8 contra las 1.5 de las
  fichas del tablero: a distancia de tablero (cámara a ~260 del ancla) una
  escuadra a escala de ficha es un speck camuflado entre los tokens del mismo
  color. Con 2.8 la marcha se lee como un evento.
- **Tope visual de 5.** Más de cinco unidades no se leen a esa distancia (las
  fichas del mapa usan el mismo tope); el resto de los ejércitos van en el
  estado, no en la animación.
- **Polvo en la pisada.** Una nube cada 0.18 del recorrido deja el camino a la
  vista, más el fogonazo de partida. El color de las unidades es el del dueño
  nuevo (semánticamente correcto), así que el rastro es lo que garantiza la
  lectura en los extremos.
- **Ciclo del estandarte.** Plantado en la conquista, se retira al terminar la
  marcha (o al saltar). Si la conquista se saltó y no quedó plantado, `playMarch`
  lo planta como parte de la llegada.
- **Salto.** `CombatDirector.skip` fuerza el timeline activo y llama
  `battle.close({ instant: true })`, que corre `marchTl.progress(1)`: la marcha
  en curso completa al instante y su `onComplete` aplica el movimiento de
  ejércitos. Saltar nunca deja el estado a medias.

### 5. El cruce marítimo ocurre al abrir el campo

Si el frente entre los dos territorios es un `seaLink`, `BattleScene.open`
navega los navíos de costa a costa (`ShipLayer`, `SHIP_STANDOFF`), hace una
andanada visual **sin bajas** —las decide el motor en la ronda que sigue— y
desembarca las tropas en la playa defensora. `buildSide` acepta un
`startCenter`: con él las unidades arrancan alrededor de la playa, con un poco
más de dispersión. Las rutas marítimas se interpolan en el plano proyectado
(no en círculo máximo: entre continentes el círculo máximo se va a la
Antártida).

### 6. La presentación nunca decide

Todo lo de arriba consume `BATTLE_ROUND_RESOLVED` y `TERRITORY_CONQUERED`
(resueltos por el motor) y los traduce a tiempos. La onda cambia el color del
tablero, pero el dueño lo aplica la aplicación cuando la onda termina. Ver
ADR 0006.

## Consecuencias

- **Positivas.** Una conquista se lee completa: avance, estandarte, barrido de
  color y disolución. La marcha posterior queda como acción del jugador con su
  propio espectáculo. El cruce marítimo reutiliza la misma escena: mismos
  planchas de tiempo, mismas reglas de skip.
- **El tablero y las reglas no se desincronizan visiblemente** gracias al
  `onConquered` en `waveEnd`.
- **Capturas con contraste.** La onda y el estandarte necesitan dueños de
  colores distintos (una onda azul sobre territorio azul es invisible; una
  estrella crema sobre territorio amarillo se camufla). Los pares de las
  capturas se eligen con `scripts/buscar-par-contraste.ts` y quedan anotados
  en `scripts/capture-conquest.ts`.
- **Trampas conocidas de captura.** El primer `page.screenshot()` después de un
  clic captura el lienzo ~0.6 s después de pedirlo (la GPU tarda en entrar en
  calor): para capturar la marcha a mitad de camino hay que pedir la captura
  temprano (+100 ms del clic), no al final del tramo.
- **Negativas / costos.** La marcha es la única secuencia que no pasa por la
  cola del director: el estado `marching` del sandbox bloquea nuevas acciones
  hasta que termine. El tope visual de 5 unidades en marcha implica que el
  número exacto de ejércitos movidos vive solo en el estado.
