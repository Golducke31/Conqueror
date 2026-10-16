# ADR 0008 — Coreografía completa de la ronda de combate

- Estado: aceptada
- Fecha: 2026-10-16
- Hitos: C2 (dados, duelos, bajas y reacomodo con continuidad)

## Contexto

En C1 la escena de batalla solo abría el campo frente a la línea y desplegaba
las escuadras. La ronda en sí era un `gsap.timeline().to({}, { duration: profile.roundSeconds })`:
un placeholder que esperaba el tiempo sin mostrar nada. Con eso solo se podía
verificar que la cámara encuadraba y que las tropas marchaban.

El plan de combate (sección 16) pide que la ronda se pueda testear sin WebGL
porque las decisiones (quién gana, qué dado sale, quién cae) ya vienen del
motor. Y pide ver, en orden:

1. los dados ruedan y se asientan en la cara que mandó el motor
2. los duelos se escalonan por par, con la acción del tipo de unidad ganadora
3. las bajas caen en la primera fila de su bando
4. las escuadras se reacomodan al cerrar la ronda

Además, entre rondas del mismo par atacante→objetivo las escuadras no pueden
"resucitar": la continuidad de quién sigue vivo y quién no la decide el plan
y la escena la respeta.

## Decisión

### 1. Plan de ronda puro

`apps/client/src/render/combat/choreography/round.ts` expone `planRound(input)`,
que toma un `BattleRoundResolved` ya resuelto y devuelve un `RoundPlan` con los
tiempos (`diceRoll`, `diceLand`, `duels[]`, `regroup`) y qué unidad actúa /
cae en cada duelo. Es una función pura: no toca Three.js, ni el DOM, ni el
azar. Eso permite cubrirla con 18 tests Vitest sin levantar un navegador.

Las bajas se asignan a la primera fila libre de su bando, de frente hacia atrás.
Si en una misma ronda caen dos unidades del mismo bando, se asignan índices
distintos (`survivorIndex` / `firstFreeIndex` sobre un `Set<number>`) en lugar
de matar dos veces a la primera unidad. Esto es lo que la escena traduce
directamente al `RenderUnit` que cae.

### 2. La escena ejecuta, no decide

`BattleScene.playRound(event, profile)` consume ese plan y arma un único
`gsap.timeline` con cuatro bloques:

- **Dados.** Un `DiceLayer` (un `InstancedMesh` de planos con un atlas de pips
  generado en `CanvasTexture`) muestra los dados del atacante y del defensor.
  Durante `diceRoll` las caras ciclan (cosmético, determinista: `floor(t·36)
  mod 6`); durante `diceLand` se asientan en `event.attackerDice[i]` /
  `event.defenderDice[i]`. El dado que gana su par recibe un `highlight` que el
  shader interpreta como un brillo extra.
- **Duelos.** Por cada `DuelPlan` la escena lanza un `timeline.to(actor,
  { lunge: 1, yoyo: true })` para la embestida y, en `duel.start + duel.duration`,
  un `timeline.call` que emite partículas (`ParticlePool` con `flash`/`smoke`
  para cañón, `dust` para carga, `spark`/`dust` para descarga) y sacude la
  cámara con `options.scene.rig.shake(2.2, 0.16)`. Inmediatamente después se
  anima la caída (`fallen: 1`) de la unidad marcada como baja, que en
  `applyInstances` se traduce a `tilt = π/2` y un pequeño levantamiento en Y
  para que la unidad descanse sobre el suelo en vez de hundirse en el terreno.
- **Reacomodo.** `regroup` deja a los supervivientes en su formación final. Los
  dados se desvanecen con un `setOpacity` tween.
- **Marcado de bajas.** Se hace sincrónicamente al construir el plan, no al
  terminar la animación. Así, aunque el usuario pulse `skip` a mitad de una
  ronda, la siguiente `playRound` ve un roster consistente.

### 3. Continuidad entre rondas

`BattleScene` mantiene internamente los `RenderUnit` vivos de cada bando y
expone `attackerRoster()` / `defenderRoster()`. `CombatDirector` los usa para
construir cada `planRound` (no recomputa `composeSquad` con los ejércitos
totales: eso perdería identidad). La consecuencia: dos rondas seguidas
contra el mismo objetivo arrancan con las escuadras ya mermadas, no con
plantillas frescas.

### 4. `CombatDirector` solo orquesta

El director arma una `gsap.timeline` combinada: en la posición 0 mete el
`open()` si el par cambió, y en `'>'` encadena el `playRound(event, profile)`.
El `onComplete` aplica el resultado al estado (`onRoundApplied`) y apaga el
modo continuo. `update(delta)` llama además a `battle.tick(delta)` para que
las partículas que sigan vivas terminen su vida.

## Trade-offs

- **Coste de un `applyInstances` por tween.** Cada `lunge`, cada `fallen`,
  cada `diceOpacity` redibuja el `UnitBatch` o el `DiceLayer`. Para una
  ronda de hasta 3 duelos más los dados sigue siendo barato (un `setInstances`
  sobre 64 instancias y un `update` sobre 6 dados), pero si se subiera a
  docenas de duelos habría que moverlo a un `InstancedBufferAttribute` con
  `setX` por unidad.
- **Las partículas viven en `object pooling` y se actualizan en `tick`.**
  Eso obliga a que `CombatDirector.update` llame a `battle.tick(delta)` cada
  frame, aunque no haya ronda en curso. A cambio no hay `new` ni `dispose` en
  mitad de una batalla, que es lo que el plan prohíbe.
- **Las bajas se marcan al construir el plan, no al animarse.** Es un trade-off
  explícito: la animación puede no llegar a verse si el usuario salta, pero la
  consistencia del estado no depende de que la timeline termine.

## Verificación

- `pnpm test` — 58 tests pasan (18 de coreografía + 26 de `composeSquad` + 14
  del tablero clásico).
- `pnpm --filter @conqueror/client typecheck` y `pnpm --filter @conqueror/rules
  typecheck` — limpios.
- `pnpm format:check` y `pnpm lint` — limpios.
- `pnpm build && pnpm smoke` — el sandbox de combate abre, tira una ronda
  contra el frente marítimo Alaska↔Kamchatka y el HUD reporta las bajas
  correctas (`Alaska 12 · Kamchatka 6` tras `[6 5 2] vs [5 2]`).
- `pnpm exec tsx scripts/capture-combat-round.ts` — capturas
  `test-results/c2-despliegue.png`, `c2-duelos.png` y `c2-bajas.png` con la
  escuadra desplegada, los dados en el campo y el resultado aplicado.
