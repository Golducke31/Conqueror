/**
 * AudioManager: reproduce las senales de la coreografia de combate.
 *
 * Decisiones (ADR 0011):
 *   - Web Audio propio, sin dependencias: lo que se necesita (buses, tope de
 *     voces, cooldown, variacion de tono, paneo y loops de ambiente) son
 *     operaciones basicas de la API nativa.
 *   - El juego corre en SILENCIO TOTAL mientras no haya archivos: un
 *     manifiesto ausente, un archivo que no existe o un contexto bloqueado
 *     nunca producen error, solo un `console.debug` cuando `debug` esta
 *     activo.
 *   - La coreografia emite (`cue`); el manager decide si suena. La
 *     presentacion no cambia nada del juego: el sonido es consecuencia del
 *     mismo evento que mueve las fichas.
 *   - El paneo se calcula con una funcion inyectada `panOf(mundo)`: el
 *     manager no conoce Three.js.
 *   - Los volumenes de los buses se guardan en `localStorage` (persistencia
 *     del ajuste del jugador; la pantalla de ajuste llega despues).
 */

import {
  AMBIENCE_SLOTS,
  validateManifest,
  type AudioBus,
  type SoundManifest,
  type SoundSlot,
} from './manifest.js';

/** Posicion de mundo, para el paneo. Compatible con `THREE.Vector3`. */
export interface WorldPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Como termino una senal emitida. */
export type CueStatus =
  | 'sono'
  | 'sin-archivo'
  | 'sin-desbloquear'
  | 'descartada-voces'
  | 'descartada-cooldown'
  | 'decodificando';

/** Entrada del registro en vivo de senales (overlay de depuracion). */
export interface CueLogEntry {
  readonly slot: string;
  /** Milisegundos del reloj inyectado. */
  readonly time: number;
  readonly status: CueStatus;
  /** Paneo aplicado, entre -1 y 1. */
  readonly pan: number;
}

/**
 * Receptor minimo de senales. Lo implementa el AudioManager; la escena de
 * batalla solo necesita este contrato (y funciona sin el si no se le pasa).
 */
export interface AudioSink {
  cue(slot: string, world?: WorldPoint): void;
}

/** Estado de un slot para la pagina `/debug/sounds`. */
export interface SlotStatus {
  readonly name: string;
  readonly definition: SoundSlot;
  /** Archivos del slot que pudieron decodificarse. */
  readonly ready: number;
  /** Hay al menos un archivo utilizable. */
  readonly available: boolean;
  /** La carga sigue en curso. */
  readonly loading: boolean;
}

export interface AudioManagerOptions {
  /** Contexto inyectado (pruebas). Si falta, se crea uno. */
  readonly context?: AudioContext;
  /** Ruta del manifiesto. Por defecto `/audio/combat/manifest.json`. */
  readonly manifestUrl?: string;
  /** Convierte una posicion de mundo en paneo (-1 a 1). La arma la escena. */
  readonly panOf?: (world: WorldPoint) => number;
  /** Almacenamiento persistente inyectado (pruebas). */
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'>;
  /** Log de senales por consola. */
  readonly debug?: boolean;
  /** Reloj inyectable (pruebas). */
  readonly clock?: () => number;
  /** fetch inyectable (pruebas). */
  readonly fetchImpl?: (url: string) => Promise<Response>;
  /** Se llama con cada senal emitida, para el registro en vivo. */
  readonly onCue?: (entry: CueLogEntry) => void;
}

export interface AudioManager extends AudioSink {
  /** Carga el manifiesto y decodifica los archivos. Idempotente. */
  load(): Promise<void>;
  /** Desbloquea el contexto en el primer gesto del usuario. */
  unlock(): Promise<void>;
  /** Cruza las capas de ambiente segun el calor de batalla (0 a 1). */
  setAmbienceHeat(value: number): void;
  setBusVolume(bus: AudioBus, value: number): void;
  busVolume(bus: AudioBus): number;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  /** Problemas de validacion del manifiesto, para mostrarlos en la pagina. */
  manifestErrors(): readonly string[];
  /** Estado de cada slot, para la pagina `/debug/sounds`. */
  slotStatuses(): readonly SlotStatus[];
  /** Historial reciente de senales (maximo 30). */
  cueLog(): readonly CueLogEntry[];
  dispose(): void;
}

const MANIFEST_URL_POR_DEFECTO = '/audio/combat/manifest.json';
const HISTORIAL_MAX = 30;
/** Constante de tiempo del crossfade de ambiente, en segundos. */
const AMBIENCE_TAU = 0.25;

const CLAVE_VOLUMEN: Readonly<Record<AudioBus, string>> = {
  effects: 'conqueror:audio:effects',
  ambience: 'conqueror:audio:ambience',
};
const CLAVE_MUTE = 'conqueror:audio:muted';

function limitar(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** localStorage si existe y responde (modo privado puede tirar error). */
function almacenLocal(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Sin almacenamiento: los volumenes no persisten, y no pasa nada.
  }
  return undefined;
}

/** Resuelve las rutas del manifiesto contra su propia ubicacion. */
function crearResolver(manifestUrl: string): (file: string) => string {
  const base =
    typeof document !== 'undefined' && document.baseURI !== ''
      ? document.baseURI
      : 'http://localhost/';
  const manifiesto = new URL(manifestUrl, base);
  return (file: string) => new URL(file, manifiesto).toString();
}

export function createAudioManager(options: AudioManagerOptions = {}): AudioManager {
  const context = options.context ?? new AudioContext();
  const ownsContext = options.context === undefined;
  const manifestUrl = options.manifestUrl ?? MANIFEST_URL_POR_DEFECTO;
  const resolver = crearResolver(manifestUrl);
  const clock =
    options.clock ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const fetchImpl = options.fetchImpl ?? ((url: string) => fetch(url));
  const storage = options.storage ?? almacenLocal();
  const debug = options.debug === true;

  let manifest: SoundManifest = {};
  let errores: readonly string[] = [];
  let disposed = false;
  let loadPromise: Promise<void> | null = null;
  /** Calor pedido antes de que existan las capas de ambiente. */
  let pendingHeat = 0;

  /** Carga en curso (o terminada) de los archivos de cada slot. */
  const slotLoads = new Map<string, Promise<readonly AudioBuffer[]>>();
  /** Archivos ya decodificados por slot. Un slot ausente del mapa = sin sonido. */
  const buffers = new Map<string, readonly AudioBuffer[]>();
  /** Voces activas por slot. */
  const voces = new Map<string, number>();
  /** Ultima senal aceptada por slot, para el cooldown. */
  const ultimaSenal = new Map<string, number>();
  const historial: CueLogEntry[] = [];

  // --- Grafo de mezcla -----------------------------------------------------
  const master = context.createGain();
  master.connect(context.destination);
  const buses: Readonly<Record<AudioBus, GainNode>> = {
    effects: context.createGain(),
    ambience: context.createGain(),
  };
  buses.effects.connect(master);
  buses.ambience.connect(master);

  let mute = leerBool(storage, CLAVE_MUTE, false);
  const volumen: Record<AudioBus, number> = {
    effects: leerNumero(storage, CLAVE_VOLUMEN.effects, 1),
    ambience: leerNumero(storage, CLAVE_VOLUMEN.ambience, 1),
  };

  const aplicarBuses = (): void => {
    const factor = mute ? 0 : 1;
    buses.effects.gain.value = volumen.effects * factor;
    buses.ambience.gain.value = volumen.ambience * factor;
  };
  aplicarBuses();

  /** Capas de ambiente vivas (loops), por slot. */
  const ambients = new Map<
    string,
    { readonly source: AudioBufferSourceNode; readonly gain: GainNode }
  >();

  // --- Registro de senales --------------------------------------------------

  const registrar = (slot: string, status: CueStatus, pan: number): void => {
    const entrada: CueLogEntry = { slot, time: clock(), status, pan };
    historial.push(entrada);
    if (historial.length > HISTORIAL_MAX) historial.shift();
    options.onCue?.(entrada);
    if (debug) console.debug(`audio: ${slot} → ${status}`);
  };

  // --- Carga de archivos -----------------------------------------------------

  const loadSlot = (slot: string, def: SoundSlot): Promise<readonly AudioBuffer[]> => {
    const existente = slotLoads.get(slot);
    if (existente !== undefined) return existente;
    const promesa = (async (): Promise<readonly AudioBuffer[]> => {
      const decoded: AudioBuffer[] = [];
      for (const file of def.files) {
        try {
          const respuesta = await fetchImpl(resolver(file));
          if (!respuesta.ok) {
            if (debug) console.debug(`audio: falta el archivo ${file} (slot ${slot})`);
            continue;
          }
          decoded.push(await context.decodeAudioData(await respuesta.arrayBuffer()));
        } catch (error) {
          if (debug) console.debug(`audio: no se pudo cargar ${file} (slot ${slot})`, error);
        }
      }
      buffers.set(slot, decoded);
      return decoded;
    })();
    slotLoads.set(slot, promesa);
    return promesa;
  };

  const load = (): Promise<void> => {
    if (loadPromise !== null) return loadPromise;
    loadPromise = (async () => {
      let datos: unknown;
      try {
        const respuesta = await fetchImpl(manifestUrl);
        if (!respuesta.ok) {
          if (debug) console.debug(`audio: no hay manifiesto en ${manifestUrl}: silencio`);
          return;
        }
        datos = await respuesta.json();
      } catch (error) {
        if (debug) console.debug('audio: no se pudo leer el manifiesto: silencio', error);
        return;
      }

      const resultado = validateManifest(datos);
      if (!resultado.ok) {
        errores = resultado.error;
        console.error(`audio: el manifiesto de sonidos no es valido:\n- ${errores.join('\n- ')}`);
        return;
      }
      manifest = resultado.value;

      await Promise.all(
        Object.entries(manifest)
          .filter(([, def]) => def.files.length > 0)
          .map(([slot, def]) => loadSlot(slot, def)),
      );
      await startAmbience();
    })();
    return loadPromise;
  };

  // --- Ambiente ---------------------------------------------------------------

  const crearAmbiente = (
    decoded: readonly AudioBuffer[],
  ): { readonly source: AudioBufferSourceNode; readonly gain: GainNode } | null => {
    const buffer = decoded[Math.floor(Math.random() * decoded.length)];
    if (buffer === undefined) return null;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(buses.ambience);
    source.start();
    return { source, gain };
  };

  const startAmbience = async (): Promise<void> => {
    await Promise.all(
      Object.values(AMBIENCE_SLOTS).map(async (slot) => {
        const def = manifest[slot];
        if (def === undefined || def.files.length === 0) return;
        const decoded = await loadSlot(slot, def);
        if (disposed || decoded.length === 0) return;
        const layer = crearAmbiente(decoded);
        if (layer !== null) ambients.set(slot, layer);
      }),
    );
    // El calor pedido antes de que existieran las capas se aplica recien ahora.
    aplicarCalor(pendingHeat);
  };

  const rampaAmbiente = (slot: string, objetivo: number): void => {
    const layer = ambients.get(slot);
    const def = manifest[slot];
    if (layer === undefined || def === undefined) return;
    layer.gain.gain.setTargetAtTime(objetivo * def.volume, context.currentTime, AMBIENCE_TAU);
  };

  /** Mezcla por calor: 0 = solo low, 0.5 = solo mid, 1 = solo high, con cruces. */
  const aplicarCalor = (heat: number): void => {
    const low = Math.max(0, 1 - heat * 2);
    const mid = Math.max(0, 1 - Math.abs(heat - 0.5) * 2);
    const high = Math.max(0, heat * 2 - 1);
    rampaAmbiente(AMBIENCE_SLOTS.low, low);
    rampaAmbiente(AMBIENCE_SLOTS.mid, mid);
    rampaAmbiente(AMBIENCE_SLOTS.high, high);
  };

  // --- Reproduccion ------------------------------------------------------------

  const reproducir = (
    slot: string,
    def: SoundSlot,
    decoded: readonly AudioBuffer[],
    pan: number,
  ): void => {
    const buffer = decoded[Math.floor(Math.random() * decoded.length)];
    if (buffer === undefined) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * def.pitchVariance;
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    const gain = context.createGain();
    gain.gain.value = def.volume;
    source.connect(panner);
    panner.connect(gain);
    gain.connect(buses[def.bus]);
    voces.set(slot, (voces.get(slot) ?? 0) + 1);
    source.onended = () => {
      if (disposed) return;
      voces.set(slot, Math.max(0, (voces.get(slot) ?? 1) - 1));
      source.disconnect();
      panner.disconnect();
      gain.disconnect();
    };
    source.start();
  };

  const cue = (slot: string, world?: WorldPoint): void => {
    if (disposed) return;
    const def = manifest[slot];
    if (def === undefined || def.files.length === 0) {
      registrar(slot, 'sin-archivo', 0);
      return;
    }
    if (context.state !== 'running') {
      registrar(slot, 'sin-desbloquear', 0);
      void context.resume().catch(() => undefined);
      return;
    }

    const ahora = clock();
    const anterior = ultimaSenal.get(slot) ?? Number.NEGATIVE_INFINITY;
    if (ahora - anterior < def.cooldownMs) {
      registrar(slot, 'descartada-cooldown', 0);
      return;
    }
    if ((voces.get(slot) ?? 0) >= def.maxVoices) {
      registrar(slot, 'descartada-voces', 0);
      return;
    }

    const pan =
      world !== undefined && options.panOf !== undefined ? limitar(options.panOf(world), -1, 1) : 0;
    const decoded = buffers.get(slot);
    if (decoded === undefined) {
      // La carga sigue en curso (o recien arranca): se dispara y se espera.
      registrar(slot, 'decodificando', pan);
      void loadSlot(slot, def);
      return;
    }
    if (decoded.length === 0) {
      // La carga termino y no quedo ningun archivo utilizable.
      registrar(slot, 'sin-archivo', pan);
      return;
    }

    ultimaSenal.set(slot, ahora);
    reproducir(slot, def, decoded, pan);
    registrar(slot, 'sono', pan);
  };

  // --- API publica -----------------------------------------------------------

  const unlock = async (): Promise<void> => {
    if (context.state === 'running') return;
    try {
      await context.resume();
    } catch {
      // El gesto del usuario todavia no llego: silencio hasta que llegue.
    }
  };

  const setAmbienceHeat = (value: number): void => {
    pendingHeat = limitar(value, 0, 1);
    aplicarCalor(pendingHeat);
  };

  const setBusVolume = (bus: AudioBus, value: number): void => {
    volumen[bus] = limitar(value, 0, 1);
    guardar(storage, CLAVE_VOLUMEN[bus], String(volumen[bus]));
    aplicarBuses();
  };

  const setMuted = (muted: boolean): void => {
    mute = muted;
    guardar(storage, CLAVE_MUTE, String(mute));
    aplicarBuses();
  };

  const slotStatuses = (): readonly SlotStatus[] =>
    Object.entries(manifest).map(([name, definition]) => {
      const ready = buffers.get(name)?.length ?? 0;
      return {
        name,
        definition,
        ready,
        available: ready > 0,
        loading: buffers.get(name) === undefined && slotLoads.has(name),
      };
    });

  const dispose = (): void => {
    disposed = true;
    for (const layer of ambients.values()) {
      try {
        layer.source.stop();
      } catch {
        // Ya estaba detenido.
      }
      layer.gain.disconnect();
    }
    ambients.clear();
    slotLoads.clear();
    buffers.clear();
    if (ownsContext) void context.close().catch(() => undefined);
  };

  return {
    load,
    unlock,
    cue,
    setAmbienceHeat,
    setBusVolume,
    busVolume: (bus) => volumen[bus],
    setMuted,
    isMuted: () => mute,
    manifestErrors: () => errores,
    slotStatuses,
    cueLog: () => [...historial],
    dispose,
  };
}

function leerBool(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined,
  clave: string,
  porDefecto: boolean,
): boolean {
  try {
    const valor = storage?.getItem(clave);
    return valor === null ? porDefecto : valor === 'true';
  } catch {
    return porDefecto;
  }
}

function leerNumero(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined,
  clave: string,
  porDefecto: number,
): number {
  try {
    const valor = storage?.getItem(clave);
    if (valor === null) return porDefecto;
    const numero = Number(valor);
    return Number.isFinite(numero) ? limitar(numero, 0, 1) : porDefecto;
  } catch {
    return porDefecto;
  }
}

function guardar(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined,
  clave: string,
  valor: string,
): void {
  try {
    storage?.setItem(clave, valor);
  } catch {
    // Sin almacenamiento: el ajuste no persiste, y no pasa nada.
  }
}
