/**
 * Client tests in jsdom with an in-memory API (no Host, no Python). They check
 * the UI flow and wording rules; the real end-to-end run is the DSH integration.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, RESULT_FILES, type EnvironmentStatus, type JobRecord, type RpcOutcome } from '../src/remote/types.ts'
import type { BeadAtlasApi } from '../src/client/api.ts'
import { createApi } from '../src/client/api.ts'
import { BeadAtlasPage } from '../src/client/BeadAtlasPage.tsx'
import { apply, inject } from '../src/client/index.ts'
import { createTranslator, en, zh } from '../src/client/locales.ts'

const t = createTranslator(zh)
const ok = <T,>(value: T): RpcOutcome<T> => ({ ok: true, value })

const READY: EnvironmentStatus = {
  ready: true,
  problems: [],
  python: { found: true, command: 'python3', version: '3.13.5', configured: false },
  pillow: { found: true, version: '13.0.0', required: '13.0.0', minimum: '12.1' },
  engine: { complete: true, missing: [] },
  checkedAt: '2026-11-28T01:00:00.000Z',
}

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'job-20261128-100000-0123abcd',
    createdAt: '2026-11-28T01:00:00.000Z',
    finishedAt: '2026-11-28T01:00:02.000Z',
    status: 'succeeded',
    sourceName: 'cat.png',
    sourceFormat: 'png',
    sourceWidth: 64,
    sourceHeight: 48,
    sourceBytes: 1234,
    settings: DEFAULT_SETTINGS,
    files: [...RESULT_FILES],
    summary: {
      brand: 'MARD', brandId: 'mard', gridWidth: 48, gridHeight: 36, placedBeads: 1728, blankCells: 0, usedColors: 2,
      estimatedWidthCm: 24, estimatedHeightCm: 18, estimatedBoards: 4, purchaseBeads: 1902, estimatedPacks: 2,
      meanDeltaE00: 3.21, maxDeltaE00: 9.87,
    },
    materials: [
      { code: 'A1', name: '白', referenceHex: '#FFFFFF', origin: 'builtin', beadCount: 1000, purchaseBeads: 1100, packsToBuy: 2 },
      { code: 'H7', name: '黑', referenceHex: '#000000', origin: 'builtin', beadCount: 728, purchaseBeads: 802, packsToBuy: 1 },
    ],
    failure: null,
    ...overrides,
  }
}

const PALETTE = {
  jobId: 'job-20261128-100000-0123abcd',
  brandId: 'mard',
  brand: 'MARD',
  entries: [
    { code: 'A1', name: '白', hex: '#FFFFFF', origin: 'official', sameAs: null },
    { code: 'H7', name: '黑', hex: '#000000', origin: 'official', sameAs: null },
    { code: 'B3', name: '天藍', hex: '#7FB8E6', origin: 'official', sameAs: null },
    { code: 'B9', name: '天藍二', hex: '#7FB8E6', origin: 'official', sameAs: 'B3' },
  ],
}

function utf8Base64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)))
}

/** coordinates.csv in convert.py's column order; '' marks an empty (transparent) cell. */
function coordinatesCsv(width: number, height: number, codeAt: (index: number) => string): string {
  const hex: Record<string, string> = { A1: '#FFFFFF', H7: '#000000', B3: '#7FB8E6' }
  const lines = ['row,column,source_hex,source_rgb,brand,code,reference_hex,delta_e00']
  for (let index = 0; index < width * height; index++) {
    const code = codeAt(index)
    const row = Math.floor(index / width) + 1
    const column = (index % width) + 1
    lines.push(code === '' ? `${column},${column},,,"MARD, 拼豆",,,` : `${row},${column},#FEFEFE,"254,254,254","MARD, 拼豆",${code},${hex[code] ?? '#123456'},1.5`)
  }
  return lines.join('\r\n') + '\r\n'
}

function fakeApi(overrides: Partial<Record<keyof BeadAtlasApi, unknown>> = {}): BeadAtlasApi {
  const png = 'iVBORw0KGgo='
  const base = {
    getEnvironmentStatus: vi.fn(async () => ok(READY)),
    listBrands: vi.fn(async () => ok({ brands: [{ id: 'mard', display: 'MARD', family: '中豆', colors: 291, beadMm: 5 }], presets: [{ name: '默认1', brand: 'mard' }] })),
    getConfig: vi.fn(async () => ok({ pythonPath: null, defaults: DEFAULT_SETTINGS })),
    listJobs: vi.fn(async () => ok([] as JobRecord[])),
    createJob: vi.fn(async () => ok(job({ status: 'running', files: [], summary: null, materials: [], finishedAt: null }))),
    getJob: vi.fn(async () => ok(job())),
    cancelJob: vi.fn(async () => ok(job({ status: 'cancelled' }))),
    getResultFile: vi.fn(async (payload: { name: string }) => (payload.name === 'coordinates.csv'
      ? ok({ name: payload.name, mediaType: 'text/csv', bytes: 0, dataBase64: utf8Base64(coordinatesCsv(48, 36, () => 'A1')) })
      : ok({ name: payload.name, mediaType: 'image/png', bytes: 8, dataBase64: png }))),
    getPalette: vi.fn(async () => ok(PALETTE)),
    createEditedJob: vi.fn(async () => ok(job({ id: 'job-20261128-100100-0123abce', status: 'running', files: [], summary: null, materials: [], finishedAt: null, editedFrom: 'job-20261128-100000-0123abcd' }))),
    deleteJob: vi.fn(async () => ok({ deleted: 'job-20261128-100000-0123abcd' })),
    updateConfig: vi.fn(async () => ok({ pythonPath: null, defaults: DEFAULT_SETTINGS })),
  }
  return { ...base, ...overrides } as unknown as BeadAtlasApi
}

beforeAll(() => {
  // jsdom has no canvas; the grid's drawing is checked in the real DSH run.
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']
  URL.createObjectURL = vi.fn(() => 'blob:test')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => { cleanup() })

describe('locales', () => {
  it('zh and en have the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
  it('contain no percentage or ETA wording', () => {
    for (const text of [...Object.values(zh), ...Object.values(en)]) {
      expect(text).not.toMatch(/\d+\s*%|剩餘時間|剩余时间|\bETA\b|time remaining/)
    }
  })
})

describe('BeadAtlasPage', () => {
  it('shows environment guidance and blocks generation when Python is missing', async () => {
    const api = fakeApi({
      getEnvironmentStatus: vi.fn(async () => ok({ ...READY, ready: false, problems: ['python-not-found'], python: { found: false, command: null, version: null, configured: false } })),
    })
    render(<BeadAtlasPage t={t} api={api} />)
    expect(await screen.findByText(zh['env.notReady'])).toBeTruthy()
    expect(screen.getByText(zh['env.download']).getAttribute('href')).toBe('https://www.python.org/downloads/')
    expect((screen.getByText(zh['action.generate']) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText(zh['env.recheck']))
    await waitFor(() => { expect(api.getEnvironmentStatus).toHaveBeenLastCalledWith({ refresh: true }, expect.anything()) })
  })

  it('shows the pillow install command only when Pillow is missing', async () => {
    const api = fakeApi({ getEnvironmentStatus: vi.fn(async () => ok({ ...READY, ready: false, problems: ['pillow-missing'] })) })
    render(<BeadAtlasPage t={t} api={api} />)
    expect(await screen.findByText('python3 -m pip install -r requirements.txt')).toBeTruthy()
  })

  it('shows the empty state and the ready line', async () => {
    render(<BeadAtlasPage t={t} api={fakeApi()} />)
    expect(await screen.findByText('Python 3.13.5 · Pillow 13.0.0')).toBeTruthy()
    expect(screen.getByText(zh['result.empty'])).toBeTruthy()
    expect(await screen.findByText(zh['history.empty'])).toBeTruthy()
  })

  it('rejects an unsupported file type before upload', async () => {
    const api = fakeApi()
    render(<BeadAtlasPage t={t} api={api} />)
    await screen.findByText('Python 3.13.5 · Pillow 13.0.0')
    const input = screen.getByLabelText(zh['upload.choose'], { selector: 'input' })
    fireEvent.change(input, { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } })
    expect(await screen.findByText(zh['upload.badType'])).toBeTruthy()
    expect(api.createJob).not.toHaveBeenCalled()
  })

  it('runs pick → generate → result → download with real states only', async () => {
    let release: (value: RpcOutcome<JobRecord>) => void = () => {}
    const api = fakeApi({ getJob: vi.fn(() => new Promise(resolve => { release = resolve })) })
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<BeadAtlasPage t={t} api={api} />)
    await screen.findByText('Python 3.13.5 · Pillow 13.0.0')
    const input = screen.getByLabelText(zh['upload.choose'], { selector: 'input' })
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([0x89, 0x50, 0x4E, 0x47])], 'cat.png', { type: 'image/png' })] } })
    await screen.findByText('cat.png')
    fireEvent.click(screen.getByText(zh['action.generate']))
    expect(await screen.findByText(zh['status.running'])).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/\d+\s*%/)
    expect(await screen.findByText(zh['action.cancel'])).toBeTruthy()
    const request = (api.createJob as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { fileName: string; dataBase64: string }
    expect(request.fileName).toBe('cat.png')
    expect(request.dataBase64).toBe('iVBORw==')
    await act(async () => { release(ok(job())) })
    expect(await screen.findByText(zh['materials.title'])).toBeTruthy()
    expect(within(screen.getByRole('table')).getByText('#FFFFFF')).toBeTruthy()
    expect(screen.getByText('1,728')).toBeTruthy()
    const downloads = screen.getByRole('region', { name: zh['downloads.title'] })
    expect(within(downloads).getAllByRole('button')).toHaveLength(7)
    fireEvent.click(within(downloads).getByLabelText(t('downloads.download', { name: zh['file.materials.csv'] })))
    await waitFor(() => { expect(anchorClick).toHaveBeenCalled() })
    expect(api.getResultFile).toHaveBeenCalledWith({ jobId: 'job-20261128-100000-0123abcd', name: 'materials.csv' })
    anchorClick.mockRestore()
  })

  it('cancels a running job', async () => {
    let release: (value: RpcOutcome<JobRecord>) => void = () => {}
    const api = fakeApi({
      getJob: vi.fn(() => new Promise(resolve => { release = resolve })),
      cancelJob: vi.fn(async () => { release(ok(job({ status: 'cancelled', files: [], summary: null, materials: [] }))); return ok(job({ status: 'cancelled' })) }),
    })
    render(<BeadAtlasPage t={t} api={api} />)
    await screen.findByText('Python 3.13.5 · Pillow 13.0.0')
    fireEvent.change(screen.getByLabelText(zh['upload.choose'], { selector: 'input' }), { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } })
    await screen.findByText('a.png')
    fireEvent.click(screen.getByText(zh['action.generate']))
    fireEvent.click(await screen.findByText(zh['action.cancel']))
    await waitFor(() => { expect(api.cancelJob).toHaveBeenCalled() })
    expect((await screen.findAllByText(zh['status.cancelled'])).length).toBeGreaterThan(0)
  })

  it('[review 1] keeps Generate disabled while a job is running and explains why', async () => {
    const running = job({ status: 'running', files: [], summary: null, materials: [], finishedAt: null })
    const api = fakeApi({ listJobs: vi.fn(async () => ok([running])), getJob: vi.fn(() => new Promise(() => {})) })
    render(<BeadAtlasPage t={t} api={api} />)
    await screen.findByText('Python 3.13.5 · Pillow 13.0.0')
    fireEvent.change(screen.getByLabelText(zh['upload.choose'], { selector: 'input' }), { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } })
    await screen.findByText('a.png')
    await waitFor(() => { expect((screen.getByText(zh['action.generate']) as HTMLButtonElement).disabled).toBe(true) })
    fireEvent.click(screen.getByText(zh['action.generate']))
    expect(api.createJob).not.toHaveBeenCalled()
  })

  it('[review 2] shows the Pillow upgrade guidance and blocks generation when Pillow is below 12.1', async () => {
    const api = fakeApi({ getEnvironmentStatus: vi.fn(async () => ok({ ...READY, ready: false, problems: ['pillow-too-old'], pillow: { found: true, version: '11.3.0', required: '13.0.0', minimum: '12.1' } })) })
    render(<BeadAtlasPage t={t} api={api} />)
    expect(await screen.findByText('python3 -m pip install --upgrade -r requirements.txt')).toBeTruthy()
    expect(screen.getByText(zh['env.recheck'])).toBeTruthy()
    expect((screen.getByText(zh['action.generate']) as HTMLButtonElement).disabled).toBe(true)
  })

  it('[review 3] resets the submitting state and explains when reading the image fails', async () => {
    const api = fakeApi()
    const read = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      setTimeout(() => { this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>) }, 0)
    })
    render(<BeadAtlasPage t={t} api={api} />)
    await screen.findByText('Python 3.13.5 · Pillow 13.0.0')
    fireEvent.change(screen.getByLabelText(zh['upload.choose'], { selector: 'input' }), { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } })
    await screen.findByText('a.png')
    fireEvent.click(screen.getByText(zh['action.generate']))
    expect(await screen.findByText(zh['upload.readFailed'])).toBeTruthy()
    expect(api.createJob).not.toHaveBeenCalled()
    await waitFor(() => { expect((screen.getByText(zh['action.generate']) as HTMLButtonElement).disabled).toBe(false) })
    expect(screen.queryByText(zh['status.running'])).toBeNull()
    read.mockRestore()
  })

  it('[review 4] gives the cancel button back when the cancel request fails', async () => {
    const api = fakeApi({
      getJob: vi.fn(() => new Promise(() => {})),
      cancelJob: vi.fn(async () => ({ ok: false, error: { code: 'gateway/disconnected', message: 'offline', details: {} } })),
    })
    render(<BeadAtlasPage t={t} api={api} />)
    await screen.findByText('Python 3.13.5 · Pillow 13.0.0')
    fireEvent.change(screen.getByLabelText(zh['upload.choose'], { selector: 'input' }), { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } })
    await screen.findByText('a.png')
    fireEvent.click(screen.getByText(zh['action.generate']))
    fireEvent.click(await screen.findByText(zh['action.cancel']))
    await waitFor(() => { expect(api.cancelJob).toHaveBeenCalledTimes(1) })
    expect(await screen.findByRole('alert')).toBeTruthy()
    const button = screen.getByText(zh['action.cancel']) as HTMLButtonElement
    await waitFor(() => { expect(button.disabled).toBe(false) })
    expect(screen.getAllByText(zh['status.running']).length).toBeGreaterThan(0)
    fireEvent.click(button)
    await waitFor(() => { expect(api.cancelJob).toHaveBeenCalledTimes(2) })
  })

  it('[review 5] keeps tracking (and the cancel button) through a transient status failure', async () => {
    let calls = 0
    let release: (value: RpcOutcome<JobRecord>) => void = () => {}
    const api = fakeApi({
      getJob: vi.fn(() => {
        calls++
        if (calls === 1) return Promise.resolve({ ok: false, error: { code: 'gateway/disconnected', message: 'blip', details: {} } })
        return new Promise(resolve => { release = resolve })
      }),
    })
    render(<BeadAtlasPage t={t} api={api} pollRetryDelaysMs={[10, 10]} />)
    await screen.findByText('Python 3.13.5 · Pillow 13.0.0')
    fireEvent.change(screen.getByLabelText(zh['upload.choose'], { selector: 'input' }), { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } })
    await screen.findByText('a.png')
    fireEvent.click(screen.getByText(zh['action.generate']))
    expect(await screen.findByText(t('status.retrying', { attempt: 1, max: 2 }))).toBeTruthy()
    expect(screen.getByText(zh['action.cancel'])).toBeTruthy()
    expect(screen.getAllByText(zh['status.running']).length).toBeGreaterThan(0)
    await waitFor(() => { expect(api.getJob).toHaveBeenCalledTimes(2) })
    expect(screen.getByText(zh['action.cancel'])).toBeTruthy()
    await act(async () => { release(ok(job())) })
    expect(await screen.findByText(zh['materials.title'])).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('[review 5] stops after the retry limit and offers to resume tracking', async () => {
    const running = job({ status: 'running', files: [], summary: null, materials: [], finishedAt: null })
    const api = fakeApi({
      createJob: vi.fn(async () => ok(running)),
      getJob: vi.fn(async () => ({ ok: false, error: { code: 'gateway/disconnected', message: 'down', details: {} } })),
    })
    render(<BeadAtlasPage t={t} api={api} pollRetryDelaysMs={[5, 5]} />)
    await screen.findByText('Python 3.13.5 · Pillow 13.0.0')
    fireEvent.change(screen.getByLabelText(zh['upload.choose'], { selector: 'input' }), { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } })
    await screen.findByText('a.png')
    fireEvent.click(screen.getByText(zh['action.generate']))
    expect(await screen.findByText(zh['action.resume'])).toBeTruthy()
    expect(api.getJob).toHaveBeenCalledTimes(3)
    expect(screen.getByText(zh['action.cancel'])).toBeTruthy()
  })

  it('[review 7] marks a new pick as decoding and never submits the previous image', async () => {
    const pending: ((value: { width: number; height: number; close: () => void }) => void)[] = []
    const original = (globalThis as { createImageBitmap?: unknown }).createImageBitmap
    ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(() => new Promise(resolve => { pending.push(resolve) }))
    try {
      const api = fakeApi({ getJob: vi.fn(() => new Promise(() => {})) })
      render(<BeadAtlasPage t={t} api={api} />)
      await screen.findByText('Python 3.13.5 · Pillow 13.0.0')
      const input = screen.getByLabelText(zh['upload.choose'], { selector: 'input' })
      fireEvent.change(input, { target: { files: [new File(['old'], 'old.png', { type: 'image/png' })] } })
      await waitFor(() => { expect(pending).toHaveLength(1) })
      await act(async () => { pending[0]?.({ width: 10, height: 10, close: () => {} }) })
      await waitFor(() => { expect((screen.getByText(zh['action.generate']) as HTMLButtonElement).disabled).toBe(false) })
      fireEvent.change(screen.getByLabelText(zh['upload.choose'], { selector: 'input' }), { target: { files: [new File(['new'], 'new.png', { type: 'image/png' })] } })
      expect(await screen.findByText(zh['upload.decoding'])).toBeTruthy()
      expect(screen.getByText('new.png')).toBeTruthy()
      expect((screen.getByText(zh['action.generate']) as HTMLButtonElement).disabled).toBe(true)
      fireEvent.click(screen.getByText(zh['action.generate']))
      expect(api.createJob).not.toHaveBeenCalled()
      await act(async () => { pending[1]?.({ width: 20, height: 20, close: () => {} }) })
      await waitFor(() => { expect((screen.getByText(zh['action.generate']) as HTMLButtonElement).disabled).toBe(false) })
      fireEvent.click(screen.getByText(zh['action.generate']))
      await waitFor(() => { expect(api.createJob).toHaveBeenCalledTimes(1) })
      const request = (api.createJob as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { fileName: string; dataBase64: string }
      expect(request.fileName).toBe('new.png')
      expect(atob(request.dataBase64)).toBe('new')
    } finally {
      ;(globalThis as { createImageBitmap?: unknown }).createImageBitmap = original
    }
  })

  it('shows a Host error code as a sentence', async () => {
    const api = fakeApi({ createJob: vi.fn(async () => ({ ok: false, error: { code: 'bead-atlas/image-too-large', message: '', details: { maxEdgePx: 12000, maxPixels: 40000000 } } })) })
    render(<BeadAtlasPage t={t} api={api} />)
    await screen.findByText('Python 3.13.5 · Pillow 13.0.0')
    fireEvent.change(screen.getByLabelText(zh['upload.choose'], { selector: 'input' }), { target: { files: [new File(['x'], 'big.png', { type: 'image/png' })] } })
    await screen.findByText('big.png')
    fireEvent.click(screen.getByText(zh['action.generate']))
    expect(await screen.findByText(t('error.bead-atlas/image-too-large', { maxEdgePx: 12000, maxPixels: 40000000 }))).toBeTruthy()
  })

  it('lists history and deletes only after confirmation', async () => {
    const api = fakeApi({ listJobs: vi.fn(async () => ok([job()])) })
    render(<BeadAtlasPage t={t} api={api} />)
    const remove = await screen.findByLabelText(`${zh['history.delete']} job-20261128-100000-0123abcd`)
    fireEvent.click(remove)
    const dialog = await screen.findByRole('dialog', { name: zh['delete.title'] })
    expect(api.deleteJob).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByText(zh['delete.confirm']))
    await waitFor(() => { expect(api.deleteJob).toHaveBeenCalledWith({ jobId: 'job-20261128-100000-0123abcd', confirmed: true }) })
  })

  it('shows a failed job with its reason', async () => {
    const failed = job({ status: 'failed', files: [], summary: null, materials: [], failure: { code: 'bead-atlas/timeout', detail: 'stopped after 120 s' } })
    render(<BeadAtlasPage t={t} api={fakeApi({ listJobs: vi.fn(async () => ok([failed])) })} />)
    expect(await screen.findByText(t('failure.bead-atlas/timeout', { detail: 'stopped after 120 s' }))).toBeTruthy()
  })
})

describe('interactive grid', () => {
  // 4 × 3 grid: two empty cells, A1 ×6, H7 ×4.
  const codes = ['', 'A1', 'A1', 'H7', 'A1', 'A1', 'H7', 'H7', 'A1', 'A1', 'H7', '']
  const small = job({
    summary: { ...job().summary!, gridWidth: 4, gridHeight: 3, placedBeads: 10, blankCells: 2, usedColors: 2 },
    settings: { ...DEFAULT_SETTINGS, sparePercent: 10, packSize: 1000 },
    materials: [
      { code: 'A1', name: '白', referenceHex: '#FFFFFF', origin: 'official', beadCount: 6, purchaseBeads: 7, packsToBuy: 1 },
      { code: 'H7', name: '黑', referenceHex: '#000000', origin: 'official', beadCount: 4, purchaseBeads: 5, packsToBuy: 1 },
    ],
  })
  const gridApi = (extra: Partial<Record<keyof BeadAtlasApi, unknown>> = {}) => fakeApi({
    listJobs: vi.fn(async () => ok([small])),
    getResultFile: vi.fn(async (payload: { name: string }) => ok({ name: payload.name, mediaType: 'text/csv', bytes: 0, dataBase64: utf8Base64(coordinatesCsv(4, 3, index => codes[index] ?? '')) })),
    ...extra,
  })

  it('shows code, colour and same-code count on hover, and marks empty cells as no bead', async () => {
    const api = gridApi()
    render(<BeadAtlasPage t={t} api={api} />)
    const grid = await screen.findByTestId('bead-grid')
    expect(screen.getByText(t('grid.blankLegend', { count: '2' }))).toBeTruthy()
    expect(api.getPalette).toHaveBeenCalledWith({ jobId: small.id }, expect.anything())
    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    expect(await screen.findByText(t('grid.info', { row: 1, column: 2, code: 'A1', name: '白', hex: '#FFFFFF', count: '6' }))).toBeTruthy()
    fireEvent.keyDown(grid, { key: 'ArrowLeft' })
    expect(await screen.findByText(t('grid.infoBlank', { row: 1, column: 1, count: '2' }))).toBeTruthy()
    // The empty background is not a material.
    expect(within(screen.getByRole('table')).queryByText('#FAFAFA')).toBeNull()
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('recolors one cell or every cell of a code from the engine palette and updates materials at once', async () => {
    const api = gridApi()
    render(<BeadAtlasPage t={t} api={api} />)
    const grid = await screen.findByTestId('bead-grid')
    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    fireEvent.keyDown(grid, { key: 'Enter' })
    expect(await screen.findByText(t('recolor.selected', { code: 'A1', name: '白', count: '6' }))).toBeTruthy()
    // A code whose colour equals an earlier code cannot be chosen (the engine would map it to the earlier one).
    expect((screen.getByLabelText(t('recolor.choose', { code: 'B9', name: '天藍二', hex: '#7FB8E6' })) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText(zh['recolor.scopeCell']))
    fireEvent.click(screen.getByLabelText(t('recolor.choose', { code: 'B3', name: '天藍', hex: '#7FB8E6' })))
    const table = screen.getByRole('table')
    await waitFor(() => { expect(within(table).getByText('B3')).toBeTruthy() })
    expect(within(table).getByText(zh['materials.edited'], { exact: false })).toBeTruthy()
    /** [count, purchase, packs] cells of one material row. */
    const numbers = (code: string) => [...(within(table).getByText(code).closest('tr') as HTMLElement).querySelectorAll('td')].slice(3).map(cell => cell.textContent)
    expect(numbers('A1')).toEqual(['5', '6', '1'])
    expect(numbers('B3')).toEqual(['1', '2', '1'])
    // Now replace every remaining A1 (5) with H7.
    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    fireEvent.keyDown(grid, { key: 'Enter' })
    fireEvent.click(await screen.findByLabelText(t('recolor.scopeCode', { code: 'A1', count: '5' })))
    fireEvent.click(screen.getByLabelText(t('recolor.choose', { code: 'H7', name: '黑', hex: '#000000' })))
    await waitFor(() => { expect(within(table).queryByText('A1')).toBeNull() })
    expect(numbers('H7')).toEqual(['9', '10', '1']) // 9 + ceil(0.9) spare
    fireEvent.click(screen.getByText(zh['recolor.undo']))
    await waitFor(() => { expect(within(table).getByText('A1')).toBeTruthy() })
    fireEvent.click(screen.getByText(zh['recolor.regenerate']))
    await waitFor(() => { expect(api.createEditedJob).toHaveBeenCalledTimes(1) })
    const request = (api.createEditedJob as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { jobId: string; width: number; height: number; cells: string[] }
    expect(request).toMatchObject({ jobId: small.id, width: 4, height: 3 })
    expect(request.cells).toEqual(['', 'B3', 'A1', 'H7', 'A1', 'A1', 'H7', 'H7', 'A1', 'A1', 'H7', ''])
  })

  it('does not offer recoloring for an empty cell', async () => {
    render(<BeadAtlasPage t={t} api={gridApi()} />)
    const grid = await screen.findByTestId('bead-grid')
    fireEvent.keyDown(grid, { key: 'Enter' })
    expect(await screen.findByText(zh['recolor.blank'])).toBeTruthy()
  })
})

describe('bead grid helpers', () => {
  it('match convert.py arithmetic and never count empty cells', async () => {
    const { liveMaterials, recolor, cellAt } = await import('../src/client/bead-grid.ts')
    const lookup = new Map([['A1', { name: '白', hex: '#FFFFFF', origin: 'official' }], ['H7', { name: '黑', hex: '#000000', origin: 'official' }]])
    const grid = ['', 'A1', 'H7', 'H7', 'A1', 'H7']
    const { materials, totals } = liveMaterials(grid, lookup, { sparePercent: 15, packSize: 2 })
    expect(materials.map(row => [row.code, row.beadCount, row.purchaseBeads, row.packsToBuy])).toEqual([['H7', 3, 4, 2], ['A1', 2, 3, 2]])
    expect(totals).toEqual({ placedBeads: 5, blankCells: 1, usedColors: 2, purchaseBeads: 7, estimatedPacks: 4 })
    expect(recolor(grid, 1, 'H7', 'cell')).toEqual({ codes: ['', 'H7', 'H7', 'H7', 'A1', 'H7'], changed: 1 })
    expect(recolor(grid, 1, 'B3', 'code').changed).toBe(2)
    expect(recolor(grid, 0, 'B3', 'code').changed).toBe(0)
    expect(cellAt(25, 13, 12, 3, 2)).toBe(5)
    expect(cellAt(37, 0, 12, 3, 2)).toBeNull()
  })
})

describe('client entry', () => {
  it('registers the sidebar entry and main panel under the same id', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
    const registered: Record<string, unknown>[] = []
    apply({
      effect: (factory) => { factory() },
      get: () => ({ rpc: { call: async () => ({ ok: true, value: null }) } }),
      locale: { register: () => () => {}, bind: () => (key: string) => key },
      slots: {
        inject: (_slot, factory) => { factory() },
        register: (options) => { registered.push(options); return () => {} },
      },
    })
    const main = registered.find(item => item.name === 'main')
    const sidebar = registered.find(item => item.name === 'sidebar.panellist')
    expect(main?.key).toBe('bead-atlas')
    expect(sidebar?.id).toBe('bead-atlas')
    expect((sidebar?.label as () => string)()).toBe('panel')
  })

  it('calls the /bead-atlas channel and folds transport errors', async () => {
    const call = vi.fn(async () => ({ ok: false, error: { code: 'gateway/disconnected', message: 'offline' } }))
    const api = createApi({ rpc: { call } })
    const result = await api.listJobs({})
    expect(call).toHaveBeenCalledWith('/bead-atlas', 'listJobs', {}, undefined)
    expect(!result.ok && result.error.code).toBe('gateway/disconnected')
  })
})
