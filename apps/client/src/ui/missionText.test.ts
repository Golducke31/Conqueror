import { afterEach, describe, expect, it } from 'vitest';

import { setLocale } from '../app/i18n.js';
import { textoMision, unirLista } from './missionText.js';

const nombres = (id: string): string => id.toUpperCase();

afterEach(() => {
  setLocale('es-AR');
});

describe('textoMision: conquistar continentes', () => {
  it('no menciona territorios extra cuando no hay', () => {
    // El caso normal del mazo: cada par de continentes va con extra = 0.
    const texto = textoMision(
      {
        kind: 'conquer-continents',
        continents: ['america_del_sur', 'europa'],
        extraTerritories: 0,
      },
      nombres,
    );
    expect(texto).toBe('Conquistar América del Sur y Europa');
    expect(texto).not.toContain('0 territorios');
  });

  it('usa el singular con un solo territorio extra', () => {
    const texto = textoMision(
      { kind: 'conquer-continents', continents: ['asia'], extraTerritories: 1 },
      nombres,
    );
    expect(texto).toBe('Conquistar Asia y 1 territorio más');
  });

  it('usa el plural desde dos territorios extra', () => {
    const texto = textoMision(
      { kind: 'conquer-continents', continents: ['africa'], extraTerritories: 3 },
      nombres,
    );
    expect(texto).toBe('Conquistar África y 3 territorios más');
  });

  it('en ingles la lista usa "and"', () => {
    setLocale('en');
    const texto = textoMision(
      {
        kind: 'conquer-continents',
        continents: ['america_del_sur', 'europa'],
        extraTerritories: 0,
      },
      nombres,
    );
    expect(texto).toBe('Conquer South America and Europe');
  });
});

describe('textoMision: otras misiones', () => {
  it('eliminar jugador', () => {
    expect(textoMision({ kind: 'eliminate-player', targetColor: 'rojo' }, nombres)).toBe(
      'Eliminar al jugador rojo',
    );
  });

  it('conquistar territorios respeta el singular', () => {
    expect(textoMision({ kind: 'conquer-territories', count: 1 }, nombres)).toBe(
      'Conquistar 1 territorio',
    );
    expect(textoMision({ kind: 'conquer-territories', count: 18 }, nombres)).toBe(
      'Conquistar 18 territorios',
    );
  });

  it('territorios propios se listan con conjuncion', () => {
    expect(textoMision({ kind: 'own-territories', territories: ['brasil', 'peru'] }, nombres)).toBe(
      'Conquistar BRASIL y PERU',
    );
  });
});

describe('unirLista', () => {
  it('une dos o mas elementos con la conjuncion del idioma', () => {
    expect(unirLista(['a', 'b'])).toBe('a y b');
    expect(unirLista(['a', 'b', 'c'])).toBe('a, b y c');
  });

  it('un solo elemento queda sin conjuncion', () => {
    expect(unirLista(['a'])).toBe('a');
    expect(unirLista([])).toBe('');
  });
});
