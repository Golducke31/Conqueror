# ADR 0014: Interacción del mapa — clic como intención

- Estado: aceptada
- Fecha: 2026-10-17
- Hito: 4 (modo local jugable)

## Contexto

El tablero ya se podía tocar, pero el clic **no hacía nada**: la escena movía su
propia selección interna (y por eso dibujaba la flecha de ataque), mientras que
la partida se jugaba únicamente desde los chips del HUD. `matchApp` nunca
conectaba `onSelect` con el HUD ni con el transporte, así que no había forma de
atacar desde el mapa.

Además, la interacción tenía tres problemas de fondo:

- **Un clic era solo "seleccionar"**: no existía la noción de origen y destino,
  así que hacer clic en el enemigo reemplazaba la selección en vez de atacar.
- **La flecha era efímera y mentirosa**: solo se dibujaba mientras el puntero
  estaba encima, y ocultaba los objetivos neutrales aunque el motor permite
  atacarlos (`ownerOf(state, to) === playerId` es la única condición).
- **Ningún territorio tenía nombre en el mapa**: había que adivinar qué país se
  estaba tocando.

## Decisión

**1. La intención se resuelve en una función pura, fuera de la escena.** El
clic se traduce a una intención en `scenes/game/selectionModel.ts`
(`resolverClic`), que recibe el estado **público** del motor y devuelve
`inspect | select-origin | select-target | attack | clear | invalid(motivo)`.
Motivos:

- la escena queda como pura presentación (dibuja lo que le dicen, no decide);
- el clic del mapa y los botones del HUD usan el mismo estado, así que no
  pueden divergir;
- se testea el flujo completo de clics sin canvas ni WebGL.

**2. La escena solo avisa y dibuja.** `GameScene` emite `onPick(territorio)` y
recibe `setSelection({ origin, target })`. La flecha y el resaltado se derivan
de esa selección: el destino elegido manda sobre el territorio apuntado, así
que la línea **queda fija** sobre el frente en vez de desaparecer al mover el
mouse.

**3. Tres estados visuales distintos.** El material de resaltado pasó de dos
uniformes (hover/selección) a tres (hover, origen, destino) con colores y
opacidades propias y un pulso suave: el jugador tiene que poder distinguir "lo
que estoy mirando" de "lo que voy a atacar".

**4. Los nombres van en el mapa, con descarte por colisión.** Una capa nueva
(`render/tokens/TerritoryLabelLayer`) hornea todos los nombres en un atlas y
los dibuja con **un solo `InstancedMesh`** (1 draw call en vez de 50). El
tamaño es constante en pantalla (`uZoom = distancia / referencia`) y cada
repintado descarta los nombres que se pisarían en pantalla: se prioriza lo
resaltado y después el territorio más grande. Sin ese descarte, Europa y el
Caribe quedaban ilegibles.

**5. Un clic que no se puede ejecutar explica el motivo.** `invalid` viaja al
HUD como aviso efímero ("Brasil no es vecino de Argentina") en lugar de no hacer
nada, que era justamente la sensación de bug.

**6. El encuadre depende del lienzo.** `boardFitDistance` calcula la distancia
necesaria a partir del tamaño del tablero, el campo de visión y la relación de
aspecto. Una distancia fija dejaba medio mapa fuera de cuadro en un teléfono en
vertical.

## Alternativas descartadas

- **Resolver el clic dentro de `GameScene`:** era lo más corto, pero mete reglas
  en el render y obliga a duplicar la lógica del HUD. Además la escena tiene el
  estado **visual** (que va por detrás del motor durante la animación), y
  decidir ataques con datos atrasados produce comandos rechazados.
- **Dos clics explícitos (origen y después "Atacar"):** más control, pero el
  gesto natural de un mapa es tocar el destino y que pase. El HUD conserva el
  botón y el deslizador de dados para quien quiera controlar la tirada.
- **Etiquetas HTML (`CSS2DRenderer`):** texto nítido, pero 50 nodos DOM
  proyectados por frame rompen el presupuesto de dibujo y complican el
  descarte. El atlas en un solo mesh mantiene la escena en 1 draw call extra.
- **Nombres como `Sprite` por territorio:** 50 draw calls y facturación de
  memoria de texturas por etiqueta.
