/**
 * Modelo de seleccion del tablero.
 *
 * Traduce un clic sobre un territorio a una INTENCION. Es una funcion pura y
 * sin dependencias de three ni del DOM, por dos motivos:
 *
 *   - la escena no decide reglas: solo dibuja lo que este modelo concluye;
 *   - se puede testear el flujo completo de clics (origen, destino, ataque,
 *     reagrupe) sin levantar un canvas.
 *
 * El estado que recibe es el PUBLICO del motor (`PublicGameState`): el mismo
 * que ve el HUD. Asi el clic y los botones del HUD no pueden divergir.
 */

import type { RulesConfig, TerritoryId } from '@conqueror/shared';
import type { Phase } from '@conqueror/rules';

/** Territorio tal como lo ve el jugador (dueno y ejercitos). */
export interface TerritoryView {
  readonly owner: string | null;
  readonly armies: number;
}

/** Lo que el jugador tiene elegido en este momento. */
export interface SelectionState {
  /** Origen: territorio propio desde el que se actua. */
  readonly origin: TerritoryId | null;
  /** Destino: segundo territorio de la accion (ataque o reagrupe). */
  readonly target: TerritoryId | null;
}

export const SIN_SELECCION: SelectionState = { origin: null, target: null };

/** Por que un clic no produjo accion. El HUD lo usa para explicar el rechazo. */
export type MotivoInvalido = 'not-adjacent' | 'not-reachable' | 'no-armies' | 'not-own';

export type PickIntent =
  /** No hay nada bajo el puntero (mar, fuera del tablero). */
  | { readonly kind: 'none' }
  /** Solo mostrar el detalle del territorio, sin cambiar la seleccion. */
  | { readonly kind: 'inspect'; readonly territory: TerritoryId }
  /** Elegir origen (o cambiar de origen). */
  | { readonly kind: 'select-origin'; readonly territory: TerritoryId }
  /** Elegir destino para una accion ya iniciada. */
  | { readonly kind: 'select-target'; readonly territory: TerritoryId }
  /** Quitar la seleccion (clic sobre el origen ya elegido). */
  | { readonly kind: 'clear' }
  /** Atacar de verdad. */
  | { readonly kind: 'attack'; readonly from: TerritoryId; readonly to: TerritoryId }
  /** El clic tenia sentido pero no es legal; se avisa y no se manda nada. */
  | { readonly kind: 'invalid'; readonly reason: MotivoInvalido };

export interface PickContext {
  readonly phase: Phase;
  readonly activePlayer: string;
  readonly territories: Readonly<Record<TerritoryId, TerritoryView>>;
  readonly adjacency: Readonly<Record<TerritoryId, readonly TerritoryId[]>>;
  readonly rules: RulesConfig;
  readonly selection: SelectionState;
}

/** True si `to` es vecino directo de `from`. */
function esVecino(ctx: PickContext, from: TerritoryId, to: TerritoryId): boolean {
  return (ctx.adjacency[from] ?? []).includes(to);
}

/** Ejercitos que hacen falta para poder atacar desde un territorio. */
function minimoParaAtacar(ctx: PickContext): number {
  // El motor exige `minArmiesPerTerritory + 1` para tirar al menos un dado.
  return ctx.rules.combat.minArmiesPerTerritory;
}

/**
 * Territorios propios alcanzables desde `desde` moviendo solo por territorios
 * propios (regla de reagrupe del motor).
 */
export function propiosAlcanzables(ctx: PickContext, desde: TerritoryId): readonly TerritoryId[] {
  const propios = new Set<TerritoryId>();
  for (const [id, territorio] of Object.entries(ctx.territories)) {
    if (territorio.owner === ctx.activePlayer) propios.add(id as TerritoryId);
  }
  if (!propios.has(desde)) return [];

  const visitados = new Set<TerritoryId>([desde]);
  const cola: TerritoryId[] = [desde];
  const resultado: TerritoryId[] = [];
  while (cola.length > 0) {
    const actual = cola.shift() as TerritoryId;
    for (const vecino of ctx.adjacency[actual] ?? []) {
      if (visitados.has(vecino) || !propios.has(vecino)) continue;
      visitados.add(vecino);
      resultado.push(vecino);
      cola.push(vecino);
    }
  }
  return resultado;
}

/**
 * Decide que hacer con un clic. `territory === null` significa que el puntero
 * no toco el tablero.
 */
export function resolverClic(ctx: PickContext, territory: TerritoryId | null): PickIntent {
  if (territory === null) return { kind: 'clear' };

  const estado = ctx.territories[territory];
  if (estado === undefined) return { kind: 'none' };

  const esPropio = estado.owner === ctx.activePlayer;
  const { origin } = ctx.selection;

  switch (ctx.phase) {
    case 'attack': {
      // Territorio propio: se convierte en origen. Clic sobre el mismo origen
      // quita la seleccion (gesto natural para "cancelar").
      if (esPropio) {
        if (origin === territory) return { kind: 'clear' };
        if (estado.armies <= minimoParaAtacar(ctx)) return { kind: 'inspect', territory };
        return { kind: 'select-origin', territory };
      }

      // Territorio ajeno (o neutral): si hay origen y es vecino, se ataca.
      // OJO: los neutrales son atacables por el motor, asi que no se excluyen.
      if (origin === null) return { kind: 'inspect', territory };
      if (origin === territory) return { kind: 'inspect', territory };
      if (!esVecino(ctx, origin, territory)) return { kind: 'invalid', reason: 'not-adjacent' };
      const origen = ctx.territories[origin];
      if (origen === undefined || origen.armies <= minimoParaAtacar(ctx)) {
        return { kind: 'invalid', reason: 'no-armies' };
      }
      return { kind: 'attack', from: origin, to: territory };
    }

    case 'reinforce':
    case 'setup-placement': {
      // Aca el clic solo elige donde colocar: no hay destino.
      if (!esPropio) return { kind: 'inspect', territory };
      if (origin === territory) return { kind: 'clear' };
      return { kind: 'select-origin', territory };
    }

    case 'regroup': {
      if (!esPropio) return { kind: 'inspect', territory };
      if (origin === null) return { kind: 'select-origin', territory };
      if (origin === territory) return { kind: 'clear' };
      if (!propiosAlcanzables(ctx, origin).includes(territory)) {
        return { kind: 'invalid', reason: 'not-reachable' };
      }
      return { kind: 'select-target', territory };
    }

    // En conquest-move el movimiento lo fija el motor (`pendingConquest`): el
    // clic solo sirve para mirar. En game-over no hay nada que hacer.
    case 'conquest-move':
    case 'game-over':
    default:
      return { kind: 'inspect', territory };
  }
}

/**
 * Dados con los que atacar desde `origin` cuando el jugador hace el gesto
 * rapido de "origen y destino": el maximo permitido, que es lo que espera
 * quien hace dos clics seguidos. El HUD, en cambio, deja elegir con el
 * deslizador.
 */
export function dadosMaximos(armies: number, rules: RulesConfig): 1 | 2 | 3 {
  const disponibles = Math.max(0, armies - 1);
  const dados = Math.max(1, Math.min(rules.combat.maxAttackerDice, disponibles));
  return dados as 1 | 2 | 3;
}
