/**
 * Validacion del `territories.config.json` con zod.
 * El build falla temprano y con mensajes claros si la config esta mal.
 */

import { z } from 'zod';

const localizedNamesSchema = z.object({
  'es-AR': z.string().min(1),
  en: z.string().min(1),
});

const territorySourceSchema = z
  .object({
    countries: z.array(z.string().min(2)).optional(),
    subdivisions: z.record(z.string().min(2), z.array(z.string().min(1)).min(1)).optional(),
  })
  .refine(
    (source) =>
      (source.countries !== undefined && source.countries.length > 0) ||
      (source.subdivisions !== undefined && Object.keys(source.subdivisions).length > 0),
    { message: 'cada territorio necesita `countries` o `subdivisions`' },
  );

const territorySchema = z.object({
  id: z.string().min(1),
  names: localizedNamesSchema,
  continent: z.string().min(1),
  source: territorySourceSchema,
  seaLinks: z.array(z.string().min(1)).optional(),
  ignoreLandBorders: z.array(z.string().min(1)).optional(),
});

export const mapConfigSchema = z.object({
  version: z.number().int().positive(),
  dataset: z.object({
    dir: z.string().min(1),
    admin0: z.string().min(1),
    admin1: z.string().min(1),
    scale: z.string().min(1),
  }),
  build: z.object({
    simplificationTolerance: z.number().positive(),
    quantization: z.number().int().positive(),
    minIslandAreaKm2: z.number().nonnegative(),
    absorbUnassigned: z.boolean(),
  }),
  continents: z.array(z.object({ id: z.string().min(1), names: localizedNamesSchema })).min(1),
  territories: z.array(territorySchema).min(1),
});

export type MapConfigInput = z.infer<typeof mapConfigSchema>;
