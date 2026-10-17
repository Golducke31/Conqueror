/**
 * Helpers de DOM para las pantallas del juego.
 *
 * El proyecto arma la UI con TypeScript vanilla + componentes livianos
 * (decision del plan, seccion 3); estos helpers son el minimo comun.

 */

/** Crea un elemento con clase y texto opcional. */
export function nodo(etiqueta: string, clase = '', texto?: string): HTMLElement {
  const element = document.createElement(etiqueta);
  element.className = clase;
  if (texto !== undefined) element.textContent = texto;
  return element;
}

export interface OpcionesBoton {
  readonly primario?: boolean;
  readonly pequeno?: boolean;
  readonly title?: string;
  readonly deshabilitado?: boolean;
  readonly dato?: Readonly<Record<string, string>>;
}

/** Boton con el estilo del HUD. */
export function boton(
  texto: string,
  onClick: () => void,
  opciones: OpcionesBoton = {},
): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = texto;
  element.className = opciones.primario
    ? 'rounded border border-qolli bg-qolli/20 px-3 py-1.5 text-xs font-semibold text-qolli transition-colors hover:bg-qolli/30 disabled:opacity-40'
    : 'rounded border border-lana-3 px-3 py-1.5 text-xs text-algodon/80 transition-colors hover:border-qolli hover:text-qolli disabled:opacity-40';
  if (opciones.pequeno === true) {
    element.className += ' px-2 py-0.5 text-[11px]';
  }
  if (opciones.title !== undefined) element.title = opciones.title;
  element.disabled = opciones.deshabilitado === true;
  for (const [clave, valor] of Object.entries(opciones.dato ?? {})) {
    element.dataset[clave] = valor;
  }
  element.addEventListener('click', onClick);
  return element;
}

/** Chip seleccionable (territorios, tarjetas). */
export function chip(
  texto: string,
  onClick: (() => void) | null,
  opciones: { activo?: boolean; dato?: Readonly<Record<string, string>> } = {},
): HTMLElement {
  const element = document.createElement(opciones.activo === true ? 'button' : 'button');
  element.type = 'button';
  element.textContent = texto;
  element.className =
    'rounded border px-2 py-0.5 text-[11px] transition-colors ' +
    (opciones.activo === true
      ? 'border-qolli bg-qolli/20 text-qolli'
      : 'border-lana-3 text-algodon/70 hover:border-qolli hover:text-qolli');
  if (onClick !== null) element.addEventListener('click', onClick);
  else element.disabled = true;
  for (const [clave, valor] of Object.entries(opciones.dato ?? {})) {
    element.dataset[clave] = valor;
  }
  return element;
}

/** Etiqueta de seccion dentro de un panel. */
export function titulo(texto: string): HTMLElement {
  return nodo('h2', 'text-[11px] font-semibold uppercase tracking-[0.18em] text-qolli', texto);
}

/** Fila de control con etiqueta, para formularios. */
export function campo(label: string, control: HTMLElement): HTMLElement {
  const box = nodo('label', 'flex flex-col gap-1');
  box.append(nodo('span', 'text-[11px] uppercase tracking-wider text-algodon/50', label), control);
  return box;
}

/** Select con opciones `[valor, texto]`. */
export function selector(
  opciones: readonly (readonly [string, string])[],
  valor: string,
  onChange: (valor: string) => void,
): HTMLSelectElement {
  const element = document.createElement('select');
  element.className =
    'w-full rounded border border-lana-3 bg-hilo/80 px-2 py-1 text-xs text-algodon';
  for (const [value, label] of opciones) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    element.append(option);
  }
  element.value = valor;
  element.addEventListener('change', () => onChange(element.value));
  return element;
}

/** Deslizador con etiqueta de valor. */
export function deslizador(
  min: number,
  max: number,
  valor: number,
  onInput: (valor: number) => void,
): { elemento: HTMLElement; input: HTMLInputElement; etiqueta: HTMLElement } {
  const fila = nodo('div', 'flex items-center gap-2');
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.value = String(valor);
  input.className = 'h-1 flex-1 accent-qolli';
  const etiqueta = nodo(
    'span',
    'w-10 text-right text-sm font-semibold text-algodon',
    String(valor),
  );
  input.addEventListener('input', () => {
    etiqueta.textContent = input.value;
    onInput(Number(input.value));
  });
  fila.append(input, etiqueta);
  return { elemento: fila, input, etiqueta };
}
