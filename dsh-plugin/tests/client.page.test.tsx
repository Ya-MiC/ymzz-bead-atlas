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
  pillow: { found: true, version: '13.0.0', required: '12.2.0' },
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
    getResultFile: vi.fn(async (payload: { name: string }) => ok({ name: payload.name, mediaType: 'image/png', bytes: 8, dataBase64: png })),
    deleteJob: vi.fn(async () => ok({ deleted: 'job-20261128-100000-0123abcd' })),
    updateConfig: vi.fn(async () => ok({ pythonPath: null, defaults: DEFAULT_SETTINGS })),
  }
  return { ...base, ...overrides } as unknown as BeadAtlasApi
}

beforeAll(() => {
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
    expect(screen.getByText(zh['action.cancel'])).toBeTruthy()
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
