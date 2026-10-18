/**
 * HUD de partida local (Hito 4).
 *
 * Panel de jugadores, indicador de fase, botones contextuales que salen de lo
 * que el motor permite en cada fase, tarjetas y canje, dados de la ultima ronda
 * y log de eventos. No tiene logica de reglas: manda comandos por el
 * `GameTransport` y espera el estado nuevo.
 *
 * Los textos salen de `i18n` (ninguno hardcodeado) y los limites de la config
 * (`RulesConfig`), nunca de numeros escritos aca.
 */

import type { TerritoryId } from '@conqueror/shared';
import type { RulesConfig } from '@conqueror/shared';
import {
  buildClassicBoard,
  estimateBattleOdds,
  isValidTrade,
  type CardId,
  type GameEvent,
  type PublicGameState,
} from '@conqueror/rules';

import type { GameTransport } from '../net/transport.js';
import { t } from '../app/i18n.js';
import { textoMision } from './missionText.js';
import { boton, chip, deslizador, nodo, titulo } from './dom.js';

export interface GameHudHost {
  /** Nombre localizado de un territorio. */
  readonly nombres: (id: TerritoryId) => string;
  /** Adyacencia del tablero. */
  readonly adyacencia: Readonly<Record<TerritoryId, readonly TerritoryId[]>>;
  /** Reglas de la partida (limites y valores para mostrar). */
  readonly rules: RulesConfig;
  /** Jugadores que juega el bot. */
  readonly botIds: ReadonlySet<string>;
  readonly transport: GameTransport;
  /** El director de combate esta ocupado: no se aceptan acciones nuevas. */
  readonly busy: () => boolean;
  /** Salta la animacion en curso. */
  readonly onSkip: () => void;
  /** Vuelve a la pantalla de configuracion. */
  readonly onExit: () => void;
}

export interface GameHud {
  render(state: PublicGameState): void;
  /** Eventos nuevos desde el ultimo render (log y dados). */
  eventos(eventos: readonly GameEvent[]): void;
  /**
   * Pinta la seleccion que decidio otro componente (el clic sobre el mapa).
   * NO manda comandos: solo sincroniza lo que el panel muestra.
   */
  setSelection(selection: SelectionState): void;
  /**
   * Avisa cuando la seleccion cambia desde el HUD (chips de territorio), para
   * que el mapa dibuje el mismo origen y destino.
   */
  onSelection(callback: (selection: SelectionState) => void): void;
  /** Territorio bajo el puntero en el mapa, para el renglon de "apuntado". */
  setHover(territory: TerritoryId | null): void;
  /**
   * Probabilidad de conquista del ataque que el mapa esta previsualizando
   * (`null` si no hay ninguno). Se muestra junto al territorio apuntado para
   * que el jugador decida antes de hacer clic.
   */
  setAttackOdds(probability: number | null): void;
  /** Territorio solo mirado: muestra su nombre sin elegirlo como origen. */
  setFocus(territory: TerritoryId | null): void;
  /** Aviso efimero: explica por que una accion no fue posible. */
  aviso(texto: string): void;
  dispose(): void;
}

/** Seleccion que comparten el mapa y el HUD. */
export interface SelectionState {
  readonly origin: TerritoryId | null;
  readonly target: TerritoryId | null;
}

/** Estado de la interfaz (no de la partida): que esta eligiendo el jugador. */
interface EstadoUi {
  selected: TerritoryId | null;
  attackTo: TerritoryId | null;
  regFrom: TerritoryId | null;
  regTo: TerritoryId | null;
  /** Territorio solo mirado (clic en el mapa), sin quedar seleccionado. */
  foco: TerritoryId | null;
  placeCount: number;
  moveCount: number;
  cardSel: string[];
}

/** Tablero clasico, para los simbolos de las tarjetas (una sola vez). */
const BOARD = buildClassicBoard();

/** Texto de un evento para el log. */
function textoEvento(
  evento: GameEvent,
  nombres: (id: TerritoryId) => string,
  jugadores: (id: string) => string,
): string | null {
  switch (evento.type) {
    case 'ARMIES_PLACED':
      return `+${evento.count} ${nombres(evento.territory)}`;
    case 'ARMIES_MOVED':
      return `${evento.count}: ${nombres(evento.from)} → ${nombres(evento.to)}`;
    case 'BATTLE_ROUND_RESOLVED':
      return (
        `${nombres(evento.from)} [${evento.attackerDice.join(' ')}] vs ` +
        `${nombres(evento.to)} [${evento.defenderDice.join(' ')}] · ` +
        `-${evento.attackerLosses}/-${evento.defenderLosses}`
      );
    case 'TERRITORY_CONQUERED':
      return `¡${nombres(evento.territory)}!`;
    case 'CARD_DRAWN':
      return `${jugadores(evento.player)}: +1 tarjeta`;
    case 'CARDS_TRADED':
      return `Canje: +${evento.armies}`;
    case 'PLAYER_ELIMINATED':
      return `${jugadores(evento.player)}: fuera`;
    case 'TURN_CHANGED':
      return `Turno de ${jugadores(evento.player)}`;
    case 'GAME_WON':
      return `¡${jugadores(evento.player)}!`;
    default:
      return null;
  }
}

/** Fases, para el indicador. */
const FASES: Readonly<Record<string, string>> = {
  'setup-placement': 'hud.fase.despliegue',
  reinforce: 'hud.fase.refuerzo',
  attack: 'hud.fase.ataque',
  'conquest-move': 'hud.fase.conquista',
  regroup: 'hud.fase.reagrupe',
  'game-over': 'hud.fase.fin',
};

export function createGameHud(contenedor: HTMLElement, host: GameHudHost): GameHud {
  const ui: EstadoUi = {
    selected: null,
    attackTo: null,
    regFrom: null,
    regTo: null,
    foco: null,
    placeCount: 1,
    moveCount: 1,
    cardSel: [],
  };
  const log: string[] = [];
  let ultimaRonda: Extract<GameEvent, { type: 'BATTLE_ROUND_RESOLVED' }> | null = null;
  let estado: PublicGameState | null = null;

  const selectionListeners = new Set<(selection: SelectionState) => void>();
  /** Ultima seleccion emitida, para no repetir avisos identicos. */
  let ultimaEmision: SelectionState = { origin: null, target: null };
  /** Renglon de "apuntado": se actualiza sin re-renderizar todo el panel. */
  let nodoHover: HTMLElement | null = null;
  let hoverTerritory: TerritoryId | null = null;
  /** Probabilidad del ataque previsualizado por el mapa, si hay. */
  let hoverOdds: number | null = null;
  /** Aviso efimero vigente (texto y vencimiento). */
  let avisoTexto = '';
  let avisoHasta = 0;
  let nodoAviso: HTMLElement | null = null;

  const emitirSeleccion = (): void => {
    const actual: SelectionState = { origin: ui.selected, target: ui.attackTo };
    if (actual.origin === ultimaEmision.origin && actual.target === ultimaEmision.target) return;
    ultimaEmision = actual;
    for (const listener of selectionListeners) listener(actual);
  };

  /** Texto del renglon de "apuntado" segun el estado actual. */
  const textoHover = (): string => {
    if (hoverTerritory === null || estado === null) return '';
    const territorio = estado.territories[hoverTerritory];
    if (territorio === undefined) return '';
    const dueno = estado.players.find((player) => player.id === territorio.owner);
    const base = `${host.nombres(hoverTerritory)} · ${dueno?.name ?? t('hud.sinDueno')} · ${territorio.armies} ${t('hud.ejercitos')}`;
    if (hoverOdds === null) return base;
    return `${base} · ${t('hud.odds', { valor: Math.round(hoverOdds * 100) })}`;
  };

  const pintarHover = (): void => {
    if (nodoHover === null) return;
    const texto = textoHover();
    nodoHover.textContent = texto;
    nodoHover.classList.toggle('hidden', texto === '');
  };

  const pintarAviso = (): void => {
    if (nodoAviso === null) return;
    const vigente = avisoTexto !== '' && Date.now() < avisoHasta;
    nodoAviso.textContent = vigente ? avisoTexto : '';
    nodoAviso.classList.toggle('hidden', !vigente);
  };

  // ---------------------------------------------------------------------------
  // Partes
  // ---------------------------------------------------------------------------

  const nombreJugador = (id: string): string =>
    estado?.players.find((player) => player.id === id)?.name ?? id;

  function barra(state: PublicGameState): HTMLElement {
    const barra = nodo(
      'header',
      'pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-lana-3/60 bg-hilo/80 px-3 py-2 backdrop-blur-sm sm:px-4',
    );
    barra.dataset['fase'] = state.phase;
    barra.dataset['turno'] = String(state.turn);
    barra.dataset['activo'] = state.activePlayer;

    const marca = nodo('h1', 'font-display text-base tracking-wide text-qolli', 'Conqueror');
    const fase = nodo(
      'span',
      'rounded border border-qolli/60 bg-qolli/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-qolli',
      t(FASES[state.phase] ?? 'hud.fase.despliegue'),
    );
    const turno = nodo('span', 'text-[11px] text-algodon/55', `T${state.turn}`);

    const jugadores = nodo('div', 'flex flex-wrap items-center gap-1.5');
    for (const player of state.players) {
      const activo = player.id === state.activePlayer;
      const c = nodo(
        'span',
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ' +
          (activo
            ? 'border-qolli bg-qolli/15 text-qolli'
            : 'border-lana-3 text-algodon/60' +
              (player.eliminated ? ' line-through opacity-50' : '')),
      );
      const punto = nodo('span', 'inline-block h-2.5 w-2.5 rounded-full');
      punto.style.backgroundColor = `#${colorDe(player.color)}`;
      c.append(punto, nodo('span', 'font-semibold', player.name));
      c.append(
        nodo(
          'span',
          'text-algodon/50',
          `${player.territories}${t('hud.territorios')} ${player.armies}${t('hud.ejercitos')}`,
        ),
      );
      if (host.botIds.has(player.id)) c.append(nodo('span', 'text-[10px] text-grana', 'bot'));
      jugadores.append(c);
    }

    const acciones = nodo('div', 'ml-auto flex items-center gap-2');
    if (host.busy()) {
      acciones.append(boton(t('accion.saltar'), host.onSkip, { pequeno: true }));
    }
    acciones.append(
      boton(t('accion.salir'), host.onExit, { pequeno: true, dato: { accion: 'salir' } }),
    );

    barra.append(marca, fase, turno, jugadores, acciones);
    return barra;
  }

  function panelJugadores(state: PublicGameState): HTMLElement {
    const panel = nodo(
      'aside',
      'pointer-events-auto w-60 shrink-0 space-y-3 rounded-lg border border-lana-3/70 bg-lana/85 p-3 text-sm shadow-xl shadow-hilo/50 backdrop-blur-sm sm:w-64',
    );
    // En el telefono el panel solo lleva lo que la barra no muestra (mision y
    // tarjetas): la lista de jugadores esta arriba, en la barra.
    panel.classList.add('max-sm:w-full', 'max-sm:max-w-sm');

    const activo = state.players.find((player) => player.id === state.activePlayer);

    const tituloJugadores = titulo(t('hud.jugadores'));
    tituloJugadores.classList.add('hidden', 'sm:block');
    panel.append(tituloJugadores);
    // En un telefono la barra superior ya muestra a cada jugador con sus
    // territorios y ejercitos: repetir la lista aca se come media pantalla y
    // tapa el mapa. Se oculta solo en pantallas chicas.
    const lista = nodo('ul', 'mt-2 hidden space-y-1 sm:block');
    for (const player of state.players) {
      const fila = nodo(
        'li',
        'flex items-center gap-2 rounded px-1.5 py-1 ' +
          (player.id === state.activePlayer ? 'bg-qolli/10' : ''),
      );
      const punto = nodo('span', 'inline-block h-2.5 w-2.5 shrink-0 rounded-full');
      punto.style.backgroundColor = `#${colorDe(player.color)}`;
      fila.append(
        punto,
        nodo('span', 'min-w-0 flex-1 truncate text-algodon/85', player.name),
        nodo(
          'span',
          'shrink-0 text-[11px] text-algodon/50',
          `${player.territories}${t('hud.territorios')} · ${player.armies}${t('hud.ejercitos')}`,
        ),
      );
      lista.append(fila);
    }
    panel.append(lista);

    // Mision propia (solo si la partida usa misiones secretas).
    if (activo !== undefined && state.ownMission !== null) {
      const mision = nodo('div', 'rounded border border-lana-3/60 bg-hilo/50 p-2');
      mision.append(titulo(t('hud.mision')));
      mision.append(
        nodo(
          'p',
          'mt-1 text-[12px] leading-relaxed text-algodon/80',
          textoMision(state.ownMission, host.nombres),
        ),
      );
      panel.append(mision);
    }

    // Tarjetas propias y canje.
    const tarjetas = nodo('div');
    tarjetas.append(titulo(`${t('hud.tarjetas')} (${state.ownCards.length})`));
    if (state.ownCards.length > 0) {
      const mano = nodo('div', 'mt-1.5 flex flex-wrap gap-1');
      for (const carta of state.ownCards) {
        const elegida = ui.cardSel.includes(carta);
        mano.append(
          chip(
            etiquetaCarta(carta as CardId),
            () => {
              if (elegida) ui.cardSel = ui.cardSel.filter((id) => id !== carta);
              else if (ui.cardSel.length < 3) ui.cardSel.push(carta);
              render(estado as PublicGameState);
            },
            { activo: elegida },
          ),
        );
      }
      tarjetas.append(mano);

      const puede = isValidTrade(ui.cardSel, BOARD);
      const canje = nodo('div', 'mt-2');
      canje.append(
        boton(
          t('accion.canjear'),
          () => {
            if (ui.cardSel.length !== 3) return;
            const [a, b, c] = ui.cardSel;
            if (a === undefined || b === undefined || c === undefined) return;
            void host.transport.send({ type: 'TRADE_CARDS', cardIds: [a, b, c] });
            ui.cardSel = [];
            render(estado as PublicGameState);
          },
          {
            primario: true,
            pequeno: true,
            deshabilitado: !puede || host.busy(),
            dato: { accion: 'canjear' },
          },
        ),
      );
      tarjetas.append(canje);
    }
    panel.append(tarjetas);

    // Log de eventos.
    if (log.length > 0) {
      const registro = nodo(
        'div',
        'max-h-40 overflow-y-auto rounded border border-lana-3/60 bg-hilo/60 p-2 font-mono text-[10px] leading-relaxed text-algodon/70',
      );
      for (const linea of log.slice(-14)) registro.append(nodo('div', '', linea));
      // El registro se lee de abajo hacia arriba: lo ultimo que paso tiene que
      // quedar a la vista sin que el jugador tenga que scrollear.
      requestAnimationFrame(() => {
        registro.scrollTop = registro.scrollHeight;
      });
      panel.append(titulo(t('hud.log')), registro);
    }

    return panel;
  }

  function etiquetaCarta(carta: CardId): string {
    const territorio = BOARD.territories.includes(carta) ? host.nombres(carta) : t('hud.comodin');
    const indice = BOARD.territories.indexOf(carta);
    const simbolo = indice < 0 ? '★' : ((['⚓', '●', '✚'] as const)[indice % 3] ?? '?');
    return `${simbolo} ${territorio}`;
  }

  /** Territorios propios alcanzables solo por territorios propios. */
  function propiosAlcanzables(state: PublicGameState, desde: TerritoryId): TerritoryId[] {
    const propios = new Set(territoriosPropios(state));
    const visitados = new Set<TerritoryId>([desde]);
    const cola: TerritoryId[] = [desde];
    const resultado: TerritoryId[] = [];
    while (cola.length > 0) {
      const actual = cola.shift() as TerritoryId;
      for (const vecino of host.adyacencia[actual] ?? []) {
        if (visitados.has(vecino) || !propios.has(vecino)) continue;
        visitados.add(vecino);
        resultado.push(vecino);
        cola.push(vecino);
      }
    }
    return resultado;
  }

  function panelAcciones(state: PublicGameState): HTMLElement {
    const panel = nodo(
      'section',
      // En el telefono el panel se limita en alto y scrollea por dentro: si
      // crece con la lista de territorios, tapa el mapa que hay que tocar.
      'pointer-events-auto max-h-[46vh] w-full max-w-sm space-y-3 overflow-y-auto rounded-lg border border-lana-3/70 bg-lana/85 p-3 text-sm shadow-xl shadow-hilo/50 backdrop-blur-sm sm:max-h-none',
    );
    const ocupado = host.busy();

    if (ocupado) {
      panel.append(nodo('p', 'text-[12px] text-qolli', t('hud.batallaEnCurso')));
    }

    // Aviso efimero: por que el ultimo clic no hizo nada.
    nodoAviso = nodo(
      'p',
      'hidden rounded border border-grana/70 bg-grana/15 px-2 py-1 text-[11px] text-algodon',
    );
    nodoAviso.setAttribute('role', 'status');
    panel.append(nodoAviso);
    pintarAviso();

    // Renglon de "apuntado": nombre del territorio bajo el puntero. Se
    // actualiza sin re-renderizar, asi sigue al mouse sin parpadeos.
    nodoHover = nodo('p', 'hidden text-[11px] text-algodon/60');
    panel.append(nodoHover);
    pintarHover();

    // --- Detalle del territorio ----------------------------------------------
    // Se muestra el territorio elegido como origen; si no hay ninguno, el que
    // el jugador acaba de tocar en el mapa (aunque no se pueda elegir, su
    // nombre tiene que verse).
    const mostrado = ui.selected ?? ui.foco;
    if (mostrado !== null) {
      const detalle = nodo('div', 'rounded border border-lana-3/60 bg-hilo/50 p-2');
      const territorio = state.territories[mostrado];
      const dueno = territorio?.owner ?? null;
      const jugador = state.players.find((player) => player.id === dueno);
      const esOrigen =
        ui.selected !== null && (state.phase === 'attack' || state.phase === 'regroup');
      detalle.append(
        titulo(esOrigen ? t('hud.origen') : t('hud.territorio')),
        nodo(
          'p',
          'mt-1 text-sm text-algodon',
          `${host.nombres(mostrado)} · ${jugador?.name ?? t('hud.sinDueno')} · ${territorio?.armies ?? 0} ${t('hud.ejercitos')}`,
        ),
      );
      if (esOrigen) {
        detalle.append(
          nodo(
            'p',
            'mt-0.5 text-[11px] text-algodon/55',
            ui.attackTo === null ? t('hud.ayuda.destino') : t('hud.ayuda.confirmar'),
          ),
        );
      }
      panel.append(detalle);
    }

    // --- Acciones por fase ------------------------------------------------------
    const cuerpo = nodo('div', 'space-y-3');

    if (state.phase === 'setup-placement' || state.phase === 'reinforce') {
      // Colocar ejercitos.
      const propios = territoriosPropios(state);
      cuerpo.append(titulo(`${t('hud.colocar')} · ${t('hud.faltan', { n: state.armiesToPlace })}`));
      const fichas = nodo('div', 'mt-1 flex flex-wrap gap-1');
      for (const id of propios) {
        fichas.append(
          chip(
            `${host.nombres(id)} (${state.territories[id]?.armies ?? 0})`,
            () => {
              ui.selected = id;
              render(state);
            },
            { activo: ui.selected === id, dato: { territorio: id } },
          ),
        );
      }
      cuerpo.append(fichas);

      const topeRonda = state.placementAllowance ?? Number.POSITIVE_INFINITY;
      const maximo = Math.max(1, Math.min(state.armiesToPlace, topeRonda));
      if (ui.placeCount > maximo) ui.placeCount = maximo;
      // Sin cupo (ronda agotada o sin ejercitos) no hay jugada legal: ofrecer el
      // boton haria que el motor lo rechazara.
      const sinCupo =
        state.armiesToPlace <= 0 ||
        (state.placementAllowance !== null && state.placementAllowance <= 0);
      if (ui.selected !== null && propios.includes(ui.selected)) {
        const slider = deslizador(1, maximo, ui.placeCount, (valor) => {
          ui.placeCount = valor;
        });
        const fila = nodo('div', 'mt-2 space-y-2');
        fila.append(nodo('span', 'text-[11px] text-algodon/50', t('hud.cantidad')));
        fila.append(slider.elemento);
        const botones = nodo('div', 'flex gap-2');
        botones.append(
          boton(
            t('accion.colocar'),
            () => {
              if (ui.selected === null) return;
              void host.transport.send({
                type: 'PLACE_ARMIES',
                territory: ui.selected,
                count: ui.placeCount,
              });
            },
            { primario: true, deshabilitado: ocupado || sinCupo, dato: { accion: 'colocar' } },
          ),
          boton(
            t('accion.colocarTodo'),
            () => {
              if (ui.selected === null) return;
              void host.transport.send({
                type: 'PLACE_ARMIES',
                territory: ui.selected,
                count: maximo,
              });
            },
            { deshabilitado: ocupado || sinCupo, dato: { accion: 'colocar-todo' } },
          ),
        );
        fila.append(botones);
        cuerpo.append(fila);
      }
    }

    if (state.phase === 'attack') {
      cuerpo.append(titulo(t('hud.ataque')));
      if (ui.selected === null) {
        cuerpo.append(nodo('p', 'text-[11px] text-algodon/55', t('hud.ayuda.origen')));
      }
      if (ultimaRonda !== null) {
        const rondabox = nodo(
          'div',
          'rounded border border-lana-3/60 bg-hilo/50 p-2 text-[12px] text-algodon/80',
        );
        rondabox.append(
          nodo(
            'p',
            '',
            `${host.nombres(ultimaRonda.from)} [${ultimaRonda.attackerDice.join(' ')}] vs ${host.nombres(ultimaRonda.to)} [${ultimaRonda.defenderDice.join(' ')}]`,
          ),
          nodo(
            'p',
            'text-algodon/55',
            `-${ultimaRonda.attackerLosses} / -${ultimaRonda.defenderLosses} · ${ultimaRonda.attackerArmiesAfter} vs ${ultimaRonda.defenderArmiesAfter}`,
          ),
        );
        cuerpo.append(rondabox);
      }

      const origenes = territoriosPropios(state).filter(
        (id) => (state.territories[id]?.armies ?? 0) > host.rules.combat.minArmiesPerTerritory,
      );
      const fichasOrigen = nodo('div', 'mt-1 flex flex-wrap gap-1');
      for (const id of origenes) {
        fichasOrigen.append(
          chip(
            `${host.nombres(id)} (${state.territories[id]?.armies ?? 0})`,
            () => {
              ui.selected = id;
              ui.attackTo = null;
              render(state);
            },
            { activo: ui.selected === id, dato: { territorio: id, ataque: 'origen' } },
          ),
        );
      }
      cuerpo.append(fichasOrigen);

      const origen = ui.selected;
      if (origen !== null && origenes.includes(origen)) {
        const ejercitos = state.territories[origen]?.armies ?? 0;
        const destinos = (host.adyacencia[origen] ?? []).filter(
          (vecino) => (state.territories[vecino]?.owner ?? null) !== state.activePlayer,
        );
        const fichasDestino = nodo('div', 'mt-2 flex flex-wrap gap-1');
        for (const id of destinos) {
          fichasDestino.append(
            chip(
              `${host.nombres(id)} (${state.territories[id]?.armies ?? 0})`,
              () => {
                ui.attackTo = id;
                render(state);
              },
              { activo: ui.attackTo === id, dato: { territorio: id, ataque: 'destino' } },
            ),
          );
        }
        cuerpo.append(nodo('span', 'text-[11px] text-algodon/50', t('hud.destino')), fichasDestino);

        if (ui.attackTo !== null && destinos.includes(ui.attackTo)) {
          const defensoras = state.territories[ui.attackTo]?.armies ?? 0;
          const odds = estimateBattleOdds(ejercitos, defensoras, host.rules);
          const dadosDisponibles = Math.max(
            1,
            Math.min(host.rules.combat.maxAttackerDice, ejercitos - 1),
          );
          ui.moveCount = Math.min(Math.max(ui.moveCount, 1), dadosDisponibles);
          const slider = deslizador(1, dadosDisponibles, ui.moveCount, (valor) => {
            ui.moveCount = valor;
          });
          const fila = nodo('div', 'mt-2 space-y-2');
          fila.append(
            nodo(
              'p',
              'text-[12px] text-qolli',
              t('hud.probabilidad', { valor: Math.round(odds.winProbability * 100) }),
            ),
            nodo('span', 'text-[11px] text-algodon/50', t('hud.dados')),
            slider.elemento,
            boton(
              t('accion.atacar'),
              () => {
                if (ui.selected === null || ui.attackTo === null) return;
                void host.transport.send({
                  type: 'ATTACK',
                  from: ui.selected,
                  to: ui.attackTo,
                  dice: ui.moveCount as 1 | 2 | 3,
                });
                ui.attackTo = null;
              },
              { primario: true, deshabilitado: ocupado, dato: { accion: 'atacar' } },
            ),
          );
          cuerpo.append(fila);
        }
      }
    }

    if (state.phase === 'conquest-move' && state.pendingConquest !== null) {
      const pendiente = state.pendingConquest;
      cuerpo.append(
        titulo(t('hud.moverConquista')),
        nodo(
          'p',
          'text-[12px] text-algodon/80',
          `${host.nombres(pendiente.from)} → ${host.nombres(pendiente.to)}`,
        ),
      );
      const maximo = Math.max(1, pendiente.max);
      ui.moveCount = Math.min(Math.max(ui.moveCount, pendiente.min), maximo);
      const slider = deslizador(pendiente.min, maximo, ui.moveCount, (valor) => {
        ui.moveCount = valor;
      });
      const fila = nodo('div', 'mt-2 space-y-2');
      fila.append(
        slider.elemento,
        boton(
          t('accion.mover'),
          () => {
            void host.transport.send({ type: 'MOVE_AFTER_CONQUEST', count: ui.moveCount });
          },
          { primario: true, deshabilitado: ocupado, dato: { accion: 'mover' } },
        ),
      );
      cuerpo.append(fila);
    }

    if (state.phase === 'regroup') {
      cuerpo.append(titulo(t('hud.reagrupar')));
      const propios = territoriosPropios(state);
      const fichas = nodo('div', 'mt-1 flex flex-wrap gap-1');
      for (const id of propios) {
        fichas.append(
          chip(
            `${host.nombres(id)} (${state.territories[id]?.armies ?? 0})`,
            () => {
              ui.regFrom = id;
              ui.regTo = null;
              render(state);
            },
            { activo: ui.regFrom === id, dato: { territorio: id, reagrupe: 'origen' } },
          ),
        );
      }
      cuerpo.append(fichas);

      const desde = ui.regFrom;
      if (desde !== null && (state.territories[desde]?.armies ?? 0) > 1) {
        const destinos = propiosAlcanzables(state, desde).filter((id) => id !== desde);
        const fichasDestino = nodo('div', 'mt-2 flex flex-wrap gap-1');
        for (const id of destinos) {
          fichasDestino.append(
            chip(
              host.nombres(id),
              () => {
                ui.regTo = id;
                render(state);
              },
              { activo: ui.regTo === id, dato: { territorio: id, reagrupe: 'destino' } },
            ),
          );
        }
        cuerpo.append(nodo('span', 'text-[11px] text-algodon/50', t('hud.destino')), fichasDestino);

        if (ui.regTo !== null && destinos.includes(ui.regTo)) {
          const disponibles = (state.territories[desde]?.armies ?? 1) - 1;
          ui.moveCount = Math.min(Math.max(ui.moveCount, 1), disponibles);
          const slider = deslizador(1, disponibles, ui.moveCount, (valor) => {
            ui.moveCount = valor;
          });
          const fila = nodo('div', 'mt-2 space-y-2');
          fila.append(
            slider.elemento,
            boton(
              t('accion.mover'),
              () => {
                if (ui.regFrom === null || ui.regTo === null) return;
                void host.transport.send({
                  type: 'REGROUP',
                  from: ui.regFrom,
                  to: ui.regTo,
                  count: ui.moveCount,
                });
                ui.regFrom = null;
                ui.regTo = null;
              },
              { primario: true, deshabilitado: ocupado, dato: { accion: 'reagrupar' } },
            ),
          );
          cuerpo.append(fila);
        }
      }
    }

    panel.append(cuerpo);

    // --- Botones de fase ----------------------------------------------------------
    const faseBotones = nodo('div', 'flex flex-wrap gap-2 border-t border-lana-3/60 pt-3');
    const canjeObligatorio =
      state.phase === 'reinforce' &&
      host.rules.cards.forcedTradeAt > 0 &&
      state.ownCards.length >= host.rules.cards.forcedTradeAt;

    if (state.phase === 'reinforce') {
      faseBotones.append(
        boton(t('accion.pasarAtaque'), () => void host.transport.send({ type: 'END_PHASE' }), {
          deshabilitado: ocupado || state.armiesToPlace > 0 || canjeObligatorio,
          dato: { accion: 'fin-fase' },
        }),
      );
    }
    if (state.phase === 'attack') {
      faseBotones.append(
        boton(t('accion.pasarRegrupe'), () => void host.transport.send({ type: 'END_PHASE' }), {
          deshabilitado: ocupado,
          dato: { accion: 'fin-fase' },
        }),
        boton(t('accion.finTurno'), () => void host.transport.send({ type: 'END_TURN' }), {
          deshabilitado: ocupado,
          dato: { accion: 'fin-turno' },
        }),
      );
    }
    if (state.phase === 'regroup') {
      faseBotones.append(
        boton(t('accion.finTurno'), () => void host.transport.send({ type: 'END_TURN' }), {
          deshabilitado: ocupado,
          dato: { accion: 'fin-turno' },
        }),
      );
    }
    if (state.phase !== 'game-over' && state.phase !== 'setup-placement') {
      faseBotones.append(
        boton(t('accion.rendirse'), () => void host.transport.send({ type: 'SURRENDER' }), {
          pequeno: true,
          deshabilitado: ocupado,
          dato: { accion: 'rendirse' },
        }),
      );
    }
    panel.append(faseBotones);
    return panel;
  }

  /** Territorios propios del jugador de turno. */
  function territoriosPropios(state: PublicGameState): TerritoryId[] {
    return Object.entries(state.territories)
      .filter(([, valor]) => valor.owner === state.activePlayer)
      .map(([id]) => id as TerritoryId);
  }

  function panelFinal(state: PublicGameState): HTMLElement {
    const panel = nodo(
      'section',
      'pointer-events-auto w-full max-w-sm rounded-lg border border-qolli/70 bg-lana/90 p-5 text-center shadow-xl',
    );
    panel.dataset['resultado'] = 'fin';
    const ganador = state.players.find((player) => player.id === state.winner);
    const pie = nodo('div', 'mt-4 flex justify-center');
    pie.append(boton(t('accion.volver'), host.onExit, { primario: true }));
    panel.append(
      nodo('h2', 'font-display text-2xl text-qolli', t('hud.victoria')),
      nodo('p', 'mt-2 text-sm text-algodon/80', ganador?.name ?? '-'),
      pie,
    );
    return panel;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  function render(state: PublicGameState | null): void {
    estado = state;
    contenedor.replaceChildren();
    nodoHover = null;
    nodoAviso = null;
    if (state === null) return;

    const barraEl = barra(state);
    const cuerpo = nodo(
      'div',
      // En el telefono los paneles van uno arriba y otro abajo, para dejar el
      // centro libre: ahi esta el mapa y es lo que hay que poder tocar.
      'flex min-h-0 flex-1 flex-col justify-between gap-3 overflow-y-auto p-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:p-4',
    );
    cuerpo.append(panelJugadores(state));

    if (state.phase === 'game-over') {
      cuerpo.append(panelFinal(state));
    } else {
      cuerpo.append(panelAcciones(state));
    }

    contenedor.append(barraEl, cuerpo);

    // La seleccion se publica al final del render: asi el mapa se entera de
    // los cambios hechos con los chips, sin que cada handler tenga que avisar.
    emitirSeleccion();
  }

  return {
    render,
    eventos(eventos: readonly GameEvent[]): void {
      for (const evento of eventos) {
        if (evento.type === 'BATTLE_ROUND_RESOLVED') ultimaRonda = evento;
        const texto = textoEvento(evento, host.nombres, nombreJugador);
        if (texto !== null) log.push(texto);
      }
      while (log.length > 60) log.shift();
    },
    setSelection(selection: SelectionState): void {
      const igual = ui.selected === selection.origin && ui.attackTo === selection.target;
      if (igual) return;
      ui.selected = selection.origin;
      ui.attackTo = selection.target;
      render(estado);
    },
    onSelection(callback: (selection: SelectionState) => void): void {
      selectionListeners.add(callback);
    },
    setHover(territory: TerritoryId | null): void {
      if (territory === hoverTerritory) return;
      hoverTerritory = territory;
      pintarHover();
    },
    setAttackOdds(probability: number | null): void {
      if (probability === hoverOdds) return;
      hoverOdds = probability;
      pintarHover();
    },
    setFocus(territory: TerritoryId | null): void {
      if (ui.foco === territory) return;
      ui.foco = territory;
      render(estado);
    },
    aviso(texto: string): void {
      avisoTexto = texto;
      avisoHasta = Date.now() + 2600;
      pintarAviso();
      window.setTimeout(pintarAviso, 2700);
    },
    dispose(): void {
      selectionListeners.clear();
      contenedor.replaceChildren();
    },
  };
}

/** Hex de color de jugador (duplicado chico a proposito: el HUD no depende de three). */
function colorDe(color: string): string {
  const hex: Readonly<Record<string, string>> = {
    rojo: 'c0392b',
    azul: '2f6fb5',
    amarillo: 'e2a72e',
    verde: '2f6b4f',
    negro: '16181d',
    magenta: 'a03a8c',
  };
  return hex[color] ?? 'c0392b';
}
