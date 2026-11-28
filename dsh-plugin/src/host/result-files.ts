/**
 * Read and verify the seven files the Python engine writes. Only names from a
 * fixed list are served, and each resolved file must stay inside its job.
 */
import { lstat, readFile, realpath, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { LIMITS, MEDIA_TYPES, RESULT_FILES, type JobFileName, type JobSummary, type MaterialRow, type ResultFileName, type ResultFilePayload } from '../remote/types.ts'
import { RequestFailure } from './errors.ts'
import { isInside, type JobPaths } from './job-store.ts'

/** Which of the seven expected outputs exist as non-empty regular files. */
export async function presentOutputs(output: string): Promise<{ present: ResultFileName[]; missing: ResultFileName[] }> {
  const present: ResultFileName[] = []
  const missing: ResultFileName[] = []
  for (const name of RESULT_FILES) {
    try {
      const info = await lstat(join(output, name))
      if (info.isFile() && info.size > 0) present.push(name)
      else missing.push(name)
    } catch {
      missing.push(name)
    }
  }
  return { present, missing }
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Summarize usage.json for display. Values are copied, never recomputed. */
export function summarizeUsage(usage: unknown): { summary: JobSummary; materials: MaterialRow[] } {
  const u = (usage ?? {}) as Record<string, Record<string, unknown> | undefined>
  const brand = u.brand ?? {}
  const settings = u.settings ?? {}
  const local = u.local_usage ?? {}
  const quality = u.match_quality ?? {}
  const rows = Array.isArray((usage as { materials?: unknown } | null)?.materials) ? (usage as { materials: Record<string, unknown>[] }).materials : []
  return {
    summary: {
      brand: text(brand.display) || text(brand.name),
      brandId: text(brand.id),
      gridWidth: number(settings.grid_width),
      gridHeight: number(settings.grid_height),
      placedBeads: number(local.placed_beads),
      blankCells: number(local.blank_cells),
      usedColors: number(local.used_colors),
      estimatedWidthCm: number(local.estimated_width_cm),
      estimatedHeightCm: number(local.estimated_height_cm),
      estimatedBoards: number(local.estimated_boards),
      purchaseBeads: number(local.purchase_beads_including_spare),
      estimatedPacks: number(local.estimated_packs),
      meanDeltaE00: number(quality.mean_delta_e00),
      maxDeltaE00: number(quality.max_delta_e00),
    },
    materials: rows.slice(0, 2093).map(row => ({
      code: text(row.code),
      name: text(row.name),
      referenceHex: text(row.reference_hex),
      origin: text(row.origin),
      beadCount: number(row.bead_count),
      purchaseBeads: number(row.purchase_beads),
      packsToBuy: number(row.packs_to_buy),
    })),
  }
}

/** Resolve the stored source image of a job (the only file in input/). */
async function sourcePath(paths: JobPaths): Promise<string> {
  const names = (await readdir(paths.input)).filter(name => /^source\.[a-z]{3,4}$/.test(name))
  const first = names[0]
  if (first === undefined) throw new RequestFailure('bead-atlas/not-found', 'source image not found', {})
  return join(paths.input, first)
}

/**
 * Read one job file for download or preview.
 * @param paths - Host-derived job paths.
 * @param name - requested name; must be one of the fixed names.
 */
export async function readJobFile(paths: JobPaths, name: unknown): Promise<ResultFilePayload> {
  if (name !== 'source' && !(RESULT_FILES as readonly unknown[]).includes(name)) {
    throw new RequestFailure('bead-atlas/bad-request', 'unknown result file', {})
  }
  const fileName = name as JobFileName
  const path = fileName === 'source' ? await sourcePath(paths) : join(paths.output, fileName)
  let real: string
  try { real = await realpath(path) } catch { throw new RequestFailure('bead-atlas/not-found', 'result file not found', { name: fileName }) }
  const realDir = await realpath(paths.dir)
  if (!isInside(realDir, real)) throw new RequestFailure('bead-atlas/bad-request', 'result path escapes the job directory', {})
  const info = await lstat(real)
  if (!info.isFile()) throw new RequestFailure('bead-atlas/not-found', 'result file not found', { name: fileName })
  if (info.size > LIMITS.maxResultBytes) throw new RequestFailure('bead-atlas/file-too-large', 'result file is too large to transfer', { name: fileName })
  const bytes = await readFile(real)
  const mediaType = fileName === 'source' ? sourceMediaType(real) : MEDIA_TYPES[fileName]
  return { name: fileName, mediaType, bytes: bytes.length, dataBase64: bytes.toString('base64') }
}

function sourceMediaType(path: string): string {
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.jpg')) return 'image/jpeg'
  if (path.endsWith('.webp')) return 'image/webp'
  if (path.endsWith('.gif')) return 'image/gif'
  if (path.endsWith('.bmp')) return 'image/bmp'
  return 'application/octet-stream'
}
