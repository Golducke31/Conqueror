# ADR 0007 — Geometría del tablero en el cliente

- Estado: aceptada
- Fecha: 2026-10-16
- Hitos: 2 (mapa interactivo), C1 (frente y despliegue)

## Contexto

El tablero son 50 territorios con 279 polígonos y unos 40.000 triángulos. La
forma ingenua de armarlo —una malla por territorio— son 50 draw calls solo para
el mapa, más las que agregue el combate. El presupuesto del plan de combate es
≤ 30 draw calls extra durante una batalla, y el plan maestro pide 60 fps en un
móvil de gama media.

Además hay que resolver dos cosas con precisión: el picking (qué territorio hay
bajo el puntero) y el resaltado de hover/selección.

## Decisión

1. **Una sola malla fusionada** para todo el mundo, con dos atributos extra por
   vértice:
   - `color`: color del dueño (o el neutral), que se reescribe al cambiar el estado
   - `aTerritory`: índice de territorio
2. **Picking por `faceIndex`.** Como cada cara conoce su territorio, una tabla
   plana `faceTerritory: Int32Array` resuelve el territorio exacto sin render de
   color-ID offscreen. El raycast solo corre al mover el puntero, nunca por frame.
3. **Resaltado con una segunda malla que COMPARTE la geometría**, con un shader
   que descarta lo que no coincide con `uHover` / `uSelected`. Sin geometría
   duplicada y sin materiales nuevos.
4. **Fronteras con un único `LineSegments`** (`topojson.mesh`), levantado apenas
   por encima de la cara superior del relieve. A la altura de la base lo taparía
   la propia extrusión.
5. **Rutas marítimas interpoladas en el plano proyectado, no en la esfera.** Un
   círculo máximo entre Chile y Australia se va por debajo del continente
   antártico y sale del tablero; el tablero clásico las dibuja como rectas.
6. **Números con un atlas de dígitos y un `InstancedMesh`** (un carácter por
   instancia): un `Text` por etiqueta serían 50 draw calls. El atlas se dibuja
   con relleno blanco y contorno oscuro, así el blanco se tiñe con el color del
   jugador y el contorno queda legible sobre cualquier territorio.
7. **Dibujo bajo demanda** (plan maestro, sección 8). En reposo se pide un frame
   cada 80 ms para el balanceo de las unidades, en lugar de renderizar continuo.
   Durante animaciones (cámara, batalla) se activa el modo continuo y se apaga al
   terminar.
8. **Proyección `geoNaturalEarth1`** en el plano XZ, con `-Z` al norte y el
   tablero centrado en el origen. La geometría se extruye 9 unidades para dar
   relieve; los surcos entre extrusiones vecinas funcionan como frontera visible.

## Consecuencias

- Positivas: el tablero en reposo cuesta **9 draw calls** (océano, tablero,
  resaltado, fronteras, rutas marítimas, tres tipos de unidad y números) y el
  picking es exacto y barato. Cambiar de dueño un territorio es reescribir el
  atributo `color` en un rango contiguo de vértices, sin tocar la topología.
- Negativa asumida: el relieve hace que las fronteras se vean como surcos, y las
  12 fronteras "no atacables" (`ignoredLandBorders`) todavía se ven igual que las
  normales. Queda pendiente distinguirlas (el Hito C4 es el lugar natural).
- La ola radial de cambio de dueño (Hito C3) se va a implementar como uniforms
  sobre el mismo material (`uOrigin`, `uProgress`, color anterior y nuevo), sin
  crear materiales nuevos.
