/**
 * Texto de las misiones secretas para el HUD.
 *
 * Vive fuera del HUD para poder testearse sin DOM: el bug de "y 0 territorios
 * mas" salia de aca, y es el tipo de error que solo se ve jugando si no hay un
 * test que lo mire.
 *
 * Reglas del texto:
 *   - el numero extra solo aparece cuando es mayor que cero;
 *   - "1 territorio" va en singular;
 *   - las listas se unen con la conjuncion del idioma ("A, B y C" / "A, B and C").
 */

import type { SecretMission, TerritoryId } from '@conqueror/shared';

import { t } from '../app/i18n.js';

/** Une una lista con la conjuncion del idioma activo. */
export function unirLista(items: readonly string[]): string {
  const limpios = items.filter((item) => item !== '');
  const primero = limpios[0];
  if (primero === undefined) return '';
  if (limpios.length === 1) return primero;
  const ultimo = limpios[limpios.length - 1] as string;
  return t('lista.y', { resto: limpios.slice(0, -1).join(', '), ultimo });
}

/** Texto de una mision secreta, listo para mostrar. */
export function textoMision(mision: SecretMission, nombres: (id: TerritoryId) => string): string {
  switch (mision.kind) {
    case 'conquer-continents': {
      const continentes = unirLista(
        mision.continents.map((continent) => t(`continente.${continent}`)),
      );
      const extra = mision.extraTerritories;
      // El caso normal es extra = 0: la mision es solo conquistar continentes.
      if (extra <= 0) return t('mision.continentes.sinExtra', { continentes });
      if (extra === 1) return t('mision.continentes.uno', { continentes });
      return t('mision.continentes', { continentes, extra });
    }
    case 'eliminate-player':
      return t('mision.eliminar', { color: t(`color.${mision.targetColor}`) });
    case 'conquer-territories':
      return mision.count === 1
        ? t('mision.territorios.uno')
        : t('mision.territorios', { cantidad: mision.count });
    case 'own-territories':
      return t('mision.propios', {
        territorios: unirLista(mision.territories.map(nombres)),
      });
    default:
      return '';
  }
}
