/**
 * Manifiesto de modelos: esquema y validacion.
 *
 * Funcion PURA: no toca el DOM, ni three, ni la red. Convierte el JSON que
 * edita el usuario (`public/models/combat/manifest.json`) en definiciones
 * tipadas, o explica por que no se puede (ADR 0012).
 *
 * Convenciones:
 *   - El manifiesto mapea TIPO de unidad → archivo. Los tipos son los tres del
 *     motor (`infantry`, `cavalry`, `artillery`) mas `ship`, que solo aparece
 *     en los cruces maritimos.
 *   - Las rutas son relativas al manifiesto (o sea, a `models/combat/`); la
 *     convencion de nombres es `public/models/combat/<tipo>.glb`.
 *   - Un manifiesto vacio `{}` es valido: significa «todavia no hay modelos» y
 *     el juego usa las primitivas sin errores.
 *   - Un tipo ausente del manifiesto tambien es valido: ese tipo sigue con su
 *     primitiva mientras los demas usan el modelo final.
 */

import type { Result, UnitType } from '@conqueror/rules';

/** Tipos que pueden tener modelo propio: los tres del motor mas el navio. */
export type UnitModelType = UnitType | 'ship';

/** Definicion del modelo de un tipo. */
export interface ModelSlot {
  /** Ruta del archivo glTF/GLB, relativa al manifiesto. */
  readonly file: string;
  /** Escala aplicada al modelo (la especificacion pide escala unitaria). */
  readonly scale: number;
  /** Desplazamiento vertical, aplicado DESPUES de la escala. */
  readonly yOffset: number;
  /**
   * Atributo de vertice con el color base. En el glTF se llama `COLOR_0`, pero
   * three lo renombra a `color` al cargarlo: ese es el nombre que se espera
   * aca. Si el modelo no lo trae, se usa `baseColor`.
   */
  readonly colorAttribute: string;
  /**
   * Atributo de vertice con la mascara de uniforme (1 = se tine con el color
   * del jugador). Los atributos propios del glTF empiezan con `_`.
   */
  readonly maskAttribute: string;
  /** Mascara a usar cuando el modelo no trae el atributo: 0 = neutro. */
  readonly maskValue: number;
  /** Color plano del modelo cuando no trae color por vertice. */
  readonly baseColor: string;
  /**
   * Canal del atlas que lleva la mascara, si el artista la pinto en la textura
   * en vez de por vertice. `none` = usar el atributo.
   */
  readonly maskChannel: MaskChannel;
}

/** Canal de la textura que puede llevar la mascara de uniforme. */
export type MaskChannel = 'none' | 'r' | 'g' | 'b' | 'a';

/** Manifiesto completo: tipo → definicion. Un tipo ausente usa su primitiva. */
export type ModelManifest = Readonly<Partial<Record<UnitModelType, ModelSlot>>>;

/** Orden estable de los tipos, para recorrer el manifiesto siempre igual. */
export const UNIT_MODEL_TYPES: readonly UnitModelType[] = [
  'infantry',
  'cavalry',
  'artillery',
  'ship',
];

/** Valores por defecto de un tipo cuando el usuario omite campos. */
export const DEFAULT_MODEL_SLOT: Omit<ModelSlot, 'file'> = {
  scale: 1,
  yOffset: 0,
  colorAttribute: 'color',
  maskAttribute: '_MASK',
  maskValue: 0,
  baseColor: '#ffffff',
  maskChannel: 'none',
};

/** Canales aceptados por el manifiesto. */
export const MASK_CHANNELS: readonly MaskChannel[] = ['none', 'r', 'g', 'b', 'a'];

/**
 * Presupuesto de triangulos por tipo, en unidades del modelo (no de la
 * instancia). Es la seccion 12 del plan de combate y la tabla de
 * `docs/art-spec.md`: un modelo por encima del presupuesto se carga igual,
 * pero la pagina `/debug/models` lo marca en rojo.
 */
export const TRIANGLE_BUDGET: Readonly<Record<UnitModelType, number>> = {
  infantry: 500,
  cavalry: 500,
  artillery: 800,
  ship: 1200,
};

/** Campos reconocidos de un tipo: cualquier otro es una errata del usuario. */
const KNOWN_FIELDS: readonly string[] = [
  'file',
  'scale',
  'yOffset',
  'colorAttribute',
  'maskAttribute',
  'maskValue',
  'baseColor',
  'maskChannel',
];

/** Un identificador valido de atributo de vertice (mismo alfabeto que GLSL). */
const ATTRIBUTE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Un color plano en hexadecimal de seis digitos. */
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Atributos que no se pueden usar como fuente: romperian la geometria. */
const RESERVED_ATTRIBUTES: readonly string[] = ['position', 'normal'];

/** Extensiones aceptadas para el archivo del modelo. */
const EXTENSIONS: readonly string[] = ['.glb', '.gltf'];

function esNumero(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Una ruta de archivo: relativa, sin escapar del directorio del manifiesto. */
function esRutaValida(path: string): boolean {
  if (path === '') return false;
  // Ni absoluta ni con separadores de Windows: el manifiesto vive servido.
  if (path.includes('\\')) return false;
  if (path.startsWith('/')) return false;
  // Sin subir de directorio.
  for (const segmento of path.split('/')) {
    if (segmento === '..') return false;
  }
  return EXTENSIONS.some((extension) => path.toLowerCase().endsWith(extension));
}

function validarAtributo(type: UnitModelType, field: string, value: string): string | null {
  if (!ATTRIBUTE_PATTERN.test(value)) {
    return `el tipo «${type}»: «${field}» debe ser un nombre de atributo valido`;
  }
  if (RESERVED_ATTRIBUTES.includes(value)) {
    return `el tipo «${type}»: «${field}» no puede ser «${value}»`;
  }
  return null;
}

/**
 * Valida UN tipo a partir de su valor crudo del JSON.
 * Devuelve la definicion con los valores por defecto aplicados.
 */
export function normalizeModelSlot(type: string, raw: unknown): Result<ModelSlot, string> {
  if (!UNIT_MODEL_TYPES.includes(type as UnitModelType)) {
    return {
      ok: false,
      error: `el tipo «${type}» no existe (se espera ${UNIT_MODEL_TYPES.join(', ')})`,
    };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: `el tipo «${type}» debe ser un objeto` };
  }

  const slot = raw as Record<string, unknown>;
  for (const key of Object.keys(slot)) {
    if (!KNOWN_FIELDS.includes(key)) {
      return { ok: false, error: `el tipo «${type}» tiene el campo desconocido «${key}»` };
    }
  }

  if (typeof slot.file !== 'string' || !esRutaValida(slot.file)) {
    return {
      ok: false,
      error: `el tipo «${type}»: «file» debe ser una ruta relativa a un .glb o .gltf`,
    };
  }

  let scale = DEFAULT_MODEL_SLOT.scale;
  if (slot.scale !== undefined) {
    if (!esNumero(slot.scale) || slot.scale <= 0) {
      return { ok: false, error: `el tipo «${type}»: «scale» debe ser mayor que 0` };
    }
    scale = slot.scale;
  }

  let yOffset = DEFAULT_MODEL_SLOT.yOffset;
  if (slot.yOffset !== undefined) {
    if (!esNumero(slot.yOffset)) {
      return { ok: false, error: `el tipo «${type}»: «yOffset» debe ser un numero` };
    }
    yOffset = slot.yOffset;
  }

  let colorAttribute = DEFAULT_MODEL_SLOT.colorAttribute;
  if (slot.colorAttribute !== undefined) {
    if (typeof slot.colorAttribute !== 'string') {
      return { ok: false, error: `el tipo «${type}»: «colorAttribute» debe ser texto` };
    }
    const problema = validarAtributo(type as UnitModelType, 'colorAttribute', slot.colorAttribute);
    if (problema !== null) return { ok: false, error: problema };
    colorAttribute = slot.colorAttribute;
  }

  let maskAttribute = DEFAULT_MODEL_SLOT.maskAttribute;
  if (slot.maskAttribute !== undefined) {
    if (typeof slot.maskAttribute !== 'string') {
      return { ok: false, error: `el tipo «${type}»: «maskAttribute» debe ser texto` };
    }
    const problema = validarAtributo(type as UnitModelType, 'maskAttribute', slot.maskAttribute);
    if (problema !== null) return { ok: false, error: problema };
    maskAttribute = slot.maskAttribute;
  }

  let maskValue = DEFAULT_MODEL_SLOT.maskValue;
  if (slot.maskValue !== undefined) {
    if (!esNumero(slot.maskValue) || slot.maskValue < 0 || slot.maskValue > 1) {
      return { ok: false, error: `el tipo «${type}»: «maskValue» debe estar entre 0 y 1` };
    }
    maskValue = slot.maskValue;
  }

  let baseColor = DEFAULT_MODEL_SLOT.baseColor;
  if (slot.baseColor !== undefined) {
    if (typeof slot.baseColor !== 'string' || !COLOR_PATTERN.test(slot.baseColor)) {
      return {
        ok: false,
        error: `el tipo «${type}»: «baseColor» debe ser un color #rrggbb`,
      };
    }
    baseColor = slot.baseColor.toLowerCase();
  }

  let maskChannel = DEFAULT_MODEL_SLOT.maskChannel;
  if (slot.maskChannel !== undefined) {
    if (!MASK_CHANNELS.includes(slot.maskChannel as MaskChannel)) {
      return {
        ok: false,
        error: `el tipo «${type}»: «maskChannel» debe ser ${MASK_CHANNELS.join(', ')}`,
      };
    }
    maskChannel = slot.maskChannel as MaskChannel;
  }

  return {
    ok: true,
    value: {
      file: slot.file,
      scale,
      yOffset,
      colorAttribute,
      maskAttribute,
      maskValue,
      baseColor,
      maskChannel,
    },
  };
}

/**
 * Valida el manifiesto completo. Un manifiesto invalido se rechaza ENTERO
 * (todos los tipos quedan con su primitiva) y se explican todos los problemas.
 *
 * Las claves que empiezan con `_` se ignoran: JSON no tiene comentarios y el
 * usuario que edita el archivo a mano los necesita (misma convencion que glTF
 * para sus atributos propios).
 */
export function validateModelManifest(data: unknown): Result<ModelManifest, readonly string[]> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: ['el manifiesto debe ser un objeto de tipos'] };
  }

  const manifest: Partial<Record<UnitModelType, ModelSlot>> = {};
  const errores: string[] = [];

  for (const [type, raw] of Object.entries(data as Record<string, unknown>)) {
    if (type.startsWith('_')) continue;
    const resultado = normalizeModelSlot(type, raw);
    if (resultado.ok) manifest[type as UnitModelType] = resultado.value;
    else errores.push(resultado.error);
  }

  if (errores.length > 0) return { ok: false, error: errores };
  return { ok: true, value: manifest };
}

/**
 * Nombre de archivo esperado para un tipo, segun la convencion del plan
 * (`<tipo>.glb`). Lo usa la pagina `/debug/models` para mostrar que falta.
 */
export function expectedModelFileName(type: UnitModelType): string {
  return `${type}.glb`;
}
