import { describe, expect, it, vi } from 'vitest';

import { createAudioManager, type CueLogEntry } from './audioManager.js';

// --- Fakes de Web Audio -----------------------------------------------------
// El manager habla con la Web Audio API nativa; aca se la reemplaza por
// dobles que registran lo que pasa, para poder testear sin navegador.

class FakeParam {
  value = 0;
  readonly rampas: { value: number; time: number; tau: number }[] = [];
  setTargetAtTime(value: number, time: number, tau: number): void {
    this.rampas.push({ value, time, tau });
    this.value = value;
  }
}

class FakeNode {
  readonly salidas: FakeNode[] = [];
  connect(destino: FakeNode): FakeNode {
    this.salidas.push(destino);
    return destino;
  }
  disconnect(): void {
    this.salidas.length = 0;
  }
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  readonly playbackRate = new FakeParam();
  onended: (() => void) | null = null;
  arrancado = false;
  detenido = false;
  start(): void {
    this.arrancado = true;
  }
  stop(): void {
    this.detenido = true;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakePanner extends FakeNode {
  readonly pan = new FakeParam();
}

class FakeAudioContext {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  readonly destination = new FakeNode();
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  readonly panners: FakePanner[] = [];
  decodificaciones = 0;
  cerrado = false;

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createStereoPanner(): FakePanner {
    const panner = new FakePanner();
    this.panners.push(panner);
    return panner;
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  async decodeAudioData(_data: ArrayBuffer): Promise<AudioBuffer> {
    this.decodificaciones += 1;
    return { duration: 1 } as unknown as AudioBuffer;
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
  async close(): Promise<void> {
    this.state = 'closed';
    this.cerrado = true;
  }
}

function respuesta(json: unknown): Response {
  return {
    ok: true,
    json: async () => json,
    arrayBuffer: async () => new ArrayBuffer(8),
  } as unknown as Response;
}

function respuestaFalla(): Response {
  return { ok: false } as unknown as Response;
}

/** Almacenamiento en memoria para la persistencia de volumenes. */
function almacenFalso(): {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
} {
  const mapa = new Map<string, string>();
  return {
    getItem: (clave) => mapa.get(clave) ?? null,
    setItem: (clave, valor) => {
      mapa.set(clave, valor);
    },
  };
}

/** Deja correr los microtasks pendientes (cargas asincronicas). */
async function drenar(veces = 20): Promise<void> {
  for (let i = 0; i < veces; i += 1) await Promise.resolve();
}

const MANIFIESTO_URL = '/audio/combat/manifest.json';

function manifiestoSimple(): unknown {
  return {
    'cannon.fire': {
      files: ['cannon_fire_1.mp3'],
      volume: 0.9,
      pitchVariance: 0.05,
      maxVoices: 2,
      cooldownMs: 60,
    },
  };
}

function fetchDe(manifiesto: unknown, archivoOk = true): (url: string) => Promise<Response> {
  return (url: string) =>
    Promise.resolve(
      url === MANIFIESTO_URL
        ? respuesta(manifiesto)
        : archivoOk
          ? respuesta(null)
          : respuestaFalla(),
    );
}

function contextoDesbloqueado(): FakeAudioContext {
  const context = new FakeAudioContext();
  context.state = 'running';
  return context;
}

describe('AudioManager', () => {
  it('carga el manifiesto, decodifica el archivo y la senal suena', async () => {
    const context = contextoDesbloqueado();
    const manager = createAudioManager({
      context: context as unknown as AudioContext,
      fetchImpl: fetchDe(manifiestoSimple()),
    });

    await manager.load();
    manager.cue('cannon.fire', { x: 0, y: 1, z: 0 });

    expect(context.decodificaciones).toBe(1);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]?.arrancado).toBe(true);
    expect(context.sources[0]?.buffer).not.toBeNull();
    expect(manager.cueLog().at(-1)?.status).toBe('sono');
  });

  it('un slot sin archivos nunca lanza error: solo silencio', async () => {
    const context = contextoDesbloqueado();
    const manager = createAudioManager({
      context: context as unknown as AudioContext,
      fetchImpl: fetchDe({ 'dice.roll': { files: [] } }),
    });

    await manager.load();
    expect(() => manager.cue('dice.roll')).not.toThrow();
    expect(context.sources).toHaveLength(0);
    expect(manager.cueLog().at(-1)?.status).toBe('sin-archivo');
  });

  it('un slot desconocido tampoco lanza error', async () => {
    const context = contextoDesbloqueado();
    const manager = createAudioManager({
      context: context as unknown as AudioContext,
      fetchImpl: fetchDe({}),
    });

    await manager.load();
    expect(() => manager.cue('no.existe')).not.toThrow();
    expect(context.sources).toHaveLength(0);
    expect(manager.cueLog().at(-1)?.status).toBe('sin-archivo');
  });

  it('sin manifiesto (404) el juego corre en silencio', async () => {
    const context = contextoDesbloqueado();
    const manager = createAudioManager({
      context: context as unknown as AudioContext,
      fetchImpl: () => Promise.resolve(respuestaFalla()),
    });

    await manager.load();
    expect(() => manager.cue('cannon.fire')).not.toThrow();
    expect(context.sources).toHaveLength(0);
    expect(manager.manifestErrors()).toEqual([]);
  });

  it('un archivo que falta (404) deja el slot en silencio', async () => {
    const context = contextoDesbloqueado();
    const manager = createAudioManager({
      context: context as unknown as AudioContext,
      fetchImpl: fetchDe(manifiestoSimple(), false),
    });

    await manager.load();
    manager.cue('cannon.fire');

    expect(context.decodificaciones).toBe(0);
    expect(context.sources).toHaveLength(0);
    expect(manager.cueLog().at(-1)?.status).toBe('sin-archivo');
  });

  it('un manifiesto invalido se rechaza entero y se explican los errores', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const context = contextoDesbloqueado();
    const manager = createAudioManager({
      context: context as unknown as AudioContext,
      fetchImpl: fetchDe({ cannonfire: { files: [] } }),
    });

    await manager.load();

    expect(error).toHaveBeenCalledOnce();
    expect(manager.manifestErrors().length).toBeGreaterThan(0);
    expect(() => manager.cue('cannon.fire')).not.toThrow();
    expect(context.sources).toHaveLength(0);
    error.mockRestore();
  });

  it('con el contexto bloqueado la senal espera el desbloqueo', async () => {
    const context = new FakeAudioContext();
    const manager = createAudioManager({
      context: context as unknown as AudioContext,
      fetchImpl: fetchDe(manifiestoSimple()),
    });

    await manager.load();
    manager.cue('cannon.fire');
    expect(context.sources).toHaveLength(0);
    expect(manager.cueLog().at(-1)?.status).toBe('sin-desbloquear');

    await manager.unlock();
    expect(context.state).toBe('running');
    manager.cue('cannon.fire');
    expect(context.sources).toHaveLength(1);
    expect(manager.cueLog().at(-1)?.status).toBe('sono');
  });

  it('respeta el tope de voces y libera el lugar cuando termina el sonido', async () => {
    let ahora = 0;
    const context = contextoDesbloqueado();
    const manager = createAudioManager({
      context: context as unknown as AudioContext,
      fetchImpl: fetchDe({
        'cannon.fire': { files: ['cannon_fire_1.mp3'], maxVoices: 1, cooldownMs: 60 },
      }),
      clock: () => ahora,
    });

    await manager.load();
    manager.cue('cannon.fire');
    expect(manager.cueLog().at(-1)?.status).toBe('sono');

    ahora = 100; // pasado el cooldown
    manager.cue('cannon.fire');
    expect(manager.cueLog().at(-1)?.status).toBe('descartada-voces');
    expect(context.sources).toHaveLength(1);

    context.sources[0]?.onended?.();
    ahora = 200;
    manager.cue('cannon.fire');
    expect(manager.cueLog().at(-1)?.status).toBe('sono');
    expect(context.sources).toHaveLength(2);
  });

  it('respeta el cooldown entre senales del mismo slot', async () => {
    let ahora = 0;
    const context = contextoDesbloqueado();
    const manager = createAudioManager({
      context: context as unknown as AudioContext,
      fetchImpl: fetchDe({
        'cannon.fire': { files: ['cannon_fire_1.mp3'], cooldownMs: 500 },
      }),
      clock: () => ahora,
    });

    await manager.load();
    manager.cue('cannon.fire');
    expect(manager.cueLog().at(-1)?.status).toBe('sono');

    manager.cue('cannon.fire');
    expect(manager.cueLog().at(-1)?.status).toBe('descartada-cooldown');

    ahora = 500;
    manager.cue('cannon.fire');
    expect(manager.cueLog().at(-1)?.status).toBe('sono');
  });

  it('el paneo sale de la funcion inyectada, acotado a -1..1', async () => {
    let ahora = 0;
    const context = contextoDesbloqueado();
    const manager = createAudioManager({
      context: context as unknown as AudioContext,
      fetchImpl: fetchDe({
        // Tres voces: las tres senales de la prueba conviven sin solaparse.
        'cannon.fire': { files: ['cannon_fire_1.mp3'], maxVoices: 3 },
      }),
      panOf: (mundo) => mundo.x / 10,
      clock: () => ahora,
    });

    await manager.load();
    manager.cue('cannon.fire', { x: 4, y: 0, z: 0 });
    expect(context.panners[0]?.pan.value).toBeCloseTo(0.4, 10);

    ahora = 200; // pasado el cooldown por defecto (60 ms)
    manager.cue('cannon.fire', { x: -80, y: 0, z: 0 });
    expect(context.panners[1]?.pan.value).toBe(-1);

    ahora = 400;
    manager.cue('cannon.fire');
    expect(context.panners[2]?.pan.value).toBe(0);
  });

  it('la variacion de tono mueve el playbackRate dentro del rango', async () => {
    const context = contextoDesbloqueado();
    const manager = createAudioManager({
      context: context as unknown as AudioContext,
      fetchImpl: fetchDe({
        'cannon.fire': { files: ['cannon_fire_1.mp3'], pitchVariance: 0.1 },
      }),
    });

    await manager.load();
    manager.cue('cannon.fire');
    const rate = context.sources[0]?.playbackRate.value ?? 0;
    expect(rate).toBeGreaterThanOrEqual(0.9);
    expect(rate).toBeLessThanOrEqual(1.1);
  });

  it('cruza las capas de ambiente segun el calor de batalla', async () => {
    const context = contextoDesbloqueado();
    const manager = createAudioManager({
      context: context as unknown as AudioContext,
      fetchImpl: fetchDe({
        'battle.ambience.low': { files: ['amb_low.mp3'], bus: 'ambience', volume: 0.5 },
        'battle.ambience.mid': { files: ['amb_mid.mp3'], bus: 'ambience', volume: 0.5 },
        'battle.ambience.high': { files: ['amb_high.mp3'], bus: 'ambience', volume: 0.5 },
      }),
    });

    await manager.load();
    // Tres loops vivos, en el bus de ambiente.
    expect(context.sources).toHaveLength(3);
    for (const source of context.sources) expect(source.loop).toBe(true);

    const gananciaDe = (index: number): number =>
      (context.sources[index]?.salidas[0] as FakeGain | undefined)?.gain.value ?? -99;

    manager.setAmbienceHeat(0);
    expect(gananciaDe(0)).toBeCloseTo(0.5, 10); // low al maximo
    expect(gananciaDe(1)).toBeCloseTo(0, 10);
    expect(gananciaDe(2)).toBeCloseTo(0, 10);

    manager.setAmbienceHeat(1);
    expect(gananciaDe(0)).toBeCloseTo(0, 10);
    expect(gananciaDe(1)).toBeCloseTo(0, 10);
    expect(gananciaDe(2)).toBeCloseTo(0.5, 10); // high al maximo

    manager.setAmbienceHeat(0.5);
    expect(gananciaDe(1)).toBeCloseTo(0.5, 10); // mid al maximo
  });

  it('un calor pedido antes de cargar se aplica cuando arranca el ambiente', async () => {
    const context = contextoDesbloqueado();
    const manager = createAudioManager({
      context: context as unknown as AudioContext,
      fetchImpl: fetchDe({
        'battle.ambience.low': { files: ['amb_low.mp3'], bus: 'ambience', volume: 0.5 },
        'battle.ambience.mid': { files: ['amb_mid.mp3'], bus: 'ambience', volume: 0.5 },
        'battle.ambience.high': { files: ['amb_high.mp3'], bus: 'ambience', volume: 0.5 },
      }),
    });

    manager.setAmbienceHeat(1);
    await manager.load();

    const gananciaDe = (index: number): number =>
      (context.sources[index]?.salidas[0] as FakeGain | undefined)?.gain.value ?? -99;
    expect(gananciaDe(2)).toBeCloseTo(0.5, 10);
  });

  it('los volumenes de los buses y el silencio persisten', async () => {
    const context = contextoDesbloqueado();
    const storage = almacenFalso();
    const manager = createAudioManager({
      context: context as unknown as AudioContext,
      fetchImpl: fetchDe(manifiestoSimple()),
      storage,
    });

    manager.setBusVolume('effects', 0.4);
    manager.setBusVolume('ambience', 0.8);
    manager.setMuted(true);
    expect(manager.isMuted()).toBe(true);
    expect(context.gains.some((gain) => gain.gain.value === 0)).toBe(true);

    // Un manager nuevo con el mismo almacenamiento recupera los ajustes.
    const otro = createAudioManager({
      context: new FakeAudioContext() as unknown as AudioContext,
      fetchImpl: fetchDe(manifiestoSimple()),
      storage,
    });
    expect(otro.busVolume('effects')).toBeCloseTo(0.4, 10);
    expect(otro.busVolume('ambience')).toBeCloseTo(0.8, 10);
    expect(otro.isMuted()).toBe(true);
  });

  it('el registro en vivo recibe cada senal emitida', async () => {
    let ahora = 0;
    const context = contextoDesbloqueado();
    const entradas: CueLogEntry[] = [];
    const manager = createAudioManager({
      context: context as unknown as AudioContext,
      fetchImpl: fetchDe(manifiestoSimple()),
      clock: () => ahora,
      onCue: (entrada) => entradas.push(entrada),
    });

    await manager.load();
    manager.cue('cannon.fire');
    ahora = 200;
    manager.cue('cannon.fire');

    expect(entradas).toHaveLength(2);
    expect(entradas[0]?.status).toBe('sono');
    expect(manager.cueLog()).toHaveLength(2);
  });

  it('carga en diferido cuando la senal llega antes de tener el archivo', async () => {
    const context = contextoDesbloqueado();
    let liberar: () => void = () => undefined;
    const colgado = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    const manager = createAudioManager({
      context: context as unknown as AudioContext,
      fetchImpl: (url) =>
        Promise.resolve(
          url === MANIFIESTO_URL
            ? respuesta(manifiestoSimple())
            : colgado.then(() => respuesta(null)),
        ),
    });

    void manager.load();
    await drenar();
    manager.cue('cannon.fire');
    expect(manager.cueLog().at(-1)?.status).toBe('decodificando');
    expect(context.sources).toHaveLength(0);

    liberar();
    await drenar();
    manager.cue('cannon.fire');
    expect(manager.cueLog().at(-1)?.status).toBe('sono');
  });

  it('dispose detiene el ambiente y cierra el contexto propio', async () => {
    const context = contextoDesbloqueado();
    const manager = createAudioManager({
      context: context as unknown as AudioContext,
      fetchImpl: fetchDe({
        'battle.ambience.low': { files: ['amb_low.mp3'], bus: 'ambience', volume: 0.5 },
      }),
    });

    await manager.load();
    expect(context.sources).toHaveLength(1);
    manager.dispose();

    expect(context.sources[0]?.detenido).toBe(true);
    manager.cue('cannon.fire'); // ya desconectado: no lanza
  });

  it('dispose NO cierra un contexto inyectado (lo comparte la pagina)', async () => {
    const context = contextoDesbloqueado();
    const manager = createAudioManager({
      context: context as unknown as AudioContext,
      fetchImpl: fetchDe(manifiestoSimple()),
    });

    await manager.load();
    manager.dispose();
    expect(context.cerrado).toBe(false);
  });

  it('slotStatuses informa el estado de cada slot para la pagina de pruebas', async () => {
    const context = contextoDesbloqueado();
    const manager = createAudioManager({
      context: context as unknown as AudioContext,
      fetchImpl: fetchDe({
        'cannon.fire': { files: ['cannon_fire_1.mp3'] },
        'dice.roll': { files: [] },
      }),
    });

    await manager.load();
    const estados = manager.slotStatuses();
    expect(estados).toHaveLength(2);
    expect(estados.find((e) => e.name === 'cannon.fire')?.available).toBe(true);
    expect(estados.find((e) => e.name === 'dice.roll')?.available).toBe(false);
  });
});
