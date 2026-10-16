# ADR 0004 — Datos del mapa: Natural Earth 50m y matriz clasica como autoridad

- Estado: aceptada
- Fecha: 2026-10-16
- Hito: 1

## Contexto

Hay dos requisitos que tiran para lados opuestos:

1. El tablero tiene que ser **reconocible y realista**: formas y dimensiones del
   mundo real.
2. Las **reglas** dependen de un grafo de adyacencia concreto, el del tablero de
   50 territorios, que ya fue validado contra tres fuentes independientes y
   contiene rarezas reales (Chile–Australia, Egipto–Polonia, Oregón–Alaska,
   Irán–Mongolia, Gran Bretaña–Alemania, Gran Bretaña–España,
   Nueva York–Groenlandia).

Si el grafo se derivara solo de la geometria, esas aristas no existirian. Si el
grafo se escribiera a mano y la geometria aparte, nada impediria que el mapa
mostrara territorios limítrofes que el juego no deja atacar.

Ademas, jugar con los ~195 paises reales es inmanejable, y el tablero divide
algunos paises en regiones (Alaska, California, Siberia, Kamchatka, Gobi...).

## Decision

1. **Fuente de geometria: Natural Earth a escala 50m** (`admin_0_countries` +
   `admin_1_states_provinces`), de dominio publico. Se eligio 50m y no 110m
   porque las subdivisiones de primer nivel que el tablero necesita (USA, Canadá,
   Rusia, Brasil, Australia, China, India, Indonesia, Sudafrica) **solo existen a
   50m y 10m**. Los datos no se versionan: los baja `pnpm map:fetch`.
2. **Los territorios son agrupaciones de geometria real**, declaradas en
   `packages/map-data/territories.config.json`: cada territorio lista los paises
   ISO_A3 que toma enteros y, cuando el tablero parte un pais, las subdivisiones
   `admin_1` que toma.
3. **Absorcion de lo no asignado.** Los paises que no son territorio jugable se
   absorben al territorio con el que comparten mas frontera (y, si no tienen
   vecino asignado, al de centroide mas cercano). Esto evita huecos en el mapa.
   Se puede desactivar con `build.absorbUnassigned`.
4. **La matriz clasica es la autoridad del grafo.** `adjacency.json` se **deriva**
   de la geometria + los `seaLinks` de la config, y `validate-map.ts` **falla el
   build** si el resultado no es exactamente
   `packages/map-data/src/classic-board.ts`. Las diferencias inevitables se
   reconcilian en la config, de forma explicita y revisable:
   - `seaLinks`: rutas maritimas, estrechos y corredores estilizados que el
     tablero considera adyacentes aunque no compartan frontera.
   - `ignoreLandBorders`: fronteras reales que el tablero **no** considera
     adyacentes. Quedan registradas en `adjacency.json` como
     `ignoredLandBorders` para que el render pueda dibujarlas distinto (borde
     "no atacable") y el jugador no se confunda.
     Estado actual: 89 aristas = 62 fronteras terrestres + 27 enlaces, con 12
     exclusiones.
5. **TopoJSON con topologia compartida**, simplificado con `topojson-simplify`.
   La tolerancia de la config esta en **grados** y se convierte a grados² porque
   es la unidad de los pesos de `presimplify`.
6. **Saneamiento posterior a la simplificacion.** A escala mundial, simplificar
   produce dos artefactos que hay que limpiar antes de publicar la geometria:
   anillos degenerados (islas que colapsan en un punto) y **anillos con el
   sentido invertido**, que `d3-geo` interpreta como "el complemento del globo" y
   pinta el mapamundi entero. `build-map.ts` descarta los primeros y corrige los
   segundos comparando el area esferica con media esfera.
7. **Antimeridiano.** La caja envolvente se calcula en longitud **desenrollada**
   (usando la longitud media circular como referencia), asi que un territorio que
   cruza ±180 (Kamchatka con Chukotka) tiene una bbox valida aunque `maxLon`
   supere 180. Se marca con `crossesAntimeridian`.
8. **Modo plano por defecto**: `d3-geo` con `geoNaturalEarth1`. El modo globo
   queda para el Hito 8 como extra opcional.
9. Los artefactos se escriben en `packages/map-data/generated/` y se copian a
   `apps/client/public/map/` para que el cliente los cargue de forma diferida
   como assets estaticos (no entran al bundle inicial).

## Consecuencias

- Positivas: el mapa es realista y el grafo de reglas no puede divergir del
  dibujo: si alguien toca la geometria o la config y rompe la coincidencia, el
  build falla. Las rarezas del tablero quedan documentadas en un solo lugar.
- Negativas: la config tiene tres listas que hay que mantener a mano
  (`seaLinks`, `ignoreLandBorders` y la composicion de cada territorio). Se
  mitiga con `pnpm map:build --suggest`, que imprime las entradas listas para
  pegar cuando hay desajuste.
- Tamano actual: 297 KB de TopoJSON sin comprimir para los 50 territorios y 279
  poligonos, muy por debajo del presupuesto de 1 MB gzip.
- Limitacion conocida: las fronteras "no atacables" (las 12 exclusiones) se ven
  como bordes normales en el mapa. El Hito 2 tiene que dibujarlas distinto.
