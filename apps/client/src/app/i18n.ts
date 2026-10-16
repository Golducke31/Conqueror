/**
 * i18n minimo y tipado.
 *
 * Decision: implementacion propia en lugar de i18next. Motivo: el juego usa
 * pocas decenas de claves, necesita cero dependencias extra en el bundle
 * inicial y la interpolacion es trivial. Si en el Hito 5 el volumen de claves
 * crece mucho, se reevalua.
 *
 * Regla: NINGUN string de UI se escribe hardcodeado en los componentes.
 */

import { DEFAULT_LOCALE, LOCALES, type Locale } from '@conqueror/shared';
import { atom, type ReadableAtom } from 'nanostores';

export type Dictionary = Readonly<Record<string, string>>;

const esAR: Dictionary = {
  'app.nombre': 'Conqueror',
  'app.lema': 'Guerra de imperios',
  'app.cargando': 'Preparando el tablero...',
  'app.hito0': 'Hito 0: base del proyecto en pie.',
  'app.hito0.detalle':
    'Monorepo, motor de reglas, cliente 3D y pipeline de mapa listos. El tablero jugable llega en el Hito 2.',
  'accion.empezar': 'Empezar',
  'accion.idioma': 'Idioma',
  'accion.reintentar': 'Reintentar',
  'accion.centrar': 'Centrar',
  'error.webgl':
    'Tu navegador no pudo iniciar WebGL. Probá con otro navegador o activá la aceleración por hardware.',
  'error.mapa': 'No se pudieron cargar los datos del tablero.',
  'error.mapa.detalle': 'Corré `pnpm map:build` para generarlos y volvé a cargar la página.',
  'hud.jugadores': 'Jugadores',
  'hud.territorios': 'terr.',
  'hud.ejercitos': 'ejérc.',
  'hud.territorio': 'Territorio',
  'hud.sinSeleccion': 'Tocá un territorio para ver su detalle.',
  'hud.dueno': 'Dueño',
  'hud.sinDueno': 'Sin dueño',
  'hud.fronteras': 'Fronteras',
  'hud.ayuda': 'Arrastrá para mover, rueda o pinch para acercar, clic para seleccionar.',
  'hud.fichas': 'Fichas',
  'hud.cargandoMapa': 'Cargando el mundo...',
  'hud.ataque': 'Ataque',
  'hud.probabilidad': 'Probabilidad de conquista: {valor}%',
  'debug.titulo': 'Depuracion',
  'debug.fps': 'FPS',
  'debug.drawcalls': 'Draw calls',
  'debug.triangulos': 'Triangulos',
  'debug.contexto': 'Contexto',
  'debug.unidades': 'Unidades',
  'debug.calor': 'Calor',
  'debug.calidad': 'Calidad',
  'debug.seleccionado': 'Seleccionado',
  'debug.apuntado': 'Apuntado',
  'sandbox.titulo': 'Sandbox de combate',
  'sandbox.origen': 'Origen',
  'sandbox.destino': 'Destino',
  'sandbox.enlace': 'Enlace',
  'sandbox.terrestre': 'Terrestre',
  'sandbox.maritimo': 'Marítimo',
  'sandbox.atacante': 'Ejércitos del atacante',
  'sandbox.defensor': 'Ejércitos del defensor',
  'sandbox.nivel': 'Nivel',
  'sandbox.ronda': 'Tirar ronda',
  'sandbox.conquistar': 'Conquistar',
  'sandbox.reiniciar': 'Reiniciar',
  'sandbox.saltar': 'Saltar',
  'sandbox.pendientes': 'Rondas pendientes',
  'sandbox.dados': 'Última ronda',
  'sandbox.probabilidad': 'Probabilidad de conquista',
  'sandbox.conquistado': 'Conquistado',
  'sandbox.aMover': 'Ejércitos a mover',
  'sandbox.mover': 'Mover',
  'sandbox.calidad': 'Calidad',
  'sandbox.calidad.plena': 'plena',
  'sandbox.calidad.reducida': 'reducida',
  'sandbox.calidadForzada': 'Forzar calidad reducida',
  'sandbox.silencio': 'Silenciar',
  'sandbox.ayuda':
    'El sandbox es solo para desarrollo: los eventos están simulados, el motor de reglas llega en el Hito 3.',
  'sounds.titulo': 'Señales de audio',
  'sounds.pagina.titulo': 'Prueba de sonidos',
  'sounds.pagina.ayuda':
    'Un botón por slot del manifiesto. En rojo, los slots sin archivo: el juego corre en silencio hasta que los agregues.',
  'sounds.bus.efectos': 'Efectos',
  'sounds.bus.ambiente': 'Ambiente',
  'sounds.silencio': 'Silencio',
  'sounds.probar': 'Probar',
  'sounds.sinArchivo': 'Sin archivo',
  'sounds.listo': 'Listo',
  'sounds.calor': 'Calor de batalla',
  'sounds.consejo':
    'Los archivos van en public/audio/combat/ con el nombre <slot_con_guion_bajo>_<n>.mp3, y se cargan en el manifiesto. Registrálos en docs/CREDITS.md.',
  'sounds.manifiesto.roto': 'El manifiesto de sonidos tiene problemas:',
  'sounds.manifiesto.ausente': 'No se encontró el manifiesto de sonidos.',
  'sounds.estado.sono': 'Sonó',
  'sounds.estado.sin-archivo': 'Sin archivo',
  'sounds.estado.sin-desbloquear': 'Contexto bloqueado',
  'sounds.estado.descartada-voces': 'Descartada (voces)',
  'sounds.estado.descartada-cooldown': 'Descartada (cooldown)',
  'sounds.estado.decodificando': 'Decodificando',
};

const en: Dictionary = {
  'app.nombre': 'Conqueror',
  'app.lema': 'War of empires',
  'app.cargando': 'Preparing the board...',
  'app.hito0': 'Milestone 0: project base is up.',
  'app.hito0.detalle':
    'Monorepo, rules engine, 3D client and map pipeline in place. The playable board arrives in Milestone 2.',
  'accion.empezar': 'Start',
  'accion.idioma': 'Language',
  'accion.reintentar': 'Retry',
  'accion.centrar': 'Center',
  'error.webgl':
    'Your browser could not start WebGL. Try another browser or enable hardware acceleration.',
  'error.mapa': 'The board data could not be loaded.',
  'error.mapa.detalle': 'Run `pnpm map:build` to generate it and reload the page.',
  'hud.jugadores': 'Players',
  'hud.territorios': 'terr.',
  'hud.ejercitos': 'armies',
  'hud.territorio': 'Territory',
  'hud.sinSeleccion': 'Tap a territory to see its details.',
  'hud.dueno': 'Owner',
  'hud.sinDueno': 'Unowned',
  'hud.fronteras': 'Borders',
  'hud.ayuda': 'Drag to pan, wheel or pinch to zoom, click to select.',
  'hud.fichas': 'Tokens',
  'hud.cargandoMapa': 'Loading the world...',
  'hud.ataque': 'Attack',
  'hud.probabilidad': 'Conquest probability: {valor}%',
  'debug.titulo': 'Debug',
  'debug.fps': 'FPS',
  'debug.drawcalls': 'Draw calls',
  'debug.triangles': 'Triangles',
  'debug.context': 'Context',
  'debug.units': 'Units',
  'debug.calor': 'Heat',
  'debug.calidad': 'Quality',
  'debug.selected': 'Selected',
  'debug.hovered': 'Hovered',
  'sandbox.title': 'Combat sandbox',
  'sandbox.origin': 'Origin',
  'sandbox.target': 'Target',
  'sandbox.link': 'Link',
  'sandbox.land': 'Land',
  'sandbox.sea': 'Sea',
  'sandbox.attacker': 'Attacker armies',
  'sandbox.defender': 'Defender armies',
  'sandbox.level': 'Level',
  'sandbox.round': 'Roll round',
  'sandbox.conquer': 'Conquer',
  'sandbox.reset': 'Reset',
  'sandbox.skip': 'Skip',
  'sandbox.pending': 'Pending rounds',
  'sandbox.dice': 'Last round',
  'sandbox.probability': 'Conquest probability',
  'sandbox.conquered': 'Conquered',
  'sandbox.toMove': 'Armies to move',
  'sandbox.move': 'Move',
  'sandbox.quality': 'Quality',
  'sandbox.qualityFull': 'full',
  'sandbox.qualityReduced': 'reduced',
  'sandbox.forceQuality': 'Force reduced quality',
  'sandbox.silencio': 'Mute',
  'sandbox.help':
    'Sandbox is for development only: events are simulated, the rules engine arrives in Milestone 3.',
  'sounds.titulo': 'Audio cues',
  'sounds.pagina.titulo': 'Sound test',
  'sounds.pagina.ayuda':
    'One button per manifest slot. Slots with no file are red: the game runs in silence until you add them.',
  'sounds.bus.efectos': 'Effects',
  'sounds.bus.ambiente': 'Ambience',
  'sounds.silencio': 'Mute',
  'sounds.probar': 'Play',
  'sounds.sinArchivo': 'No file',
  'sounds.listo': 'Ready',
  'sounds.calor': 'Battle heat',
  'sounds.consejo':
    'Files go in public/audio/combat/ named <slot_with_underscores>_<n>.mp3, and are listed in the manifest. Register them in docs/CREDITS.md.',
  'sounds.manifiesto.roto': 'The sound manifest has problems:',
  'sounds.manifiesto.ausente': 'The sound manifest was not found.',
  'sounds.estado.sono': 'Played',
  'sounds.estado.sin-archivo': 'No file',
  'sounds.estado.sin-desbloquear': 'Context locked',
  'sounds.estado.descartada-voces': 'Dropped (voices)',
  'sounds.estado.descartada-cooldown': 'Dropped (cooldown)',
  'sounds.estado.decodificando': 'Decoding',
};

const dictionaries: Readonly<Record<Locale, Dictionary>> = { 'es-AR': esAR, en };

/** Idioma activo. Reactivo: el HUD se re-renderiza al cambiarlo. */
export const $locale = atom<Locale>(DEFAULT_LOCALE);

/** Traduce una clave con interpolacion `{nombre}`. */
export function t(key: string, vars?: Readonly<Record<string, string | number>>): string {
  const locale = $locale.get();
  const template = dictionaries[locale][key] ?? dictionaries[DEFAULT_LOCALE][key] ?? key;
  if (vars === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

/** Suscripcion a cambios de idioma. */
export const localeStore: ReadableAtom<Locale> = $locale;

/** Nombre del evento que se dispara al cambiar el idioma. */
export const LOCALE_CHANGE_EVENT = 'conqueror:locale';

/** Cambia el idioma activo y avisa a la UI. */
export function setLocale(locale: Locale): void {
  if (!LOCALES.includes(locale)) return;
  const changed = $locale.get() !== locale;
  $locale.set(locale);
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  if (changed) document.dispatchEvent(new CustomEvent(LOCALE_CHANGE_EVENT));
}

/** Idioma activo actual. */
export function getLocale(): Locale {
  return $locale.get();
}

/** Idioma del navegador, si esta soportado. */
export function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
  const candidato = navigator.language;
  if (candidato.startsWith('es')) return 'es-AR';
  if (candidato.startsWith('en')) return 'en';
  return DEFAULT_LOCALE;
}
