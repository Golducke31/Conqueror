# ADR 0015: Landing — presentación con scroll animado

- Estado: aceptada
- Fecha: 2026-10-17
- Hito: 5 (landing / lobby)

## Contexto

Hasta el Hito 4 la aplicación arrancaba directamente en la pantalla de
configuración de partida: quien abría el juego por primera vez se encontraba con
un formulario sin saber qué era Conqueror. Faltaba la puerta de entrada.

El plan pedía una landing con scroll suave (Lenis), animaciones atadas al scroll
(ScrollTrigger), titulares partidos en letras (SplitText) y una revisión de
accesibilidad. `lenis` ya estaba en `package.json` desde el Hito 0 sin usarse.

Las restricciones que condicionan la decisión:

- El juego tiene que seguir arrancando rápido y por URL directa (`?auto=1` la usan
  los smokes y las pruebas manuales).
- Ningún texto de UI hardcodeado: todo por `i18n`.
- La paleta es fija (lana / hilo / qolli / grana / algodón).
- `prefers-reduced-motion` no puede ser un detalle: la landing es lo primero que
  ve alguien con esa preferencia.

## Decisión

**1. La landing entra por import dinámico y es un chunk aparte.** `main.ts` hace
`await import('./ui/landing.js')` solo cuando no hay `?jugar`, `?auto` ni
`?explorar`. Resultado: ~27 kB gzip de JS y ~2 kB de CSS que **no** viajan al
jugador que entra directo a una partida. El CSS también se importa desde el
módulo, así Vite lo emite en el mismo chunk.

**2. Nada de WebGL en la landing.** El tablero 3D es lo más caro del cliente
(Three.js, modelos, texturas). La landing usa CSS y DOM: carga instantánea, sin
contexto gráfico que crear y destruir antes de jugar. Los dados son cubos 3D de
CSS con `transform-style: preserve-3d`, que dan el guiño sin coste.

**3. Un solo loop para Lenis y ScrollTrigger.** `gsap.ticker` maneja el `raf` de
Lenis y Lenis avisa a `ScrollTrigger.update` en cada scroll. Dos loops separados
producen desfases de un frame que se ven como temblor en las animaciones atadas
al scroll.

**4. SplitText con `aria: 'auto'`.** El titular se parte en letras para animarlo,
pero un lector de pantalla no puede leer "C-O-N-Q-U-E-R-O-R". `aria: 'auto'`
deja el texto original accesible y oculta la copia partida.

**5. Con movimiento reducido no se inicializa nada.** No es "animación a 0.001 ms"
(eso ya lo hace el CSS global): directamente no se crean Lenis, ScrollTrigger ni
SplitText, y ninguna animación de entrada deja contenido en `opacity: 0`. Si una
animación no corre, el contenido tiene que estar visible igual.

**6. La navegación no recarga.** “Jugar” desmonta la landing, hace `pushState` a
`?jugar=1` y monta la configuración. “Atrás” recarga (una vez) para volver a la
landing: reconstruir el estado animado de la landing en un `popstate` no vale la
complejidad para una pantalla que se regenera sola.

## Consecuencias

- `/` deja de ser la configuración: los smokes y los enlaces directos usan
  `?jugar=1`. `smoke-client` verifica que la landing tenga un solo `h1`, que no
  haya saltos de nivel de encabezado, que todo control tenga nombre accesible y
  que “Jugar” llegue a la configuración.
- El degradado en el titular (`background-clip: text`) **no** se puede combinar
  con SplitText: el clip se calcula sobre los glifos sin transformar y las letras
  animadas quedan invisibles. Por eso el titular va en color sólido con
  resplandor.
- La landing no tiene imágenes: si en el futuro se agrega arte, conviene un
  `<picture>` con `loading="lazy"` antes que meter el tablero 3D de fondo.
