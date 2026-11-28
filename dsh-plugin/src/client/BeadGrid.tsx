/**
 * Interactive bead grid for one finished job.
 *
 * - Base layer: one Canvas 2D draw of every cell (thousands of beads stay cheap).
 *   Empty cells (transparent source pixels) are drawn as a checkerboard.
 * - Overlay canvas: dims cells of other codes so every cell sharing the hovered
 *   (or selected) code stands out; redrawn only when that code changes.
 * - One small DOM element lifts the hovered cell in place (a short vertical move
 *   and a restrained shadow; no particles, no glow). Reduced motion keeps only an outline.
 * - Recolouring picks a replacement from the engine-read palette for one cell or
 *   every cell of the same code; materials update at once. Regenerating the files
 *   hands the edited grid back to the unchanged engine as a new job.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { parseCoordinates } from '../remote/csv.ts'
import type { JobPalette, JobRecord, MaterialRow, PaletteEntry } from '../remote/types.ts'
import type { BeadAtlasApi } from './api.ts'
import { cellAt, changedCells, countCodes, liveMaterials, recolor, type LiveTotals } from './bead-grid.ts'
import { payloadToText } from './files.ts'
import { formatNumber } from './format.ts'
import type { Translate } from './locales.ts'
import css from '../../styles/bead-atlas.module.css'

export interface GridEdits {
  readonly materials: readonly MaterialRow[]
  readonly totals: LiveTotals
  readonly changed: number
}

export interface BeadGridProps {
  readonly t: Translate
  readonly api: BeadAtlasApi
  readonly job: JobRecord
  /** True while another job runs; regenerating is then unavailable. */
  readonly busy: boolean
  /** Called with live materials while the grid differs from the engine output, else null. */
  readonly onEdits: (edits: GridEdits | null) => void
  /** Regenerate the files from the edited grid. */
  readonly onRegenerate: (codes: readonly string[]) => Promise<void>
}

type Loaded =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ready'; base: string[]; hexByCode: Map<string, string>; palette: JobPalette | null; paletteFailed: boolean }

const MIN_CELL = 6
const MAX_CELL = 28
const HISTORY_LIMIT = 50

interface Theme { checkA: string; checkB: string; veil: string; ring: string; line: string }

function readTheme(element: HTMLElement | null): Theme {
  const style = element === null ? null : getComputedStyle(element)
  const value = (name: string, fallback: string) => style?.getPropertyValue(name).trim() || fallback
  return {
    checkA: value('--ba-check-a', '#F8F6EF'),
    checkB: value('--ba-check-b', 'rgba(61, 56, 51, 0.10)'),
    veil: value('--ba-veil', 'rgba(248, 246, 239, 0.72)'),
    ring: value('--ba-ring', '#3D3833'),
    line: value('--ba-grid-line', 'rgba(61, 56, 51, 0.12)'),
  }
}

function drawChecker(context: CanvasRenderingContext2D, x: number, y: number, size: number, theme: Theme): void {
  context.fillStyle = theme.checkA
  context.fillRect(x, y, size, size)
  context.fillStyle = theme.checkB
  const half = size / 2
  context.fillRect(x, y, half, half)
  context.fillRect(x + half, y + half, size - half, size - half)
}

function prepare(canvas: HTMLCanvasElement | null, width: number, height: number): CanvasRenderingContext2D | null {
  if (canvas === null) return null
  let context: CanvasRenderingContext2D | null = null
  try { context = canvas.getContext('2d') } catch { context = null }
  if (context === null) return null
  const ratio = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1
  canvas.width = Math.round(width * ratio)
  canvas.height = Math.round(height * ratio)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  return context
}

export function BeadGrid({ t, api, job, busy, onEdits, onRegenerate }: BeadGridProps) {
  const width = job.summary?.gridWidth ?? 0
  const height = job.summary?.gridHeight ?? 0
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [codes, setCodes] = useState<string[]>([])
  const [history, setHistory] = useState<string[][]>([])
  const [hover, setHover] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [scope, setScope] = useState<'cell' | 'code'>('code')
  const [search, setSearch] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [cellSize, setCellSize] = useState(14)
  const stage = useRef<HTMLDivElement>(null)
  const baseCanvas = useRef<HTMLCanvasElement>(null)
  const overlayCanvas = useRef<HTMLCanvasElement>(null)
  const dragging = useRef(false)

  // Load the engine's coordinates.csv and the engine-read palette for this job.
  useEffect(() => {
    const controller = new AbortController()
    setLoaded({ state: 'loading' })
    setHover(null)
    setSelected(null)
    setHistory([])
    void (async () => {
      const [coordinates, palette] = await Promise.all([
        api.getResultFile({ jobId: job.id, name: 'coordinates.csv' }, controller.signal),
        api.getPalette({ jobId: job.id }, controller.signal),
      ])
      if (controller.signal.aborted) return
      const grid = coordinates.ok ? parseCoordinates(payloadToText(coordinates.value), width, height) : null
      if (grid === null) { setLoaded({ state: 'failed' }); return }
      const hexByCode = new Map<string, string>()
      for (const cell of grid) if (cell.code !== null && cell.hex !== null) hexByCode.set(cell.code, cell.hex)
      const base = grid.map(cell => cell.code ?? '')
      setCodes(base)
      setLoaded({ state: 'ready', base, hexByCode, palette: palette.ok ? palette.value : null, paletteFailed: !palette.ok })
    })()
    return () => { controller.abort() }
  }, [api, job.id, width, height])

  // Fit the cell size to the available width.
  useEffect(() => {
    const element = stage.current
    if (element === null || width === 0) return
    const fit = () => {
      const available = element.clientWidth - 16
      if (available <= 0) return
      setCellSize(Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor(available / width))))
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [width, loaded.state])

  const lookup = useMemo(() => {
    const map = new Map<string, Pick<PaletteEntry, 'name' | 'hex' | 'origin'>>()
    if (loaded.state !== 'ready') return map
    for (const row of job.materials) map.set(row.code, { name: row.name, hex: row.referenceHex, origin: row.origin })
    for (const entry of loaded.palette?.entries ?? []) map.set(entry.code, entry)
    return map
  }, [loaded, job.materials])

  const hexOf = useCallback((code: string): string | null => {
    if (code === '') return null
    return lookup.get(code)?.hex ?? (loaded.state === 'ready' ? loaded.hexByCode.get(code) ?? null : null)
  }, [lookup, loaded])

  const counts = useMemo(() => countCodes(codes), [codes])
  const changed = loaded.state === 'ready' ? changedCells(loaded.base, codes) : 0

  // Report live materials upward while the grid differs from the engine output.
  useEffect(() => {
    if (loaded.state !== 'ready' || changed === 0) { onEdits(null); return }
    const { materials, totals } = liveMaterials(codes, lookup, job.settings)
    onEdits({ materials, totals, changed })
  }, [codes, changed, loaded.state, lookup, job.settings, onEdits])

  // Base layer: every cell once.
  useEffect(() => {
    if (loaded.state !== 'ready') return
    const context = prepare(baseCanvas.current, width * cellSize, height * cellSize)
    if (context === null) return
    const theme = readTheme(stage.current)
    codes.forEach((code, index) => {
      const x = (index % width) * cellSize
      const y = Math.floor(index / width) * cellSize
      const hex = hexOf(code)
      if (hex === null) drawChecker(context, x, y, cellSize, theme)
      else { context.fillStyle = hex; context.fillRect(x, y, cellSize, cellSize) }
    })
    if (cellSize >= 8) {
      context.strokeStyle = theme.line
      context.lineWidth = 1
      context.beginPath()
      for (let column = 0; column <= width; column++) { context.moveTo(column * cellSize + 0.5, 0); context.lineTo(column * cellSize + 0.5, height * cellSize) }
      for (let row = 0; row <= height; row++) { context.moveTo(0, row * cellSize + 0.5); context.lineTo(width * cellSize, row * cellSize + 0.5) }
      context.stroke()
    }
  }, [codes, cellSize, width, height, hexOf, loaded.state])

  const focusIndex = hover ?? selected
  const focusCode = focusIndex === null ? null : codes[focusIndex] ?? null

  // Overlay: dim other codes so the same code stands out; ring the selected cell.
  useEffect(() => {
    if (loaded.state !== 'ready') return
    const context = prepare(overlayCanvas.current, width * cellSize, height * cellSize)
    if (context === null) return
    const theme = readTheme(stage.current)
    if (focusCode !== null) {
      context.fillStyle = theme.veil
      codes.forEach((code, index) => {
        if (code === focusCode) return
        context.fillRect((index % width) * cellSize, Math.floor(index / width) * cellSize, cellSize, cellSize)
      })
    }
    if (selected !== null) {
      context.strokeStyle = theme.ring
      context.lineWidth = 2
      context.strokeRect((selected % width) * cellSize + 1, Math.floor(selected / width) * cellSize + 1, cellSize - 2, cellSize - 2)
    }
  }, [focusCode, selected, codes, cellSize, width, height, loaded.state])

  const locate = (event: PointerEvent<HTMLDivElement>): number | null => {
    const rect = event.currentTarget.getBoundingClientRect()
    return cellAt(event.clientX - rect.left, event.clientY - rect.top, cellSize, width, height)
  }

  const describe = (index: number): string => {
    const code = codes[index] ?? ''
    const row = Math.floor(index / width) + 1
    const column = (index % width) + 1
    if (code === '') return t('grid.infoBlank', { row, column, count: formatNumber(counts.get('') ?? 0) })
    return t('grid.info', { row, column, code, name: lookup.get(code)?.name ?? code, hex: hexOf(code) ?? '', count: formatNumber(counts.get(code) ?? 0) })
  }

  const apply = (replacement: string) => {
    if (selected === null) return
    const result = recolor(codes, selected, replacement, scope)
    if (result.changed === 0) return
    setHistory(previous => [...previous.slice(-(HISTORY_LIMIT - 1)), codes])
    setCodes(result.codes)
  }

  const undo = () => {
    const previous = history[history.length - 1]
    if (previous === undefined) return
    setHistory(history.slice(0, -1))
    setCodes(previous)
  }

  const resetAll = () => {
    if (loaded.state !== 'ready') return
    setHistory(previous => [...previous.slice(-(HISTORY_LIMIT - 1)), codes])
    setCodes(loaded.base)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = hover ?? selected ?? 0
    let next = current
    if (event.key === 'ArrowRight') next = Math.min(current + 1, width * height - 1)
    else if (event.key === 'ArrowLeft') next = Math.max(current - 1, 0)
    else if (event.key === 'ArrowDown') next = Math.min(current + width, width * height - 1)
    else if (event.key === 'ArrowUp') next = Math.max(current - width, 0)
    else if (event.key === 'Enter' || event.key === ' ') { setSelected(current); event.preventDefault(); return }
    else if (event.key === 'Escape') { setSelected(null); setHover(null); return }
    else return
    event.preventDefault()
    setHover(next)
  }

  if (job.summary === null) return null
  if (loaded.state === 'loading') return <p className={css.muted}>{t('grid.loading')}</p>
  if (loaded.state === 'failed') return <p className={css.errorText}>{t('grid.failed')}</p>

  const selectedCode = selected === null ? null : codes[selected] ?? null
  const entries = loaded.palette?.entries ?? []
  const query = search.trim().toLowerCase()
  const shown = query === '' ? entries : entries.filter(entry => entry.code.toLowerCase().includes(query) || entry.name.toLowerCase().includes(query))
  const lift = hover === null ? null : { x: (hover % width) * cellSize, y: Math.floor(hover / width) * cellSize, code: codes[hover] ?? '' }
  const blankCount = counts.get('') ?? 0

  return (
    <div className={css.gridBlock}>
      <div className={css.gridStage} ref={stage}>
        <div
          className={css.gridSurface}
          style={{ width: width * cellSize, height: height * cellSize }}
          tabIndex={0}
          role="application"
          aria-roledescription={t('grid.role')}
          aria-label={t('grid.label', { width, height })}
          aria-describedby="bead-atlas-grid-info"
          data-testid="bead-grid"
          onPointerMove={(event) => { const index = locate(event); setHover(index) }}
          onPointerDown={(event) => {
            dragging.current = true
            try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* not supported */ }
            setHover(locate(event))
          }}
          onPointerUp={(event) => {
            dragging.current = false
            const index = locate(event)
            if (index !== null) setSelected(index)
          }}
          onPointerLeave={() => { if (!dragging.current) setHover(null) }}
          onKeyDown={onKeyDown}
          onBlur={() => { setHover(null) }}
        >
          <canvas ref={baseCanvas} className={css.gridCanvas} aria-hidden="true" />
          <canvas ref={overlayCanvas} className={css.gridCanvas} aria-hidden="true" />
          {lift !== null && (
            <span
              key={hover}
              className={css.gridLift}
              data-blank={lift.code === '' || undefined}
              style={{ left: lift.x, top: lift.y, width: cellSize, height: cellSize, backgroundColor: hexOf(lift.code) ?? undefined }}
              aria-hidden="true"
            />
          )}
          {lift !== null && hover !== null && (
            <span
              className={css.gridTip}
              data-below={lift.y < 56 || undefined}
              style={{ left: Math.min(Math.max(lift.x + cellSize / 2, 90), Math.max(width * cellSize - 90, 90)), top: lift.y, ['--ba-tip-cell' as string]: `${cellSize}px` }}
              aria-hidden="true"
            >
              {lift.code === ''
                ? <><span className={css.checkerSwatch} />{t('grid.tipBlank')}</>
                : <><span className={css.swatch} style={{ backgroundColor: hexOf(lift.code) ?? undefined }} /><strong>{lift.code}</strong> {lookup.get(lift.code)?.name ?? ''} · <code className={css.code}>{hexOf(lift.code)}</code> · {t('grid.tipCount', { count: formatNumber(counts.get(lift.code) ?? 0) })}</>}
            </span>
          )}
        </div>
      </div>
      <p id="bead-atlas-grid-info" className={css.note} role="status" aria-live="polite">
        {focusIndex === null ? t('grid.hint') : describe(focusIndex)}
      </p>
      <p className={css.legend}>
        <span className={css.checkerSwatch} aria-hidden="true" />
        {t('grid.blankLegend', { count: formatNumber(blankCount) })}
      </p>

      <section className={css.recolor} aria-labelledby="bead-atlas-recolor-title">
        <div className={css.cardHeader}>
          <h3 id="bead-atlas-recolor-title" className={css.cardTitle}>{t('recolor.title')}</h3>
          <div className={css.row}>
            <Button variant="outline" size="sm" disabled={history.length === 0} onClick={undo}>{t('recolor.undo')}</Button>
            <Button variant="outline" size="sm" disabled={changed === 0} onClick={resetAll}>{t('recolor.reset')}</Button>
          </div>
        </div>
        {loaded.paletteFailed && <p className={css.errorText}>{t('recolor.paletteFailed')}</p>}
        {selected === null && !loaded.paletteFailed && <p className={css.muted}>{t('recolor.pick')}</p>}
        {selected !== null && selectedCode === '' && <p className={css.muted}>{t('recolor.blank')}</p>}
        {selected !== null && selectedCode !== null && selectedCode !== '' && loaded.palette !== null && (
          <>
            <p className={css.muted}>
              {t('recolor.selected', { code: selectedCode, name: lookup.get(selectedCode)?.name ?? selectedCode, count: formatNumber(counts.get(selectedCode) ?? 0) })}
            </p>
            <fieldset className={css.scope}>
              <legend className={css.fieldLabel}>{t('recolor.scope')}</legend>
              <label><input type="radio" name="bead-atlas-scope" checked={scope === 'cell'} onChange={() => { setScope('cell') }} /> {t('recolor.scopeCell')}</label>
              <label><input type="radio" name="bead-atlas-scope" checked={scope === 'code'} onChange={() => { setScope('code') }} /> {t('recolor.scopeCode', { code: selectedCode, count: formatNumber(counts.get(selectedCode) ?? 0) })}</label>
            </fieldset>
            <label className={css.field} htmlFor="bead-atlas-palette-search">
              <span className={css.fieldLabel}>{t('recolor.search', { brand: loaded.palette.brand, count: entries.length })}</span>
              <input id="bead-atlas-palette-search" className={css.input} value={search} onChange={(event) => { setSearch(event.target.value) }} autoComplete="off" spellCheck={false} />
            </label>
            <ul className={css.paletteGrid} aria-label={t('recolor.paletteLabel')}>
              {shown.map(entry => (
                <li key={entry.code}>
                  <button
                    type="button"
                    className={css.paletteButton}
                    disabled={entry.code === selectedCode || entry.sameAs !== null}
                    aria-pressed={entry.code === selectedCode}
                    title={entry.sameAs !== null ? t('recolor.sameAs', { code: entry.code, other: entry.sameAs }) : `${entry.code} ${entry.name} ${entry.hex}`}
                    aria-label={t('recolor.choose', { code: entry.code, name: entry.name, hex: entry.hex })}
                    onClick={() => { apply(entry.code) }}
                  >
                    <span className={css.paletteChip} style={{ backgroundColor: entry.hex }} aria-hidden="true" />
                    <span className={css.paletteCode}>{entry.code}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {changed > 0 && (
          <div className={css.recolorFooter}>
            <p className={css.note}>{t('recolor.pending', { count: formatNumber(changed) })}</p>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || submitting}
              onClick={() => {
                setSubmitting(true)
                void onRegenerate(codes).finally(() => { setSubmitting(false) })
              }}
            >
              {t('recolor.regenerate')}
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
