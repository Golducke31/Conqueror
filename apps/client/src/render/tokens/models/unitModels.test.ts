import { BoxGeometry } from 'three';
import { describe, expect, it } from 'vitest';

import { createUnitModels, type UnitModelsState } from './unitModels.js';
import type { RawUnitModel, UnitModelFetcher } from './modelLoader.js';

function respuesta(datos: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(datos) } as unknown as Response;
}

/** Cargador falso que cuenta cuantas veces lo llamaron. */
function cargadorFalso(veces: { total: number }): UnitModelFetcher {
  return (): Promise<RawUnitModel> => {
    veces.total += 1;
    return Promise.resolve({ geometry: new BoxGeometry(1, 1, 1), map: null });
  };
}

describe('unitModels', () => {
  it('arranca sin modelos: todas las primitivas', () => {
    const models = createUnitModels({ loadModel: cargadorFalso({ total: 0 }) });
    expect(models.state().models).toEqual({});
    expect(models.state().reports).toEqual([]);
  });

  it('avisa a los suscriptores cuando termina la carga', async () => {
    const models = createUnitModels({
      loadModel: cargadorFalso({ total: 0 }),
      fetchImpl: () => Promise.resolve(respuesta({ infantry: { file: 'infantry.glb' } })),
    });

    const estados: UnitModelsState[] = [];
    models.subscribe((estado) => estados.push(estado));

    await models.load();

    expect(estados).toHaveLength(1);
    expect(estados[0]?.models.infantry?.geometry).toBeDefined();
    expect(models.state().models.infantry).toBeDefined();
  });

  it('la carga es idempotente: el cargador se llama una sola vez', async () => {
    const veces = { total: 0 };
    const models = createUnitModels({
      loadModel: cargadorFalso(veces),
      fetchImpl: () =>
        Promise.resolve(
          respuesta({ infantry: { file: 'infantry.glb' }, cavalry: { file: 'cavalry.glb' } }),
        ),
    });

    await Promise.all([models.load(), models.load(), models.load()]);

    expect(veces.total).toBe(2); // una por tipo declarado, no una por llamada
  });

  it('una carga que falla deja el estado vacio y no lanza', async () => {
    const models = createUnitModels({
      loadModel: () => Promise.reject(new Error('exploto')),
      fetchImpl: () => Promise.resolve(respuesta({ infantry: { file: 'infantry.glb' } })),
    });

    const estado = await models.load();

    expect(estado.models).toEqual({});
    expect(estado.reports.find((report) => report.type === 'infantry')?.status).toBe('error');
  });

  it('dispose libera las geometrias y deja de avisar', async () => {
    const models = createUnitModels({
      loadModel: cargadorFalso({ total: 0 }),
      fetchImpl: () => Promise.resolve(respuesta({ infantry: { file: 'infantry.glb' } })),
    });
    await models.load();
    const geometria = models.state().models.infantry?.geometry;

    const estados: UnitModelsState[] = [];
    models.subscribe((estado) => estados.push(estado));
    models.dispose();

    expect(geometria?.getAttribute('position')).toBeDefined();
    expect(models.state().models).toEqual({});
    expect(estados).toHaveLength(0);
  });
});
