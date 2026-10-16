# ADR 0002 — Nombre del proyecto y propiedad intelectual

- Estado: aceptada
- Fecha: 2026-10-16
- Hito: 0

## Contexto

El documento de trabajo original titulaba el proyecto con el nombre del juego de
mesa comercial que sirve de referencia mecanica. Ese nombre es una **marca
registrada** y su tablero y sus textos son obra protegida. Usarlo en el nombre
del paquete, en la UI o en la documentacion expone al proyecto a un reclamo y,
ademas, hace imposible publicarlo.

La mecanica de juego (dados, conquista por continentes, canjes de tarjetas) es un
**sistema**, no una forma de expresion, y no esta protegida como tal. Lo que si
esta protegido es la marca, los nombres comerciales y el material grafico y
textual.

## Decision

1. El proyecto se llama **Conqueror**. Se usa en el nombre de los paquetes
   (`@conqueror/*`), en la UI y en la documentacion.
2. **Prohibido** usar la marca del juego de referencia, su subtitulo o su
   editorial en codigo, UI, textos o documentacion. Antes de cerrar cada hito se
   corre un `grep` de verificacion sobre todo el repo.
3. Los nombres de los territorios son **datos geograficos de dominio publico**
   (nombres de paises y regiones reales). Se mantienen porque son necesarios
   para que el mapa sea reconocible.
4. Todo el texto de la UI es propio y se redacta en español rioplatense, con
   palabras propias. Sin emojis: la iconografia es geometrica propia.
5. La paleta y los colores de jugador son de definicion propia y viven en
   `apps/client/src/styles/main.css`.
6. Los datos del mapa vienen de **Natural Earth**, que es de dominio publico
   (ver `docs/CREDITS.md`).

## Consecuencias

- Positivas: el proyecto se puede publicar sin riesgo de marca. Los nombres de
  los territorios siguen siendo reconocibles porque son geografia real.
- Negativas: los textos de la UI no pueden copiar descripciones del reglamento
  comercial. Cada regla se redacta de nuevo y se documenta en `RulesConfig`.
- Verificacion obligatoria antes de cada entrega:
  `grep -rniE "marca1|marca2|editorial" --include=*.ts --include=*.json --include=*.md --include=*.html .`
  (con los terminos reales cargados en el script de verificacion local, que no
  se versiona para no dejar la marca escrita en el repo).
