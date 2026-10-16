# ADR 0010 — Mapa vivo y niveles de espectáculo

- Estado: aceptada
- Fecha: 2026-10-16
- Hitos: C4 (flecha de avance y probabilidad estimada, frente caliente, niveles
  Rápido/Táctico/Cinemático, calidad adaptativa, movimiento reducido)

## Contexto

C3 dejó el combate completamente coreografiado, pero el tablero **fuera** de
combate seguía mudo: seleccionar un territorio propio y apuntar un vecino
enemigo no decía nada de lo que iba a pasar, y un frente muy batallado se veía
igual a uno tranquilo. El plan de combate (secciones 10 y 11) pide que el mapa
esté vivo entre turnos y que el espectáculo sea configurable y se degrade con
dignidad cuando la máquina no da.

Las piezas que ya existían: la escena de batalla y sus perfiles de tiempo
(`spectacle.ts`, ADR 0008), el material del tablero con soporte de atributos
por vértice (ADR 0007) y el motor de reglas puro (ADR 0003), del que se puede
sacar información pública sin tocar el estado.

## Decisión

### 1. La flecha de avance anticipa, no dispara

`GameScene.refreshAttackArrow` reacciona a la selección (clic) y al apuntado
(hover) de la escena. Muestra la flecha solo si se cumplen todas: el origen es
del jugador activo, le sobran ejércitos (`armies > minArmiesPerTerritory`), el
destino apuntado es de otro jugador y son vecinos. La flecha
(`heat/attackArrow.ts`) es un arco de Bézier entre los anclas: cilindro como
astil, cono como punta y una esfera pulso que viaja del origen al destino, con
blending aditivo y el color del jugador activo. Con movimiento reducido se
muestra quieta, sin pulso.

### 2. La probabilidad de conquista es información pública del motor

`estimateBattleOdds` (en `packages/rules`) resuelve la cadena de Markov exacta
de estados `(a, d)`: cada ronda reparte las pérdidas según los dados y se itera
hasta converger. Es pura, determinista y no toca el estado. Está validada
contra un muestreo de Monte Carlo con semilla fija y contra un resolvedor
independiente por iteración de Bellman.

La escena publica `AttackOddsInfo` (par + probabilidad) y la página principal
abre la caja «ATAQUE» con «Probabilidad de conquista: X%». **No decide nada**:
el motor resuelve las rondas de verdad y esto solo anticipa el resultado
probable (plan, sección 10).

### 3. El frente caliente se deriva del log, no vive en el estado

`battleHeat` (`heat/heatModel.ts`) es un modelo puro que aplica el registro de
eventos en orden:

- `BATTLE_ROUND_RESOLVED`: +0.08 al origen y +0.13 al destino atacado (el
  campo de batalla se calienta más).
- `TERRITORY_CONQUERED`: +0.35, un pico (ahí cambió el dueño).
- `TURN_CHANGED`: todo el calor se multiplica por 0.5 (decaimiento por turno;
  lo que baja de 0.001 se olvida).

El calor queda acotado a [0, 1] y **no es estado de reglas**: se puede
recalcular desde cero aplicando el log completo, así que un cliente que
reconecta a mitad de una batalla reproduce exactamente el mismo calor. Lo
consume el shader del tablero (`mapMaterials`): oscurece los territorios y
prende brasas en sus bordes.

### 4. Tres niveles de espectáculo, uno por defecto más rápido

Los perfiles de `spectacle.ts` (ya usados por la coreografía desde C2) pasan a
ser elegibles: **Rápido** (ronda 0.7 s, sin movimiento de cámara ni despliegue,
partículas al 35%), **Táctico** (2.4 s, cámara y despliegue, partículas al 100%)
y **Cinemático** (3.4 s, cámara a 150 y más horizontal, partículas al 190%,
conquista en cámara lenta a 0.42, post-proceso). Reglas de selección:

- `resolveSpectacle`: `prefers-reduced-motion` fuerza Rápido.
- `stepDown`: los ataques de otros jugadores y de los bots se reproducen un
  nivel más rápido por defecto (espectador).
- `CombatDirector` comprime a Rápido cualquier tramo con más de 5 rondas
  pendientes.

El nivel es un ajuste del jugador (persistente cuando exista la configuración);
en C4 se elige desde el sandbox de desarrollo.

### 5. La calidad se adapta al FPS con histéresis

`choreography/quality.ts` es un controlador puro: ventana móvil de 45 deltas de
frame, FPS promedio, degrada por debajo de 40, recupera por encima de 52, y
ambos cambios necesitan 2 ventanas consecutivas en la misma condición (la banda
entre 40 y 52 es la histéresis que evita la oscilación). Degradado, el tope de
unidades por bando se parte a la mitad (mínimo 2) y las partículas bajan al
35%.

El muestreo ocurre solo mientras hay batalla abierta (`recordFrame` en
`CombatDirector.update`), y se reinicia al abrir una nueva. El cambio es
**solo visual**: no toca reglas ni eventos. El casillero del sandbox fuerza la
calidad reducida (4 unidades, partículas al 30%) y suspende el modo automático,
para poder verla sin esperar a que la máquina se cuelgue.

## Consecuencias

- **Positivas.** El tablero comunica entre turnos: flecha, probabilidad y calor
  dicen qué se está jugando sin abrir el combate. El espectáculo es
  configurable y el juego degrada con dignidad en máquinas lentas. Los tres
  modelos nuevos (calor, odds, calidad) son puros y deterministas: 124 tests
  cubren la cadena completa.
- **El calor no puede desincronizarse** con las reglas porque no es estado: se
  recalcula del log.
- **La probabilidad es pública por diseño** (plan, sección 10): anticipa el
  resultado probable de un ataque antes de confirmarlo.
- **Negativas / costos.** La misma batalla se ve distinta según la máquina (la
  calidad adaptativa es justamente eso). La caja de probabilidad agrega una
  lectura más al HUD del jugador activo.
- **Trampas conocidas de captura.** Cada `page.screenshot()` consume ~1.2 s de
  reloj con WebGL en software y el cuadro capturado corresponde al estado ~1.2 s
  **después** del momento pedido: los momentos de `scripts/capture-c4.ts` se
  eligen contra el reloj real para que el cuadro real caiga en la ventana de
  coreografía buscada. La etiqueta «Ataque» del HUD lleva `text-transform:
  uppercase`, así que `innerText` devuelve «ATAQUE» (las aserciones del script
  son insensibles a mayúsculas).
