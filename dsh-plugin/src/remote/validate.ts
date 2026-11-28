import { DEFAULT_SETTINGS, SETTING_BOUNDS, type ConversionSettings } from './types.ts'

const ID = /^[a-z0-9_]{1,40}$/
const PRESET = /^[\p{L}\p{N} _.-]{1,40}$/u
const HEX = /^#[0-9A-Fa-f]{6}$/

export type SettingsIssue = { readonly field: keyof ConversionSettings; readonly reason: 'type' | 'range' | 'format' }

/**
 * Validate settings against the Python CLI's own accepted ranges. Shared by
 * the Host (authoritative second check) and the Client (early feedback).
 * @param input - untrusted settings object.
 * @returns normalized settings, or the first issue found.
 */
export function validateSettings(input: unknown): { ok: true; value: ConversionSettings } | { ok: false; issue: SettingsIssue } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, issue: { field: 'brand', reason: 'type' } }
  const raw = input as Record<string, unknown>
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (raw[key] !== undefined) merged[key] = raw[key]
  }
  if (typeof merged.brand !== 'string' || !ID.test(merged.brand)) return { ok: false, issue: { field: 'brand', reason: 'format' } }
  if (typeof merged.preset !== 'string' || (merged.preset !== '' && !PRESET.test(merged.preset))) return { ok: false, issue: { field: 'preset', reason: 'format' } }
  if (typeof merged.background !== 'string' || !HEX.test(merged.background)) return { ok: false, issue: { field: 'background', reason: 'format' } }
  for (const [field, [min, max, integer]] of Object.entries(SETTING_BOUNDS) as [keyof typeof SETTING_BOUNDS, readonly [number, number, boolean]][]) {
    const value = merged[field]
    if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, issue: { field, reason: 'type' } }
    if (integer && !Number.isInteger(value)) return { ok: false, issue: { field, reason: 'type' } }
    if (value < min || value > max) return { ok: false, issue: { field, reason: 'range' } }
  }
  const beadMm = merged.beadMm as number
  if (beadMm !== 0 && beadMm < 0.1) return { ok: false, issue: { field: 'beadMm', reason: 'range' } }
  return {
    ok: true,
    value: {
      brand: merged.brand,
      preset: merged.preset,
      width: merged.width as number,
      height: merged.height as number,
      maxColors: merged.maxColors as number,
      beadMm,
      background: merged.background.toUpperCase(),
      boardWidth: merged.boardWidth as number,
      boardHeight: merged.boardHeight as number,
      packSize: merged.packSize as number,
      sparePercent: merged.sparePercent as number,
    },
  }
}
