import { BoxGeometry, type Texture } from 'three';
import { describe, expect, it } from 'vitest';

import {
  loadUnitModels,
  MODEL_MANIFEST_URL,
  type RawUnitModel,
  type UnitModelFetcher,
} from './modelLoader.js';

/** Respuesta falsa de fetch, sin red. */
function respuesta(datos: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(datos),
  } as unknown as Response;
}

/** Cargador falso: devuelve una caja por archivo y anota lo que le pidieron. */
function cargadorFalso(
  comportamientos: Partial<Record<string, RawUnitModel | null | Error>> = {},
  pedidos: string[] = [],
): UnitModelFetcher {
  return (url: string): Promise<RawUnitModel | null> => {
    pedidos.push(url);
    const nombre = url.split('/').pop() ?? url;
    const comportamiento = comportamientos[nombre];
    if (comportamiento instanceof Error) return Promise.reject(comportamiento);
    if (comportamiento === null) return Promise.resolve(null);
    if (comportamiento !== undefined) return Promise.resolve(comportamiento);
    return Promise.resolve({ geometry: new BoxGeometry(1, 1, 1), map: null });
  };
}

describe('modelLoader', () => {
  it('sin manifiesto no carga nada y no es un error', async () => {
    const result = await loadUnitModels({
      fetchImpl: () => Promise.resolve(respuesta(null, false)),
      loadModel: cargadorFalso(),
    });

    expect(result.models).toEqual({});
    expect(result.manifestErrors).toEqual([]);
    expect(result.reports).toHaveLength(4);
    expect(result.reports.every((report) => report.status === 'absent')).toBe(true);
  });

  it('con un manifiesto vacio los cuatro tipos quedan con su primitiva', async () => {
    const result = await loadUnitModels({
      fetchImpl: () => Promise.resolve(respuesta({})),
      loadModel: cargadorFalso(),
    });

    expect(Object.keys(result.models)).toHaveLength(0);
    expect(result.reports.map((report) => report.status)).toEqual([
      'absent',
      'absent',
      'absent',
      'absent',
    ]);
    expect(result.reports[0]?.file).toBe('infantry.glb');
  });

  it('carga un modelo, lo normaliza y reporta sus triangulos', async () => {
    const result = await loadUnitModels({
      fetchImpl: () => Promise.resolve(respuesta({ infantry: { file: 'infantry.glb' } })),
      loadModel: cargadorFalso(),
    });

    expect(result.reports.find((report) => report.type === 'infantry')?.status).toBe('loaded');
    expect(result.reports.find((report) => report.type === 'infantry')?.triangles).toBe(12);
    expect(result.reports.find((report) => report.type === 'cavalry')?.status).toBe('absent');
    expect(result.models.infantry?.geometry.getAttribute('aMask')).toBeDefined();
    expect(result.models.infantry?.geometry.getAttribute('aColor')).toBeDefined();
  });

  it('marca los modelos que se pasan del presupuesto sin dejar de cargarlos', async () => {
    const grande = new BoxGeometry(1, 1, 1, 40, 40, 40); // 9600 triangulos
    const result = await loadUnitModels({
      fetchImpl: () => Promise.resolve(respuesta({ infantry: { file: 'infantry.glb' } })),
      loadModel: cargadorFalso({ 'infantry.glb': { geometry: grande, map: null } }),
    });

    const report = result.reports.find((entry) => entry.type === 'infantry');
    expect(report?.status).toBe('loaded');
    expect(report?.withinBudget).toBe(false);
    expect(report?.budget).toBe(500);
    expect(result.models.infantry?.geometry).toBeDefined();
  });

  it('resuelve las rutas contra la ubicacion del manifiesto', async () => {
    const pedidos: string[] = [];
    await loadUnitModels({
      manifestUrl: 'models/combat/manifest.json',
      fetchImpl: () => Promise.resolve(respuesta({ ship: { file: 'naval/ship.glb' } })),
      loadModel: cargadorFalso({}, pedidos),
    });

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toContain('models/combat/naval/ship.glb');
  });

  it('el manifiesto por defecto es absoluto desde la raiz', () => {
    // Una ruta relativa se resolveria contra la pagina y en `/debug/models`
    // (sin barra final) terminaria pidiendo `/debug/models/combat/...`.
    expect(MODEL_MANIFEST_URL.startsWith('/')).toBe(true);
    expect(MODEL_MANIFEST_URL).toBe('/models/combat/manifest.json');
  });

  it('un archivo que no existe deja ese tipo con su primitiva', async () => {
    const result = await loadUnitModels({
      fetchImpl: () => Promise.resolve(respuesta({ infantry: { file: 'infantry.glb' } })),
      loadModel: cargadorFalso({ 'infantry.glb': null }),
    });

    const report = result.reports.find((entry) => entry.type === 'infantry');
    expect(report?.status).toBe('missing');
    expect(report?.reason).toContain('infantry.glb');
    expect(result.models.infantry).toBeUndefined();
  });

  it('un modelo roto no arrastra a los demas tipos', async () => {
    const result = await loadUnitModels({
      fetchImpl: () =>
        Promise.resolve(
          respuesta({
            infantry: { file: 'infantry.glb' },
            cavalry: { file: 'cavalry.glb' },
          }),
        ),
      loadModel: cargadorFalso({ 'cavalry.glb': new Error('glTF corrupto') }),
    });

    expect(result.reports.find((entry) => entry.type === 'infantry')?.status).toBe('loaded');
    const caballeria = result.reports.find((entry) => entry.type === 'cavalry');
    expect(caballeria?.status).toBe('error');
    expect(caballeria?.reason).toBe('glTF corrupto');
    expect(result.models.infantry).toBeDefined();
    expect(result.models.cavalry).toBeUndefined();
  });

  it('un manifiesto invalido se rechaza entero y se explican los problemas', async () => {
    const result = await loadUnitModels({
      fetchImpl: () =>
        Promise.resolve(respuesta({ dragon: { file: 'dragon.glb' }, infantry: { file: 'x.txt' } })),
      loadModel: cargadorFalso(),
    });

    expect(result.models).toEqual({});
    expect(result.manifestErrors).toHaveLength(2);
    expect(result.reports.every((report) => report.status === 'invalid')).toBe(true);
  });

  it('un manifiesto que no es JSON no rompe la carga', async () => {
    const result = await loadUnitModels({
      fetchImpl: () => Promise.reject(new Error('sin red')),
      loadModel: cargadorFalso(),
    });

    expect(result.reports.every((report) => report.status === 'absent')).toBe(true);
    expect(result.manifestErrors).toEqual([]);
  });

  it('conserva el atlas del modelo y el canal de mascara declarado', async () => {
    const atlas = { isTexture: true } as unknown as Texture;
    const result = await loadUnitModels({
      fetchImpl: () =>
        Promise.resolve(respuesta({ artillery: { file: 'canon.glb', maskChannel: 'a' } })),
      loadModel: cargadorFalso({ 'canon.glb': { geometry: new BoxGeometry(1, 1, 1), map: atlas } }),
    });

    expect(result.models.artillery?.map).toBe(atlas);
    expect(result.models.artillery?.maskChannel).toBe('a');
  });

  it('los tipos sin textura quedan con mapa nulo', async () => {
    const result = await loadUnitModels({
      fetchImpl: () => Promise.resolve(respuesta({ ship: { file: 'navio.glb' } })),
      loadModel: cargadorFalso(),
    });

    expect(result.models.ship?.map).toBeNull();
    expect(result.models.ship?.maskChannel).toBe('none');
  });
});
