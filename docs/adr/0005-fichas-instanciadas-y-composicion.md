# ADR 0005 — Fichas instanciadas y composición de escuadras

- Estado: aceptada
- Fecha: 2026-10-16
- Hitos: 2 (mapa interactivo), C1 (despliegue)

## Contexto

Dos planes piden cosas distintas sobre las fichas:

- El plan maestro (Hito 2) pide "fichas instanciadas con datos de prueba" y
  prohibe una malla por ficha.
- El plan de combate (sección 4) dice que 1 ejército es infantería, 5 caballería
  y 10 artillería, y que las fichas del mapa son esas mismas unidades en reposo.

Si cada pantalla resolviera la representación por su cuenta, el mapa y la
batalla mostrarían cosas distintas para el mismo ejército.

## Decisión

1. **`composeSquad` es la única fuente de verdad** de la representación visual de
   una cantidad de ejércitos. Vive en `packages/rules` como función **pura y
   determinista**: no toca estado, no usa azar y no depende del render. La usan
   el mapa y la batalla.
2. **Un solo mecanismo de instancing**, `UnitBatch`: un `InstancedMesh` por tipo
   de unidad (tres en total), reutilizado por la capa de fichas del mapa y por la
   escena de batalla. Nunca una malla ni un `SkinnedMesh` por unidad.
3. **El tope de unidades depende de la pantalla.** En batalla son 16 en
   escritorio y 8 en móvil (lo que pide el plan). En el **mapa** se usa un tope
   más chico: **5 en escritorio y 3 en móvil**.
4. El número exacto de ejércitos se muestra siempre al lado del bloque de
   unidades, con una etiqueta de dígitos instanciada.
5. Cuando `k > 1`, la etiqueta del bloque lo indica (`×k`), porque cada unidad
   visual pasa a representar `k` ejércitos.

## Consecuencias

- Positivas: las 50 fichas del mapa cuestan **tres draw calls**. El mapa y la
  batalla no pueden divergir porque comparten la función y el instancing. Los
  invariantes de `composeSquad` (`k >= 1`, no superar el tope, representar al
  menos los ejércitos pedidos con excedente menor que `k`) están cubiertos con
  tests de tabla y property tests.
- Negativa asumida: en el mapa el conteo visual **no** coincide con la cantidad
  de ejércitos cuando el tope recorta (por ejemplo 23 ejércitos se ven como
  5 unidades). Se compensa con el número al lado y con la etiqueta `×k`. La
  alternativa —16 unidades por ficha en un mapa de 50 territorios— vuelve el
  tablero ilegible.
- El tope del mapa es configurable (`SquadLayerOptions.maxUnits`), así que si la
  revisión visual dice otra cosa se cambia en un solo lugar.
