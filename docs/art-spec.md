# Especificación de arte — unidades y tablero

Documento para quien modele o consiga los assets finales (Hito C6). Hasta
entonces el juego usa **primitivas** (ver "Fase placeholder").

## Unidades

| Unidad     | Equivale a       | Triángulos máx. | Aspecto                                              |
| ---------- | ---------------- | --------------- | ---------------------------------------------------- |
| Infantería | 1 ejército       | 500             | Soldado con mosquete y casaca, en formación de línea |
| Caballería | 5 ejércitos      | 500             | Jinete con sable o lanza, montado                    |
| Artillería | 10 ejércitos     | 800             | Cañón de campaña con dos artilleros                  |
| Navío      | cruces marítimos | 1200            | Navío de vela con estandarte del jugador             |

**Época:** guerras del siglo XIX, estilo napoleónico, low-poly estilizado.
**Prohibido:** banderas, escudos o símbolos de países o ideologías reales. Cada
jugador tiene color propio y un emblema genérico (estrella, león, águila).

## Formato y convenciones

- **glTF 2.0** con compresión **Meshopt** (o Draco) y texturas **KTX2**.
- **Origen en los pies**, eje **Y hacia arriba**, mirando hacia **+Z**.
- Escala unitaria coherente entre tipos: la infantería mide 1.0 de alto y el
  resto se expresa como múltiplo.
- Un **atlas de texturas compartido** por todos los tipos, para minimizar draw
  calls.

## Máscara de uniforme (teñido por jugador)

El color del jugador se aplica **solo** sobre una máscara de uniforme. En el
modelo final eso es un **vertex color** o un **canal de textura**:

- el canal de máscara vale 1 en la casaca, el pantalón y las piezas de tela del
  jugador;
- vale 0 en cuero, metal, madera, piel y pelo.

El resto del modelo va en tonos tierra y neutros, así el color del jugador se lee
a distancia. Además del color, cada jugador lleva un **emblema distinto** para
accesibilidad de daltonismo.

En las primitivas actuales esa máscara es el atributo `aMask` de cada vértice.

## Tablero

- Geometría: Natural Earth 50m, agrupada en 50 territorios (ver ADR 0004).
- Proyección: `geoNaturalEarth1` sobre el plano XZ, 1000 unidades de ancho.
- Relieve: 9 unidades de extrusión.
- Colores de continente (vista previa y territorios sin dueño): ver
  `apps/client/src/app/palette.ts`.

## Fase placeholder

Mientras no haya modelos reales, `apps/client/src/render/tokens/unitMeshes.ts`
arma cada tipo con primitivas y lo que importa es que **las siluetas se
distingan**:

- Infantería: cápsula (cuerpo) + prisma delgado (mosquete).
- Caballería: prisma alargado (caballo) + cápsula encima (jinete).
- Artillería: cilindro sobre dos discos (ruedas) + curena.

## Presupuestos (Hito C6)

- ≤ 16 unidades visibles por bando (8 en móvil).
- ≤ 30 draw calls extra durante una batalla.
- 60 fps en un móvil de gama media.
- Los modelos y texturas se cargan **en diferido** al iniciar la partida; si
  fallan, el juego sigue con las primitivas como respaldo.
