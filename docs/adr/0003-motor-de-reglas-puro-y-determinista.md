# ADR 0003 — Motor de reglas puro, determinista y transportes

- Estado: aceptada
- Fecha: 2026-10-16
- Hito: 0 (contrato), Hito 3 (implementacion)

## Contexto

El juego tiene que funcionar en dos modos con las mismas reglas:

- **Local (hot-seat):** 2 a 6 jugadores en el mismo dispositivo.
- **Online:** servidor autoritativo, varios navegadores.

Si cada modo implementa las reglas por su cuenta, tarde o temprano divergen y el
online se vuelve injugable. Ademas, para depurar una partida hay que poder
reproducirla exactamente.

## Decision

1. `packages/rules` expone una funcion **pura y determinista**:

   ```ts
   apply(state, command, playerId, { rng, config }): Result<{ state, events }, RuleError>
   ```

   - No muta el estado de entrada.
   - El RNG se **inyecta** y es serializable (`snapshot()`), para poder sembrar
     partidas y reproducirlas.
   - Devuelve **eventos** (`ARMIES_PLACED`, `DICE_ROLLED`, `TERRITORY_CONQUERED`,
     `CARD_DRAWN`, `PLAYER_ELIMINATED`, `PHASE_CHANGED`, `GAME_WON`...) que la UI
     usa para animar. El estado ya viene actualizado: la animacion va desacoplada
     y **nunca** bloquea la logica.

2. Tambien expone `getLegalCommands(state, playerId)`, que usan la UI para
   resaltar opciones y los bots para decidir.
3. **Ninguna regla hardcodeada.** Todo valor ajustable vive en `RulesConfig`
   (`packages/shared`). Los valores dudosos van marcados con `// TODO-VERIFY`
   hasta confirmarlos.
4. El cliente habla contra una interfaz unica `GameTransport`
   (`apps/client/src/net/transport.ts`) con dos implementaciones:
   `LocalTransport` (corre `rules` en el navegador) y `ColyseusTransport`
   (habla con el servidor). La UI no sabe cual esta activo.
5. **En online el cliente no genera aleatoriedad.** Manda comandos; el servidor
   valida con zod, aplica `apply()` con su propio RNG y difunde estado y eventos.
6. **Identificadores como alias de `string`, no tipos con marca.** El estado
   viaja serializado (JSON, Colyseus Schema, guardado local); con tipos con marca
   cada deserializacion necesitaria un cast, lo que agrega ruido sin seguridad
   real. La integridad se valida en los bordes con zod y en los tests del motor.
7. **Informacion privada fuera del estado publico.** Las tarjetas y la mision de
   cada jugador no van en el estado sincronizado; se mandan por mensaje privado.

## Consecuencias

- Positivas: los dos modos comparten el 100 % de las reglas. Una partida se
  reproduce con `(semilla, lista de comandos)`, lo que hace el reporte de bugs
  trivial. Los tests del motor no necesitan navegador.
- Negativas: el estado tiene que ser serializable y barato de copiar en cada
  comando. Si el Hito 3 mide que la copia es un cuello de botella, se evalua
  pasar a copia estructural (persistent data structures) sin cambiar el contrato.
- Riesgo asumido: sin tipos con marca, mezclar un `PlayerId` con un
  `TerritoryId` compila. Se mitiga con nombres de campo explicitos y tests.
