/**
 * Descarga los datos crudos de Natural Earth (dominio publico) a `data/ne/`.
 *
 * Los archivos NO se versionan: `pnpm map:fetch` los baja cuando hacen falta.
 * Escala elegida: 50m. Se necesita esa escala (y no 110m) porque el tablero
 * divide algunos paises en regiones (Alaska, California, Siberia, Kamchatka...)
 * y las subdivisiones de primer nivel solo existen a 50m y 10m.
 *
 * Ver docs/adr/0004-datos-de-mapa-natural-earth.md
 */

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(REPO_ROOT, 'data', 'ne');

const BASE_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';

interface RemoteFile {
  readonly name: string;
  readonly minBytes: number;
}

const FILES: readonly RemoteFile[] = [
  { name: 'ne_50m_admin_0_countries.geojson', minBytes: 1_000_000 },
  { name: 'ne_50m_admin_1_states_provinces.geojson', minBytes: 1_000_000 },
];

async function existsWithSize(path: string, minBytes: number): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.size >= minBytes;
  } catch {
    return false;
  }
}

async function download(file: RemoteFile): Promise<void> {
  const destination = join(DATA_DIR, file.name);

  if (await existsWithSize(destination, file.minBytes)) {
    console.log(`[map:fetch] ya existe ${file.name}, se omite`);
    return;
  }

  const url = `${BASE_URL}/${file.name}`;
  console.log(`[map:fetch] descargando ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fallo la descarga de ${url}: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength < file.minBytes) {
    throw new Error(
      `Descarga incompleta de ${file.name}: ${buffer.byteLength} bytes (minimo ${file.minBytes})`,
    );
  }

  await writeFile(destination, buffer);
  console.log(`[map:fetch] guardado ${file.name} (${(buffer.byteLength / 1e6).toFixed(1)} MB)`);
}

async function main(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  for (const file of FILES) {
    await download(file);
  }
  console.log(`[map:fetch] datos listos en ${DATA_DIR}`);
}

main().catch((error: unknown) => {
  console.error('[map:fetch] error:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
