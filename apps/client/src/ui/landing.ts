/**
 * Landing del juego (Hito 5).
 *
 * Es la puerta de entrada: presenta el mapa, el combate y los modos, y lleva a
 * la pantalla de configuracion. Se carga por **import dinamico** desde
 * `main.ts`, asi el jugador que entra directo a una partida (`?auto=1`,
 * `?explorar=1`) no descarga GSAP/ScrollTrigger/SplitText/Lenis ni este CSS.
 *
 * Animacion y accesibilidad:
 *   - con `prefers-reduced-motion` no se inicializa nada de eso y el contenido
 *     queda visible y quieto (las animaciones de entrada son las unicas que
 *     arrancan en `opacity: 0`, y solo se crean cuando hay movimiento);
 *   - los titulos se parten con SplitText en modo `aria: 'auto'`, que deja el
 *     texto original accesible para lectores de pantalla;
 *   - hay enlace de salto, jerarquia de encabezados y foco visible.
 */

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';

import { LOCALE_CHANGE_EVENT, getLocale, setLocale, t } from '../app/i18n.js';
import { nodo } from './dom.js';
import '../styles/landing.css';

gsap.registerPlugin(ScrollTrigger, SplitText);

export interface LandingOptions {
  /** El jugador quiere empezar una partida (pantalla de configuracion). */
  readonly onPlay: () => void;
  /** El jugador quiere mirar el tablero sin reglas. */
  readonly onExplore: () => void;
}

export interface Landing {
  dispose(): void;
}

/** Posiciones de los puntos de cada cara en una grilla de 3x3 (1..9). */
const PIPS: Readonly<Record<number, readonly number[]>> = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

/** Un dado de seis caras con sus puntos, en 3D de CSS. */
function crearDado(): HTMLElement {
  const dado = nodo('div', 'dado');
  dado.setAttribute('aria-hidden', 'true');
  for (let cara = 1; cara <= 6; cara += 1) {
    const elemento = nodo('div', 'dado__cara');
    for (const posicion of PIPS[cara] ?? []) {
      const pip = nodo('span', 'dado__pip');
      const fila = Math.ceil(posicion / 3);
      const columna = ((posicion - 1) % 3) + 1;
      pip.style.gridArea = `${fila} / ${columna}`;
      elemento.append(pip);
    }
    dado.append(elemento);
  }
  return dado;
}

/** Boton de la landing. `accion` viaja como `data-accion` (lo usa el smoke). */
function boton(
  texto: string,
  clase: string,
  onClick: () => void,
  accion?: string,
): HTMLButtonElement {
  const elemento = document.createElement('button');
  elemento.type = 'button';
  elemento.className = clase;
  elemento.textContent = texto;
  if (accion !== undefined) elemento.dataset['accion'] = accion;
  elemento.addEventListener('click', onClick);
  return elemento;
}

export function mountLanding(options: LandingOptions): Landing {
  const reducirMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const raiz = nodo('div', 'landing');
  raiz.id = 'landing';

  const fondo = nodo('div', 'landing__fondo');
  fondo.setAttribute('aria-hidden', 'true');
  raiz.append(fondo);

  // El lienzo y el HUD del juego no tienen nada que hacer en la landing. Se
  // ocultan por estilo en linea: `hidden` de Tailwind pierde contra `flex` o
  // `block` segun el orden en que se generen las utilidades.
  const lienzo = document.getElementById('lienzo');
  const hud = document.getElementById('hud');
  const displayLienzo = lienzo?.style.display ?? '';
  const displayHud = hud?.style.display ?? '';
  if (lienzo !== null) lienzo.style.display = 'none';
  if (hud !== null) hud.style.display = 'none';

  let lenis: Lenis | null = null;
  let splits: SplitText[] = [];
  let tweens: gsap.core.Tween[] = [];

  const raf = (tiempo: number): void => {
    lenis?.raf(tiempo * 1000);
  };

  /** Deshace animaciones y scroll suave (antes de reconstruir o desmontar). */
  const limpiarAnimaciones = (): void => {
    for (const tween of tweens) {
      tween.scrollTrigger?.kill();
      tween.kill();
    }
    tweens = [];
    for (const split of splits) split.revert();
    splits = [];
    if (lenis !== null) {
      gsap.ticker.remove(raf);
      lenis.destroy();
      lenis = null;
    }
  };

  // ---------------------------------------------------------------------------
  // Contenido
  // ---------------------------------------------------------------------------

  const construir = (): void => {
    // Se conserva el fondo (es el unico hijo fijo) y se rehace el resto.
    raiz.querySelectorAll(':scope > :not(.landing__fondo)').forEach((elemento) => {
      elemento.remove();
    });

    const saltar = document.createElement('a');
    saltar.className = 'landing__saltar';
    saltar.href = '#contenido';
    saltar.textContent = t('landing.saltar');

    // --- Barra superior ------------------------------------------------------
    const nav = nodo('header', 'landing__nav');
    const marca = nodo('span', 'landing__marca', t('app.nombre'));
    const accionesNav = nodo('div', 'landing__nav-acciones');

    const idioma = getLocale();
    for (const codigo of ['es-AR', 'en'] as const) {
      const activo = idioma === codigo;
      const etiqueta = codigo === 'es-AR' ? 'ES' : 'EN';
      const control = boton(etiqueta, 'btn btn--chico', () => setLocale(codigo), 'idioma');
      control.setAttribute('aria-pressed', String(activo));
      control.setAttribute(
        'aria-label',
        `${t('accion.idioma')}: ${codigo === 'es-AR' ? 'Español' : 'English'}`,
      );
      accionesNav.append(control);
    }
    accionesNav.append(
      boton(t('landing.nav.jugar'), 'btn btn--primario btn--chico', options.onPlay, 'jugar'),
    );
    nav.append(marca, accionesNav);

    // --- Hero ----------------------------------------------------------------
    const hero = nodo('section', 'hero');
    hero.setAttribute('aria-labelledby', 'landing-hero-titulo');
    const eyebrow = nodo('p', 'hero__eyebrow', t('landing.hero.eyebrow'));
    const titulo = nodo('h1', 'hero__titulo', t('app.nombre'));
    titulo.id = 'landing-hero-titulo';
    const lead = nodo('p', 'hero__lead', t('landing.hero.lead'));

    const accionesHero = nodo('div', 'hero__acciones');
    accionesHero.append(
      boton(t('landing.hero.jugar'), 'btn btn--primario', options.onPlay, 'jugar'),
      boton(t('landing.hero.explorar'), 'btn', options.onExplore, 'explorar'),
    );
    const pista = nodo('p', 'hero__pista', t('landing.hero.scroll'));
    hero.append(eyebrow, titulo, lead, accionesHero, pista);

    // --- El mapa --------------------------------------------------------------
    const mapa = nodo('section', 'landing__seccion');
    mapa.setAttribute('aria-labelledby', 'landing-mapa-titulo');
    const mapaEtiqueta = nodo('p', 'landing__etiqueta', t('landing.mapa.etiqueta'));
    const mapaTitulo = nodo('h2', 'landing__titulo', t('landing.mapa.titulo'));
    mapaTitulo.id = 'landing-mapa-titulo';
    mapaTitulo.dataset['split'] = 'palabras';
    const mapaTexto = nodo('p', 'landing__texto', t('landing.mapa.texto'));

    const stats = nodo('dl', 'stats');
    const cifras: readonly (readonly [string, string])[] = [
      ['50', t('landing.stats.territorios')],
      ['6', t('landing.stats.continentes')],
      ['2–6', t('landing.stats.jugadores')],
      [t('landing.stats.dispositivo.valor'), t('landing.stats.dispositivo')],
    ];
    for (const [valor, nombre] of cifras) {
      const celda = nodo('div', 'stats__celda');
      celda.append(nodo('dt', 'stats__nombre', nombre), nodo('dd', 'stats__valor', valor));
      celda.classList.add('flex', 'flex-col-reverse');
      stats.append(celda);
    }
    mapa.append(mapaEtiqueta, mapaTitulo, mapaTexto, stats);

    // --- El combate ------------------------------------------------------------
    const combate = nodo('section', 'landing__seccion landing__seccion--angosta');
    combate.setAttribute('aria-labelledby', 'landing-combate-titulo');
    const combateEtiqueta = nodo('p', 'landing__etiqueta', t('landing.combate.etiqueta'));
    const combateTitulo = nodo('h2', 'landing__titulo', t('landing.combate.titulo'));
    combateTitulo.id = 'landing-combate-titulo';
    combateTitulo.dataset['split'] = 'palabras';
    const dados = nodo('div', 'dados');
    dados.append(crearDado(), crearDado(), crearDado());
    const combateTexto = nodo('p', 'landing__texto', t('landing.combate.texto'));
    combate.append(combateEtiqueta, combateTitulo, dados, combateTexto);

    // --- Los modos --------------------------------------------------------------
    const modos = nodo('section', 'landing__seccion');
    modos.setAttribute('aria-labelledby', 'landing-modos-titulo');
    const modosEtiqueta = nodo('p', 'landing__etiqueta', t('landing.modos.etiqueta'));
    const modosTitulo = nodo('h2', 'landing__titulo', t('landing.modos.titulo'));
    modosTitulo.id = 'landing-modos-titulo';
    modosTitulo.dataset['split'] = 'palabras';

    const listaModos = nodo('div', 'modos');
    const tarjetas: readonly {
      readonly titulo: string;
      readonly texto: string;
      readonly etiqueta?: string;
    }[] = [
      {
        titulo: t('landing.modos.local.titulo'),
        texto: t('landing.modos.local.texto'),
      },
      { titulo: t('landing.modos.bots.titulo'), texto: t('landing.modos.bots.texto') },
      {
        titulo: t('landing.modos.online.titulo'),
        texto: t('landing.modos.online.texto'),
        etiqueta: t('landing.modos.online.etiqueta'),
      },
    ];
    for (const tarjeta of tarjetas) {
      const caja = nodo('article', tarjeta.etiqueta === undefined ? 'modo' : 'modo modo--proximo');
      caja.append(
        nodo('h3', 'modo__titulo', tarjeta.titulo),
        nodo('p', 'modo__texto', tarjeta.texto),
      );
      if (tarjeta.etiqueta !== undefined) {
        caja.append(nodo('span', 'modo__etiqueta', tarjeta.etiqueta));
      }
      listaModos.append(caja);
    }
    modos.append(modosEtiqueta, modosTitulo, listaModos);

    // --- Cierre -------------------------------------------------------------------
    const cierre = nodo('section', 'cierre');
    cierre.setAttribute('aria-labelledby', 'landing-cierre-titulo');
    const cierreTitulo = nodo('h2', 'landing__titulo', t('landing.cierre.titulo'));
    cierreTitulo.id = 'landing-cierre-titulo';
    cierreTitulo.dataset['split'] = 'palabras';
    const cierreTexto = nodo('p', 'landing__texto mx-auto', t('landing.cierre.texto'));
    const accionesCierre = nodo('div', 'cierre__acciones');
    accionesCierre.append(
      boton(t('landing.hero.jugar'), 'btn btn--primario', options.onPlay, 'jugar'),
      boton(t('landing.hero.explorar'), 'btn', options.onExplore, 'explorar'),
    );
    cierre.append(cierreTitulo, cierreTexto, accionesCierre);

    const principal = nodo('main', '');
    principal.id = 'contenido';
    principal.append(hero, mapa, combate, modos, cierre);

    // --- Pie ------------------------------------------------------------------------
    const pie = nodo('footer', 'landing__pie');
    pie.append(nodo('p', '', t('landing.pie')));

    raiz.append(saltar, nav, principal, pie);
  };

  // ---------------------------------------------------------------------------
  // Animacion
  // ---------------------------------------------------------------------------

  const animar = (): void => {
    if (reducirMovimiento) return;

    // Scroll suave con Lenis, sincronizado con ScrollTrigger en un solo loop.
    lenis = new Lenis({ duration: 1.05, smoothWheel: true });
    lenis.on('scroll', () => ScrollTrigger.update());
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    // Titulo del hero: entra por letras, enmascarado por el overflow del padre.
    const heroTitulo = raiz.querySelector<HTMLElement>('#landing-hero-titulo');
    if (heroTitulo !== null) {
      const split = new SplitText(heroTitulo, { type: 'chars', aria: 'auto' });
      splits.push(split);
      tweens.push(
        gsap.from(split.chars, {
          yPercent: 118,
          opacity: 0,
          duration: 0.9,
          ease: 'power4.out',
          stagger: 0.035,
          delay: 0.1,
        }),
      );
    }

    // El resto del hero entra escalonado.
    const heroBloques = raiz.querySelectorAll<HTMLElement>('.hero > *:not(.hero__titulo)');
    tweens.push(
      gsap.from(heroBloques, {
        y: 18,
        opacity: 0,
        duration: 0.7,
        ease: 'power2.out',
        stagger: 0.09,
        delay: 0.35,
      }),
    );

    // Titulos de seccion: revelado por palabras atado al scroll.
    raiz.querySelectorAll<HTMLElement>('[data-split]').forEach((elemento) => {
      const split = new SplitText(elemento, { type: 'words', aria: 'auto' });
      splits.push(split);
      tweens.push(
        gsap.from(split.words, {
          yPercent: 60,
          opacity: 0,
          duration: 0.6,
          ease: 'power3.out',
          stagger: 0.04,
          scrollTrigger: { trigger: elemento, start: 'top 88%', once: true },
        }),
      );
    });

    // Bloques sueltos: aparecen al entrar en cuadro.
    raiz
      .querySelectorAll<HTMLElement>('.landing__texto, .stats, .modos, .cierre__acciones')
      .forEach((elemento) => {
        tweens.push(
          gsap.from(elemento, {
            y: 26,
            opacity: 0,
            duration: 0.75,
            ease: 'power2.out',
            scrollTrigger: { trigger: elemento, start: 'top 90%', once: true },
          }),
        );
      });

    // Dados: ruedan al entrar en cuadro y quedan apoyados en una cara.
    const dados = raiz.querySelectorAll<HTMLElement>('.dado');
    tweens.push(
      gsap.fromTo(
        dados,
        { rotationX: 0, rotationY: 0 },
        {
          rotationX: -740,
          rotationY: 380,
          duration: 1.5,
          ease: 'power3.out',
          stagger: 0.12,
          scrollTrigger: { trigger: '.dados', start: 'top 85%', once: true },
        },
      ),
    );

    ScrollTrigger.refresh();
  };

  // ---------------------------------------------------------------------------
  // Ciclo de vida
  // ---------------------------------------------------------------------------

  const alCambiarIdioma = (): void => {
    limpiarAnimaciones();
    construir();
    animar();
  };

  construir();
  // Primero al documento y despues las animaciones: ScrollTrigger mide
  // posiciones reales y no puede hacerlo con el arbol fuera del documento.
  document.body.append(raiz);
  animar();
  document.addEventListener(LOCALE_CHANGE_EVENT, alCambiarIdioma);

  return {
    dispose(): void {
      document.removeEventListener(LOCALE_CHANGE_EVENT, alCambiarIdioma);
      limpiarAnimaciones();
      raiz.remove();
      if (lienzo !== null) lienzo.style.display = displayLienzo;
      if (hud !== null) hud.style.display = displayHud;
      // Al volver al juego se empieza arriba, no donde quedo el scroll.
      window.scrollTo(0, 0);
    },
  };
}
