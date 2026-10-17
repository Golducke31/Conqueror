/**
 * Pantalla de relevo (hot-seat).
 *
 * Entre turno y turno se oculta TODO el HUD: el proximo jugador no puede ver
 * las tarjetas ni la mision del anterior (plan, seccion 9: "una pantalla pasa
 * el dispositivo oculta tarjetas y mision entre turnos"). El estado publico que
 * produce el transporte ya viene filtrado por el jugador de turno; este
 * cartel agrega la ocultad fisica mientras se pasa el dispositivo.
 */

import type { PlayerColorId } from '@conqueror/shared';

import { t } from '../app/i18n.js';
import { boton, nodo } from './dom.js';

export interface RelevoOpciones {
  readonly playerName: string;
  readonly color: PlayerColorId;
  readonly turno: number;
  readonly onReady: () => void;
}

const HEX: Readonly<Record<PlayerColorId, string>> = {
  rojo: 'c0392b',
  azul: '2f6fb5',
  amarillo: 'e2a72e',
  verde: '2f6b4f',
  negro: '2e3440',
  magenta: 'a03a8c',
};

/** Muestra el cartel de relevo sobre todo. */
export function mostrarRelevo(contenedor: HTMLElement, opciones: RelevoOpciones): void {
  contenedor.replaceChildren();
  contenedor.classList.remove('hidden');
  contenedor.className =
    'fixed inset-0 z-40 flex items-center justify-center bg-hilo/97 p-6 backdrop-blur-sm';

  const caja = nodo('section', 'w-full max-w-md text-center');
  const punto = nodo('span', 'mx-auto mb-4 block h-4 w-4 rounded-full');
  punto.style.backgroundColor = `#${HEX[opciones.color] ?? 'c0392b'}`;

  caja.append(
    punto,
    nodo('h1', 'font-display text-3xl tracking-wide text-algodon', opciones.playerName),
    nodo(
      'p',
      'mt-2 text-sm uppercase tracking-[0.2em] text-qolli',
      t('relevo.turno', { turno: opciones.turno }),
    ),
    nodo('p', 'mt-4 text-sm text-algodon/60', t('relevo.instruccion')),
  );

  const acciones = nodo('div', 'mt-6 flex justify-center');
  acciones.append(
    boton(t('relevo.listo'), opciones.onReady, { primario: true, dato: { relevo: 'listo' } }),
  );
  caja.append(acciones);

  contenedor.append(caja);
}

/** Oculta el cartel de relevo. */
export function ocultarRelevo(contenedor: HTMLElement): void {
  contenedor.replaceChildren();
  // Clase completa en lugar de `classList.add`: si queda `flex` y `hidden` en
  // el mismo className, el orden de la hoja de Tailwind decide y el cartel
  // puede seguir tapando el HUD.
  contenedor.className = 'hidden';
}
