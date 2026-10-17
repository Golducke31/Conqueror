/**
 * Pagina de prueba de modelos (`/debug/models`).
 *
 * Herramienta de desarrollo: muestra cada tipo de unidad con los modelos
 * finales si estan, y con la primitiva si no. Dibuja con las MISMAS capas que
 * la batalla (`UnitBatch` y `ShipLayer`), asi que lo que se ve aca es lo que
 * se ve jugando, incluido el tenido por color de jugador.
 *
 * Ademas imprime el presupuesto de la seccion 12 del plan: triangulos contra el
 * tope del tipo y el alto real de la geometria, para que quien modele sepa si
 * el modelo viene en la escala que pide `docs/art-spec.md`.
 */

import '../styles/main.css';

import { Group, Vector3, type BufferGeometry, type Color } from 'three';
import type { PlayerColorId } from '@conqueror/shared';
import { t } from '../app/i18n.js';
import { playerColor } from '../app/palette.js';
import { createRenderer } from '../render/renderer.js';
import { UnitBatch } from '../render/tokens/UnitBatch.js';
import { createUnitGeometries } from '../render/tokens/unitMeshes.js';
import { ShipLayer } from '../render/combat/units/ShipLayer.js';
import { createShipGeometry } from '../render/combat/units/shipMesh.js';
import {
  expectedModelFileName,
  TRIANGLE_BUDGET,
  UNIT_MODEL_TYPES,
  type UnitModelType,
} from '../render/tokens/models/manifest.js';
import { triangleCount } from '../render/tokens/models/unitGeometry.js';
import { createUnitModels, type UnitModelsState } from '../render/tokens/models/unitModels.js';

/** Colores de la fila de prueba, en orden de turno. */
const GAMA: readonly PlayerColorId[] = ['rojo', 'azul', 'amarillo', 'verde'];

/** Separacion entre puestos de la fila. */
const PASO = 16;

/** Primitiva de cada tipo: es lo que se dibuja cuando no hay modelo. */
const PRIMITIVAS: Readonly<Record<UnitModelType, BufferGeometry>> = (() => {
  const unidades = createUnitGeometries();
  return {
    infantry: unidades.infantry,
    cavalry: unidades.cavalry,
    artillery: unidades.artillery,
    ship: createShipGeometry(),
  };
})();

function nodo(etiqueta: string, clase: string, texto?: string): HTMLElement {
  const element = document.createElement(etiqueta);
  element.className = clase;
  if (texto !== undefined) element.textContent = texto;
  return element;
}

async function main(): Promise<void> {
  const canvas = document.getElementById('lienzo');
  const hud = document.getElementById('hud');
  if (!(canvas instanceof HTMLCanvasElement) || hud === null) {
    throw new Error('Falta el lienzo o el HUD');
  }

  const params = new URLSearchParams(window.location.search);
  const renderer = createRenderer(canvas);

  const models = createUnitModels({
    renderer: renderer.renderer,
    debug: params.get('debug') === '1',
  });
  const estado = await models.load();

  // --- Fila de prueba ---------------------------------------------------------
  // Las mismas capas que usa la batalla: si el tenido o el atlas fallan, aca se
  // ve igual que jugando.
  const fila = new Group();
  const batch = new UnitBatch({ capacity: 32 });
  const ships = new ShipLayer({ capacity: GAMA.length });
  fila.add(batch.group, ships.group);
  renderer.scene.add(fila);

  aplicarEstado(estado);

  function aplicarEstado(actual: UnitModelsState): void {
    batch.setGeometries(actual.models);
    const navio = actual.models.ship;
    if (navio !== undefined) ships.setGeometry(navio);

    // Tres unidades por color (una de cada tipo) y un navio por color.
    const unidades: {
      type: 'infantry' | 'cavalry' | 'artillery';
      x: number;
      y: number;
      z: number;
      rotationY: number;
      scale: number;
      color: Color;
    }[] = [];
    const barcos: {
      x: number;
      y: number;
      z: number;
      rotationY: number;
      scale: number;
      color: Color;
    }[] = [];

    GAMA.forEach((color, indice) => {
      const x = (indice - (GAMA.length - 1) / 2) * PASO;
      const tono = playerColor(color);
      (['infantry', 'cavalry', 'artillery'] as const).forEach((type, tipo) => {
        unidades.push({
          type,
          x,
          y: 0,
          z: tipo * PASO * 0.6,
          rotationY: 0,
          scale: 1,
          color: tono,
        });
      });
      barcos.push({ x, y: 0, z: -PASO * 0.8, rotationY: 0, scale: 1, color: tono });
    });

    batch.setInstances(unidades);
    ships.setInstances(barcos);
  }

  // Camara: encuadra la grilla entera (cuatro colores por cuatro tipos) desde
  // el frente y un poco arriba, para que no quede nada fuera del cuadro.
  renderer.camera.position.set(0, PASO * 2.6, PASO * 5.2);
  renderer.camera.lookAt(new Vector3(0, PASO * 0.25, 0));

  // Giro lento para ver el modelo de todos lados, y vaiven de reposo.
  let girando = true;
  let tiempo = 0;
  renderer.onFrame((delta) => {
    tiempo += delta;
    batch.setTime(tiempo);
    if (!girando) return;
    fila.rotation.y += delta * 0.35;
    renderer.requestRender();
  });
  renderer.setContinuous(true);

  // --- Panel ------------------------------------------------------------------
  const panel = nodo(
    'section',
    'pointer-events-auto absolute left-3 top-3 max-h-[calc(100vh-1.5rem)] w-[24rem] overflow-y-auto rounded-lg border border-lana-3/70 bg-lana/90 p-4 text-sm shadow-xl shadow-hilo/60 backdrop-blur',
  );
  panel.append(
    nodo('h1', 'font-display text-base text-qolli', t('models.pagina.titulo')),
    nodo('p', 'mt-1 text-[11px] leading-relaxed text-algodon/50', t('models.pagina.ayuda')),
  );

  if (estado.manifestErrors.length > 0) {
    const caja = nodo(
      'div',
      'mt-3 rounded border border-grana/70 bg-hilo/70 p-2 text-[11px] text-grana',
    );
    caja.append(nodo('div', 'font-semibold', t('models.manifiesto.roto')));
    for (const error of estado.manifestErrors) caja.append(nodo('div', '', `- ${error}`));
    panel.append(caja);
  }

  const lista = nodo('div', 'mt-3 flex flex-col gap-2');
  for (const type of UNIT_MODEL_TYPES) {
    lista.append(filaTipo(type, estado));
  }
  panel.append(lista);

  panel.append(nodo('p', 'mt-3 text-[11px] leading-relaxed text-algodon/45', t('models.consejo')));

  const filaGirar = nodo('label', 'mt-2 flex items-center gap-2 text-[11px] text-algodon/60');
  const checkGirar = document.createElement('input');
  checkGirar.type = 'checkbox';
  checkGirar.checked = true;
  checkGirar.className = 'h-3.5 w-3.5 accent-qolli';
  checkGirar.addEventListener('change', () => {
    girando = checkGirar.checked;
  });
  filaGirar.append(checkGirar, nodo('span', '', t('models.girar')));
  panel.append(filaGirar);

  hud.append(panel);

  function filaTipo(type: UnitModelType, actual: UnitModelsState): HTMLElement {
    const informe = actual.reports.find((entry) => entry.type === type);
    const estadoTipo = informe?.status ?? 'absent';
    const cargado = estadoTipo === 'loaded';

    const fila = nodo(
      'div',
      'rounded border px-2 py-1.5 ' +
        (cargado ? 'border-lana-3/70 bg-hilo/50' : 'border-grana/60 bg-grana/10'),
    );

    const cabecera = nodo('div', 'flex items-baseline justify-between gap-2');
    cabecera.append(
      nodo('span', 'font-semibold text-algodon/90', t(`models.tipo.${type}`)),
      nodo(
        'span',
        'shrink-0 text-[10px] uppercase tracking-wider ' +
          (cargado ? 'text-qolli/80' : 'text-grana'),
        t(`models.estado.${estadoTipo}`),
      ),
    );
    fila.append(cabecera);

    const archivo = informe?.file ?? expectedModelFileName(type);
    fila.append(nodo('div', 'truncate font-mono text-[10px] text-algodon/40', archivo));

    // Lo que se dibuja de verdad: el modelo si esta, y si no la primitiva. Los
    // numeros son los de la geometria que esta en uso, no los del archivo.
    const geometria = actual.models[type]?.geometry ?? PRIMITIVAS[type];
    const esPrimitiva = actual.models[type] === undefined;
    const triangulos = triangleCount(geometria);
    const tope = TRIANGLE_BUDGET[type];
    const dentro = triangulos <= tope;
    const detalle = nodo('div', 'mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]');
    detalle.append(
      nodo(
        'span',
        dentro ? 'text-algodon/60' : 'text-grana',
        `${t('models.triangulos')}: ${triangulos} / ${tope}`,
      ),
      nodo('span', 'text-algodon/60', `${t('models.alto')}: ${altoDe(geometria).toFixed(1)} u`),
    );
    if (esPrimitiva) {
      detalle.append(nodo('span', 'uppercase tracking-wider text-qolli/60', t('models.primitiva')));
    }
    fila.append(detalle);

    if (informe?.reason !== null && informe?.reason !== undefined) {
      fila.append(nodo('div', 'mt-0.5 text-[10px] text-algodon/45', informe.reason));
    }
    return fila;
  }

  /** Alto real de la geometria, para verificar la escala unitaria. */
  function altoDe(geometria: BufferGeometry): number {
    geometria.computeBoundingBox();
    const caja = geometria.boundingBox;
    if (caja === null) return 0;
    return caja.max.y - caja.min.y;
  }
}

void main();
