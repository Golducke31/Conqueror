/**
 * Pagina de prueba de sonidos (`/debug/sounds`).
 *
 * Herramienta de desarrollo: un boton por slot del manifiesto que dispara la
 * senal, con los slots sin archivo marcados en rojo. Ademas, los controles de
 * los buses (efectos y ambiente), el silencio general y un deslizador de calor
 * de batalla para escuchar el crossfade del ambiente.
 *
 * El juego corre SIN ningun sonido mientras el manifiesto no tenga archivos
 * (ADR 0011): esta pagina es el lugar para cargarlos y verificar que suenen.
 */

import '../styles/main.css';

import { t } from '../app/i18n.js';
import { createAudioManager, type CueLogEntry } from '../render/combat/audio/audioManager.js';
import { expectedFileName, type AudioBus } from '../render/combat/audio/manifest.js';

function nodo(etiqueta: string, clase: string, texto?: string): HTMLElement {
  const element = document.createElement(etiqueta);
  element.className = clase;
  if (texto !== undefined) element.textContent = texto;
  return element;
}

async function main(): Promise<void> {
  const hud = document.getElementById('hud');
  if (hud === null) throw new Error('Falta el HUD');

  const params = new URLSearchParams(window.location.search);

  // Sin escena 3D, el paneo va al centro: la pagina prueba los sonidos, no
  // su posicion en el espacio.
  const audio = createAudioManager({
    debug: params.get('debug') === '1',
    onCue: (entrada) => mostrarSenal(entrada),
  });
  await audio.load();

  const panel = nodo(
    'section',
    'pointer-events-auto absolute left-3 top-3 max-h-[calc(100vh-1.5rem)] w-[26rem] overflow-y-auto rounded-lg border border-lana-3/70 bg-lana/90 p-4 text-sm shadow-xl shadow-hilo/60 backdrop-blur',
  );

  panel.append(
    nodo('h1', 'font-display text-base text-qolli', t('sounds.pagina.titulo')),
    nodo('p', 'mt-1 text-[11px] leading-relaxed text-algodon/50', t('sounds.pagina.ayuda')),
  );

  // --- Buses y ambiente -----------------------------------------------------

  const buses = nodo('div', 'mt-3 grid grid-cols-2 gap-2');
  for (const bus of ['effects', 'ambience'] as const) {
    const etiqueta = bus === 'effects' ? t('sounds.bus.efectos') : t('sounds.bus.ambiente');
    buses.append(controlBus(bus, etiqueta));
  }
  panel.append(buses);

  // Calor de batalla: cruza las capas de ambiente (low → mid → high).
  const filaCalor = nodo('label', 'mt-3 flex flex-col gap-1');
  const calorInput = document.createElement('input');
  calorInput.type = 'range';
  calorInput.min = '0';
  calorInput.max = '1';
  calorInput.step = '0.05';
  calorInput.className = 'w-full accent-qolli';
  const calorValor = nodo('span', 'text-[11px] text-algodon/60', '0.00');
  calorInput.addEventListener('input', () => {
    const valor = Number(calorInput.value);
    calorValor.textContent = valor.toFixed(2);
    audio.setAmbienceHeat(valor);
  });
  filaCalor.append(
    nodo('span', 'text-[11px] uppercase tracking-wider text-algodon/50', t('sounds.calor')),
    calorInput,
    calorValor,
  );
  panel.append(filaCalor);

  // Silencio general.
  const checkSilencio = document.createElement('input');
  checkSilencio.type = 'checkbox';
  checkSilencio.className = 'h-3.5 w-3.5 accent-grana';
  const filaSilencio = nodo('label', 'mt-2 flex items-center gap-2 text-[11px] text-algodon/60');
  checkSilencio.addEventListener('change', () => audio.setMuted(checkSilencio.checked));
  filaSilencio.append(checkSilencio, nodo('span', '', t('sounds.silencio')));
  panel.append(filaSilencio);

  // --- Problemas del manifiesto ----------------------------------------------

  const errores = audio.manifestErrors();
  if (errores.length > 0) {
    const caja = nodo(
      'div',
      'mt-3 rounded border border-grana/70 bg-hilo/70 p-2 text-[11px] text-grana',
    );
    caja.append(nodo('div', 'font-semibold', t('sounds.manifiesto.roto')));
    for (const error of errores) caja.append(nodo('div', '', `- ${error}`));
    panel.append(caja);
  }

  // --- Slots ------------------------------------------------------------------

  const estados = audio.slotStatuses();
  if (estados.length === 0 && errores.length === 0) {
    panel.append(nodo('p', 'mt-3 text-[11px] text-algodon/60', t('sounds.manifiesto.ausente')));
  }

  const lista = nodo('div', 'mt-3 flex flex-col gap-1');
  for (const estado of estados) {
    lista.append(filaSlot(estado.name, estado.definition.files, estado.available, estado.ready));
  }
  panel.append(lista);

  panel.append(nodo('p', 'mt-3 text-[11px] leading-relaxed text-algodon/45', t('sounds.consejo')));

  // --- Registro en vivo ---------------------------------------------------------

  const registro = nodo(
    'div',
    'mt-2 max-h-28 overflow-y-auto rounded border border-lana-3/60 bg-hilo/60 p-2 font-mono text-[10px] leading-relaxed text-algodon/70',
  );
  panel.append(registro);

  function mostrarSenal(entrada: CueLogEntry): void {
    registro.prepend(nodo('div', '', `${entrada.slot} → ${t(`sounds.estado.${entrada.status}`)}`));
    while (registro.childElementCount > 12) registro.lastElementChild?.remove();
  }

  function controlBus(bus: AudioBus, etiqueta: string): HTMLElement {
    const fila = nodo('label', 'flex flex-col gap-1');
    const entrada = document.createElement('input');
    entrada.type = 'range';
    entrada.min = '0';
    entrada.max = '1';
    entrada.step = '0.05';
    entrada.value = String(audio.busVolume(bus));
    entrada.className = 'w-full accent-qolli';
    const valor = nodo('span', 'text-[11px] text-algodon/60', audio.busVolume(bus).toFixed(2));
    entrada.addEventListener('input', () => {
      const nuevo = Number(entrada.value);
      valor.textContent = nuevo.toFixed(2);
      audio.setBusVolume(bus, nuevo);
    });
    fila.append(
      nodo('span', 'text-[11px] uppercase tracking-wider text-algodon/50', etiqueta),
      entrada,
      valor,
    );
    return fila;
  }

  function filaSlot(
    nombre: string,
    archivos: readonly string[],
    disponible: boolean,
    listos: number,
  ): HTMLElement {
    const fila = nodo(
      'div',
      'flex items-center gap-2 rounded border px-2 py-1 ' +
        (disponible ? 'border-lana-3/70 bg-hilo/50' : 'border-grana/60 bg-grana/10'),
    );

    const boton = document.createElement('button');
    boton.type = 'button';
    boton.textContent = t('sounds.probar');
    boton.className = disponible
      ? 'rounded border border-qolli bg-qolli/20 px-2 py-0.5 text-[11px] font-semibold text-qolli hover:bg-qolli/30'
      : 'rounded border border-grana/60 px-2 py-0.5 text-[11px] text-grana hover:border-grana';
    // El clic es el gesto que desbloquea el contexto de audio.
    boton.addEventListener('click', () => audio.cue(nombre));

    const nombres = archivos.length > 0 ? archivos.join(', ') : expectedFileName(nombre, 1);
    const detalle = nodo(
      'div',
      'min-w-0 flex-1 font-mono text-[10px] leading-tight ' +
        (disponible ? 'text-algodon/70' : 'text-grana/90'),
    );
    detalle.append(
      nodo('div', 'truncate', nombre),
      nodo('div', 'truncate text-algodon/40', nombres),
    );

    const estado = nodo(
      'span',
      'shrink-0 text-[10px] uppercase tracking-wider ' +
        (disponible ? 'text-qolli/80' : 'text-grana'),
      disponible ? `${t('sounds.listo')} (${listos})` : t('sounds.sinArchivo'),
    );

    fila.append(boton, detalle, estado);
    return fila;
  }

  hud.append(panel);
}

void main();
