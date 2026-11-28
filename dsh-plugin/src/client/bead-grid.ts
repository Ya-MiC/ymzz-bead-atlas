/**
 * Pure helpers for the interactive bead grid: hit testing, same-code counts,
 * recolouring, and the live materials list. No palette data lives here; codes,
 * names and colours come from the engine's coordinates.csv and the Host's
 * engine-read palette.
 */
import type { ConversionSettings, MaterialRow, PaletteEntry } from '../remote/types.ts'

/** Row-major codes, '' for an empty (no bead) cell. */
export type GridCodes = readonly string[]

/**
 * Cell index under a point, or null outside the grid.
 * @param x - offset from the grid's left edge, CSS px.
 * @param y - offset from the grid's top edge, CSS px.
 */
export function cellAt(x: number, y: number, cellSize: number, width: number, height: number): number | null {
  if (x < 0 || y < 0 || cellSize <= 0) return null
  const column = Math.floor(x / cellSize)
  const row = Math.floor(y / cellSize)
  if (column >= width || row >= height) return null
  return row * width + column
}

/** How many cells use each code ('' counts empty cells). */
export function countCodes(codes: GridCodes): Map<string, number> {
  const counts = new Map<string, number>()
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1)
  return counts
}

/**
 * Replace one cell, or every cell sharing that cell's code. Empty cells are never changed.
 * @returns the new codes and how many cells changed.
 */
export function recolor(codes: GridCodes, index: number, replacement: string, scope: 'cell' | 'code'): { codes: string[]; changed: number } {
  const from = codes[index]
  if (from === undefined || from === '' || replacement === '' || from === replacement) return { codes: [...codes], changed: 0 }
  let changed = 0
  const next = codes.map((code, at) => {
    if (code === '' || code !== from) return code
    if (scope === 'cell' && at !== index) return code
    changed++
    return replacement
  })
  return { codes: next, changed }
}

/** Indices whose code differs between two grids. */
export function changedCells(before: GridCodes, after: GridCodes): number {
  let count = 0
  for (let index = 0; index < before.length; index++) if (before[index] !== after[index]) count++
  return count
}

export interface LiveTotals {
  readonly placedBeads: number
  readonly blankCells: number
  readonly usedColors: number
  readonly purchaseBeads: number
  readonly estimatedPacks: number
}

/**
 * Materials for an edited grid, using the same arithmetic convert.py prints in
 * materials.csv: spare = ceil(count × spare% / 100), packs = ceil(purchase / pack size),
 * rows sorted by count (desc) then code. Empty cells are never counted.
 * @param codes - edited grid.
 * @param lookup - code → engine palette entry (names and reference colours).
 * @param settings - the job's settings (spare percent, pack size).
 */
export function liveMaterials(codes: GridCodes, lookup: ReadonlyMap<string, Pick<PaletteEntry, 'name' | 'hex' | 'origin'>>, settings: Pick<ConversionSettings, 'sparePercent' | 'packSize'>): { materials: MaterialRow[]; totals: LiveTotals } {
  const counts = countCodes(codes)
  const blankCells = counts.get('') ?? 0
  counts.delete('')
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  const materials = rows.map(([code, beadCount]) => {
    const entry = lookup.get(code)
    const spare = Math.ceil(beadCount * settings.sparePercent / 100)
    const purchaseBeads = beadCount + spare
    return {
      code,
      name: entry?.name ?? code,
      referenceHex: entry?.hex ?? '',
      origin: entry?.origin ?? '',
      beadCount,
      purchaseBeads,
      packsToBuy: Math.ceil(purchaseBeads / settings.packSize),
    }
  })
  return {
    materials,
    totals: {
      placedBeads: materials.reduce((sum, row) => sum + row.beadCount, 0),
      blankCells,
      usedColors: materials.length,
      purchaseBeads: materials.reduce((sum, row) => sum + row.purchaseBeads, 0),
      estimatedPacks: materials.reduce((sum, row) => sum + row.packsToBuy, 0),
    },
  }
}
