# Creditos y licencias

## Datos del mapa

- **Natural Earth** — <https://www.naturalearthdata.com/>
  Datos vectoriales de dominio publico (Public Domain, sin condiciones).
  Se usan `ne_50m_admin_0_countries` y `ne_50m_admin_1_states_provinces`,
  obtenidos del repositorio `nvkelso/natural-earth-vector`.
  Los archivos crudos no se versionan: los descarga `pnpm map:fetch` en `data/ne/`.
  La geometria derivada (`packages/map-data/generated/`) es un trabajo derivado
  de dominio publico y se versiona para que el proyecto sea reproducible.

## Dependencias de ejecucion (cliente)

| Paquete         | Licencia                                         | Uso                                         |
| --------------- | ------------------------------------------------ | ------------------------------------------- |
| three           | MIT                                              | render 3D                                   |
| d3-geo          | ISC                                              | proyeccion, area y centroide geodesico      |
| topojson-client | ISC                                              | lectura de TopoJSON                         |
| earcut          | ISC                                              | triangulacion de poligonos                  |
| nanostores      | MIT                                              | store reactivo del HUD                      |
| gsap            | GreenSock Standard License (gratuita desde 2025) | animacion de banners y texto                |
| lenis           | MIT                                              | scroll suave (solo landing, lobby y reglas) |
| tailwindcss     | MIT                                              | estilos del HUD                             |

## Dependencias de ejecucion (servidor)

| Paquete  | Licencia | Uso                                            |
| -------- | -------- | ---------------------------------------------- |
| zod      | MIT      | validacion de mensajes y de la config del mapa |
| colyseus | MIT      | (Hito 6) salas y estado sincronizado           |

## Dependencias de desarrollo

| Paquete                               | Licencia   | Uso                               |
| ------------------------------------- | ---------- | --------------------------------- |
| typescript                            | Apache-2.0 | tipos                             |
| vite                                  | MIT        | build y dev server                |
| vitest                                | MIT        | tests unitarios                   |
| fast-check                            | MIT        | property tests (Hito 3)           |
| playwright                            | Apache-2.0 | smoke test del cliente            |
| eslint / typescript-eslint / prettier | MIT        | calidad de codigo                 |
| tsx                                   | MIT        | ejecucion de los scripts de datos |
| topojson-server / topojson-simplify   | ISC        | pipeline del mapa                 |

## Tipografias

No se incluyen archivos de fuentes. La UI usa la pila del sistema, con Georgia
como serif de titulo. Si en el Hito 5 se incorpora una tipografia propia, hay que
agregar aca su licencia y su archivo de licencia al repo.

## Marca y contenido

El nombre **Conqueror**, los textos, la paleta, la iconografia y el codigo son de
autoria propia. La mecanica de juego (dados, conquista por continentes, canjes de
tarjetas) consiste en sistemas y procedimientos. No se usan marcas, nombres
comerciales ni material grafico o textual de terceros. Ver
`docs/adr/0002-nombre-y-propiedad-intelectual.md`.

## Sonidos (los aporta el usuario)

El proyecto **no incluye ni descarga sonidos**. El sistema de audio está
construido para funcionar **en silencio** mientras los archivos no existan: un
slot sin archivo no produce error, solo un `console.debug` si `?debug=1`.

Convención: `apps/client/public/audio/combat/<slot_con_guion_bajo>_<n>.mp3`
(por ejemplo `cannon_fire_1.mp3`). Formato recomendado: **MP3 o M4A** por
compatibilidad entre navegadores (si usás OGG, incluí también un respaldo).
Efectos en mono, normalizados con margen de seguridad.

Los archivos se declaran en el manifiesto `apps/client/public/audio/combat/manifest.json`
(un slot por sonido, con rutas relativas al manifiesto). El que se entrega trae
todos los slots con `files: []`: el juego arranca en silencio y suena en el
momento correcto en cuanto se agregan archivos. Ver `docs/adr/0011-audio.md`
y la página de prueba `/debug/sounds` (solo en desarrollo).

**El usuario es responsable de que los sonidos sean propios o con licencia.**
Completar la tabla al agregarlos:

| Slot                   | Cuándo suena                     | Duración orientativa | Archivo | Autor / licencia |
| ---------------------- | -------------------------------- | -------------------- | ------- | ---------------- |
| `dice.roll`            | Dados en el aire y rodando       | 0.5–0.8 s            |         |                  |
| `dice.land`            | Dado que se asienta              | 0.2–0.4 s            |         |                  |
| `dice.win`             | Destello del par ganado          | 0.2–0.4 s            |         |                  |
| `dice.lose`            | Destello del par perdido         | 0.2–0.4 s            |         |                  |
| `infantry.march`       | Avance de la escuadra            | loop 1–2 s           |         |                  |
| `infantry.volley`      | Salva de mosquetes               | 0.6–1.2 s            |         |                  |
| `infantry.death`       | Baja de un soldado               | 0.3–0.6 s            |         |                  |
| `cavalry.charge`       | Galope de la carga               | loop 1–2 s           |         |                  |
| `cavalry.impact`       | Choque del jinete                | 0.4–0.8 s            |         |                  |
| `cannon.fire`          | Disparo de cañón                 | 0.8–1.5 s            |         |                  |
| `cannon.impact`        | Explosión y tierra levantada     | 0.8–1.5 s            |         |                  |
| `ship.sail`            | Navegación                       | loop 2–4 s           |         |                  |
| `ship.cannon`          | Andanada naval                   | 1–2 s                |         |                  |
| `ship.landing`         | Desembarco en la costa           | 1–2 s                |         |                  |
| `flag.plant`           | Estandarte clavado               | 0.4–0.8 s            |         |                  |
| `territory.conquered`  | Fanfarria o corneta de conquista | 1–2.5 s              |         |                  |
| `battle.ambience.low`  | Ambiente con `battleHeat` bajo   | loop 8–20 s          |         |                  |
| `battle.ambience.mid`  | Ambiente con `battleHeat` medio  | loop 8–20 s          |         |                  |
| `battle.ambience.high` | Ambiente con `battleHeat` alto   | loop 8–20 s          |         |                  |

## Si se activa el Hito 8 (modo fotorrealista)

Antes de implementarlo hay que revisar con el humano los costos y terminos del
proveedor de tiles (Google Photorealistic 3D Tiles o Cesium ion). En general
exigen **atribucion visible obligatoria**, tienen **limites de cache** y no
permiten uso offline. Hay que agregar aca la atribucion correspondiente y
respetar esos limites.
