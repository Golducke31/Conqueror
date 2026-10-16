import { describe, expect, it } from 'vitest';

import {
  DEFAULT_QUALITY_PARAMS,
  averageFps,
  createQualityController,
  nextQualityState,
  type QualityBase,
  type QualityParams,
} from './quality.js';

const BASE: QualityBase = { unitCap: 16, particleScale: 1 };

/** Alimenta `frames` muestras a `fps` fijo. */
function feed(
  controller: { recordFrame(deltaSeconds: number): void },
  fps: number,
  frames: number,
): void {
  for (let index = 0; index < frames; index += 1) controller.recordFrame(1 / fps);
}

describe('averageFps', () => {
  it('null sin muestras', () => {
    expect(averageFps([])).toBeNull();
  });

  it('60 fps con deltas de 1/60', () => {
    const samples = Array.from({ length: 60 }, () => 1 / 60);
    expect(averageFps(samples)).toBeCloseTo(60, 6);
  });

  it('30 fps con deltas de 1/30', () => {
    const samples = Array.from({ length: 30 }, () => 1 / 30);
    expect(averageFps(samples)).toBeCloseTo(30, 6);
  });

  it('mezcla de lentos y rapidos da el promedio armónico esperado', () => {
    // 10 frames a 10 fps + 10 a 60 fps: 20 / (10*0.1 + 10/60) = 120/7 fps.
    const samples = [
      ...Array.from({ length: 10 }, () => 0.1),
      ...Array.from({ length: 10 }, () => 1 / 60),
    ];
    expect(averageFps(samples)).toBeCloseTo(120 / 7, 6);
  });
});

describe('nextQualityState', () => {
  const params: QualityParams = { ...DEFAULT_QUALITY_PARAMS, patience: 2 };

  it('no degrada con la primera ventana mala', () => {
    expect(nextQualityState(30, false, params, 0)).toBe('keep');
  });

  it('degrada cuando la paciencia se agota', () => {
    expect(nextQualityState(30, false, params, 1)).toBe('degrade');
  });

  it('no recupera dentro de la banda de histéresis', () => {
    expect(nextQualityState(45, true, params, 0)).toBe('keep');
    expect(nextQualityState(45, true, params, 5)).toBe('keep');
  });

  it('recupera recién por encima del umbral de recuperacion', () => {
    expect(nextQualityState(53, true, params, 0)).toBe('keep');
    expect(nextQualityState(53, true, params, 1)).toBe('recover');
  });

  it('ignora ventanas buenas cuando no está degradado', () => {
    expect(nextQualityState(60, false, params, 0)).toBe('keep');
  });
});

describe('createQualityController', () => {
  it('arranca en calidad plena', () => {
    const controller = createQualityController(BASE);
    expect(controller.snapshot()).toEqual({ degraded: false, unitCap: 16, particleScale: 1 });
  });

  it('una ventana mala no alcanza: espera la paciencia', () => {
    const controller = createQualityController(BASE);
    feed(controller, 30, DEFAULT_QUALITY_PARAMS.windowSamples);
    expect(controller.snapshot().degraded).toBe(false);
  });

  it('degrada con dos ventanas malas seguidas', () => {
    const controller = createQualityController(BASE);
    feed(controller, 30, DEFAULT_QUALITY_PARAMS.windowSamples * 3);
    const snapshot = controller.snapshot();
    expect(snapshot.degraded).toBe(true);
    expect(snapshot.unitCap).toBe(8);
    expect(snapshot.particleScale).toBeCloseTo(0.35, 6);
  });

  it('no degrada si el promedio queda sobre el umbral', () => {
    const controller = createQualityController(BASE);
    feed(controller, 41, DEFAULT_QUALITY_PARAMS.windowSamples * 3);
    expect(controller.snapshot().degraded).toBe(false);
  });

  it('histéresis: una vez degradado, 45 fps no recuperan', () => {
    const controller = createQualityController(BASE);
    feed(controller, 30, DEFAULT_QUALITY_PARAMS.windowSamples * 3);
    expect(controller.snapshot().degraded).toBe(true);
    feed(controller, 45, DEFAULT_QUALITY_PARAMS.windowSamples * 3);
    expect(controller.snapshot().degraded).toBe(true);
  });

  it('recupera con fps altos sostenidos', () => {
    const controller = createQualityController(BASE);
    feed(controller, 25, DEFAULT_QUALITY_PARAMS.windowSamples * 3);
    expect(controller.snapshot().degraded).toBe(true);
    feed(controller, 60, DEFAULT_QUALITY_PARAMS.windowSamples * 3);
    expect(controller.snapshot().degraded).toBe(false);
    expect(controller.snapshot()).toEqual({ degraded: false, unitCap: 16, particleScale: 1 });
  });

  it('las ventanas malas intercaladas con buenas no acumulan paciencia', () => {
    const controller = createQualityController(BASE);
    // Alterna 30 y 60 fps: cada ventana queda en el medio, ni degrada ni
    // recupera, y la paciencia se reinicia en cada muestra buena.
    for (let index = 0; index < 12; index += 1) {
      feed(controller, 30, DEFAULT_QUALITY_PARAMS.windowSamples);
      feed(controller, 60, DEFAULT_QUALITY_PARAMS.windowSamples);
    }
    expect(controller.snapshot().degraded).toBe(false);
  });

  it('el tope de unidades degradado nunca baja de 2', () => {
    const controller = createQualityController({ unitCap: 3, particleScale: 1 });
    feed(controller, 20, DEFAULT_QUALITY_PARAMS.windowSamples * 3);
    expect(controller.snapshot().unitCap).toBe(2);
  });

  it('la escala de partículas degradada es una fraccion de la base', () => {
    const controller = createQualityController({ unitCap: 16, particleScale: 1.9 });
    feed(controller, 20, DEFAULT_QUALITY_PARAMS.windowSamples * 3);
    expect(controller.snapshot().particleScale).toBeCloseTo(1.9 * 0.35, 6);
  });

  it('ignora deltas inválidos', () => {
    const controller = createQualityController(BASE);
    controller.recordFrame(0);
    controller.recordFrame(-1);
    controller.recordFrame(Number.NaN);
    // Sin muestras validas, la ventana nunca se llena: no degrada.
    feed(controller, 60, DEFAULT_QUALITY_PARAMS.windowSamples * 2);
    expect(controller.snapshot().degraded).toBe(false);
  });

  it('reset olvida las muestras pero conserva el estado', () => {
    const controller = createQualityController(BASE);
    feed(controller, 20, DEFAULT_QUALITY_PARAMS.windowSamples * 3);
    expect(controller.snapshot().degraded).toBe(true);
    controller.reset();
    // La ventana se vacia: hace falta llenarla otra vez para volver a evaluar.
    feed(controller, 60, DEFAULT_QUALITY_PARAMS.windowSamples - 1);
    expect(controller.snapshot().degraded).toBe(true);
  });
});
