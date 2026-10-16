# ADR 0006 — El combate visual no decide nada

- Estado: aceptada
- Fecha: 2026-10-16
- Hitos: C0, C1 (contrato), C2–C3 (coreografía)

## Contexto

El combate es lo más vistoso del juego y también lo más fácil de arruinar: basta
con que la animación "decida" algo —una baja, un dado, un movimiento— para que la
partida se desincronice del motor o del servidor. En modo online esto es
directamente un bug de integridad: el servidor resuelve y el cliente no puede
opinar.

## Decisión

1. **La presentación nunca decide.** El único insumo del combate visual es el
   evento `BATTLE_ROUND_RESOLVED` (`packages/rules`), que ya trae dados,
   comparaciones, bajas y ejércitos resultantes. El cliente no tira dados, no
   aplica física y no calcula bajas.
2. **Nada de física para decidir bajas.** La física, si aparece, es decorativa.
3. **El servidor nunca espera a las animaciones.** El estado de las reglas se
   actualiza cuando corresponde; la animación lo cuenta después.
4. **Siempre saltable.** Clic, Espacio o Esc cortan la animación en curso,
   aplican de inmediato las rondas pendientes y dejan el estado visual idéntico
   al de las reglas. `skip()` es idempotente.
5. **Cola de eventos.** El `CombatDirector` reproduce los eventos en orden. Si se
   acumulan más de 5 rondas (turnos rápidos de bots), ese tramo se comprime al
   nivel "Rápido".
6. **Online:** cada cliente reproduce localmente la misma lista de eventos. Quien
   entra o reconecta en medio de una batalla no ve repetición: ve el estado final.
7. **Los ataques de otros jugadores y de los bots** se reproducen un nivel más
   rápido (`stepDown`). `prefers-reduced-motion` fuerza "Rápido" y apaga el
   sacudón de cámara.

## Consecuencias

- Positivas: la animación es una función pura de la lista de eventos, así que se
  puede testear sin WebGL (snapshot de los pasos de timeline, como pide el plan).
  Saltar en cualquier punto no puede desincronizar nada. El modo online no
  necesita protocolo extra para el combate.
- Negativas: la coreografía tiene que leer el resultado ya resuelto, así que
  algunos efectos "naturales" (que la unidad que gana sea la que se ve ganar) se
  resuelven por ponderación sobre la composición de la escuadra, no por
  simulación. Es una decisión de diseño, no una limitación técnica.
- El HUD del atacante bloquea un ataque nuevo mientras el director está ocupado
  (`isBusy()`), para que no se encolen rondas sin control.
