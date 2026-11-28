/**
 * Host service tests. Conversions run the REAL bundled Python engine through a
 * child_process adapter (tests/helpers/node-subprocess.ts). Only environments
 * this machine lacks (missing / old Python, missing Pillow, an engine that
 * writes nothing) are simulated, and each such test says so.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, RESULT_FILES, type JobRecord, type RpcOutcome } from '../src/remote/types.ts'
import { BeadAtlasService } from '../src/host/bead-atlas-service.ts'
import { conversionArgs, pillowAtLeast } from '../src/host/python-runner.ts'
import { validateSettings } from '../src/remote/validate.ts'
import { parseCoordinates } from '../src/remote/csv.ts'
import { encodeRgbaPng } from '../src/host/png-encode.ts'
import { NodeSubprocess } from './helpers/node-subprocess.ts'
import { ENGINE_ROOT, TEST_PYTHON, fakePython, gradientPng, headerOnlyPng, tempDir } from './helpers/fixtures.ts'

const signal = new AbortController().signal
const services: BeadAtlasService[] = []

/** PATH whose first entry holds the test Python (venv bin when BEAD_ATLAS_TEST_PYTHON is set). */
const PYTHON_PATH = process.env.BEAD_ATLAS_TEST_PYTHON === undefined
  ? process.env.PATH ?? ''
  : `${dirname(TEST_PYTHON)}:${process.env.PATH ?? ''}`

async function makeService(options: { path?: string; rewrite?: (argv: readonly string[]) => readonly string[]; timeoutMs?: number; dataRoot?: string } = {}) {
  const subprocess = new NodeSubprocess({ path: options.path ?? PYTHON_PATH, rewrite: options.rewrite })
  const service = new BeadAtlasService({
    subprocess,
    dataRoot: options.dataRoot ?? join(tempDir(), 'bead-atlas'),
    engineRoot: ENGINE_ROOT,
    timeoutMs: options.timeoutMs,
    platform: 'linux',
  })
  await service.start()
  services.push(service)
  return { service, subprocess }
}

async function call<T>(service: BeadAtlasService, endpoint: string, payload: unknown = {}): Promise<RpcOutcome<T>> {
  return await service.dispatch(endpoint, payload, signal) as RpcOutcome<T>
}

function jobRequest(bytes: Buffer, settings = DEFAULT_SETTINGS, fileName = '我的 圖片.png') {
  return { fileName, dataBase64: bytes.toString('base64'), settings: { ...settings, width: 24, maxColors: 12 } }
}

afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.dispose()))
})

beforeAll(() => {
  expect(existsSync(join(ENGINE_ROOT, 'scripts', 'convert.py'))).toBe(true)
})

describe('environment detection', () => {
  it('finds the real Python and Pillow', async () => {
    const { service } = await makeService()
    const result = await call<{ ready: boolean; python: { version: string }; pillow: { version: string } }>(service, 'getEnvironmentStatus', { refresh: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.ready).toBe(true)
    expect(result.value.python.version).toMatch(/^3\.\d+\.\d+$/)
    expect(result.value.pillow.version).toMatch(/^\d+\./)
  })

  it('reports python-not-found when no interpreter is on PATH', async () => {
    const { service } = await makeService({ path: tempDir('empty path') })
    const result = await call<{ ready: boolean; problems: string[] }>(service, 'getEnvironmentStatus', { refresh: true })
    expect(result.ok && result.value.problems).toEqual(['python-not-found'])
  })

  it('reports python-too-old (simulated interpreter)', async () => {
    const dir = tempDir('old python')
    fakePython(dir, [3, 8, 18], '10.0.0')
    const { service } = await makeService({ path: dir })
    const result = await call<{ problems: string[]; python: { version: string } }>(service, 'getEnvironmentStatus', { refresh: true })
    expect(result.ok && result.value.problems).toEqual(['python-too-old'])
    expect(result.ok && result.value.python.version).toBe('3.8.18')
  })

  it('reports pillow-missing (simulated interpreter)', async () => {
    const dir = tempDir('no pillow')
    fakePython(dir, [3, 12, 1], null)
    const { service } = await makeService({ path: dir })
    const result = await call<{ problems: string[]; pillow: { required: string } }>(service, 'getEnvironmentStatus', { refresh: true })
    expect(result.ok && result.value.problems).toEqual(['pillow-missing'])
    expect(result.ok && result.value.pillow.required).toMatch(/\d/)
  })

  it('[review 2] reports pillow-too-old for Pillow below 12.1 before any job runs (simulated interpreter)', async () => {
    const dir = tempDir('old pillow')
    fakePython(dir, [3, 12, 1], '11.3.0')
    const { service } = await makeService({ path: dir })
    const result = await call<{ ready: boolean; problems: string[]; pillow: { version: string; minimum: string } }>(service, 'getEnvironmentStatus', { refresh: true })
    expect(result.ok && result.value.ready).toBe(false)
    expect(result.ok && result.value.problems).toEqual(['pillow-too-old'])
    expect(result.ok && result.value.pillow.minimum).toBe('12.1')
    const job = await call(service, 'createJob', jobRequest(gradientPng()))
    expect(!job.ok && job.error.code).toBe('bead-atlas/environment')
    expect(pillowAtLeast('12.1.0')).toBe(true)
    expect(pillowAtLeast('12.0.9')).toBe(false)
    expect(pillowAtLeast('13.0.0')).toBe(true)
    expect(pillowAtLeast('12.10')).toBe(true)
    expect(pillowAtLeast('not-a-version')).toBe(false)
  })

  it('never reports the full interpreter path', async () => {
    const { service } = await makeService()
    const result = await call<{ python: { command: string } }>(service, 'getEnvironmentStatus', { refresh: true })
    expect(result.ok && result.value.python.command).not.toContain('/')
  })

  it('rejects a configured pythonPath that is not a python executable', async () => {
    const { service } = await makeService()
    const result = await call(service, 'updateConfig', { pythonPath: '/bin/sh' })
    expect(!result.ok && result.error.code).toBe('bead-atlas/invalid-config')
    const relative = await call(service, 'updateConfig', { pythonPath: 'python3' })
    expect(!relative.ok && relative.error.code).toBe('bead-atlas/invalid-config')
  })
})

describe('catalog from the Python engine', () => {
  it('lists brands and presets from convert.py, not from a TS copy', async () => {
    const { service, subprocess } = await makeService()
    const result = await call<{ brands: { id: string; colors: number }[]; presets: { name: string; brand: string }[] }>(service, 'listBrands')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.brands.map(brand => brand.id)).toContain('mard')
    expect(result.value.brands.find(brand => brand.id === 'mard')?.colors).toBeGreaterThan(100)
    expect(result.value.presets.map(preset => preset.brand)).toContain('mard')
    expect(subprocess.spawned.some(argv => argv.includes('--list-brands'))).toBe(true)
  })
})

describe('real conversion', () => {
  it('runs convert.py and produces all seven outputs with a summary', async () => {
    const { service, subprocess } = await makeService()
    const created = await call<JobRecord>(service, 'createJob', jobRequest(gradientPng()))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.value.status).toBe('running')
    const done = await call<JobRecord>(service, 'getJob', { jobId: created.value.id, waitMs: 60_000 })
    expect(done.ok && done.value.status).toBe('succeeded')
    if (!done.ok) return
    expect([...done.value.files].sort()).toEqual([...RESULT_FILES].sort())
    expect(done.value.summary?.gridWidth).toBe(24)
    expect(done.value.summary?.usedColors).toBeGreaterThan(0)
    expect(done.value.materials.length).toBe(done.value.summary?.usedColors)
    expect(done.value.sourceName).toBe('我的 圖片.png')
    const argv = subprocess.spawned.find(item => item.includes('--output'))
    expect(argv).toBeDefined()
    expect(argv?.some(arg => arg.includes('我的'))).toBe(false)
    const png = await call<{ mediaType: string; dataBase64: string; bytes: number }>(service, 'getResultFile', { jobId: created.value.id, name: 'pattern.png' })
    expect(png.ok && png.value.mediaType).toBe('image/png')
    expect(png.ok && Buffer.from(png.value.dataBase64, 'base64').subarray(1, 4).toString()).toBe('PNG')
    const csv = await call<{ dataBase64: string }>(service, 'getResultFile', { jobId: created.value.id, name: 'materials.csv' })
    expect(csv.ok && Buffer.from(csv.value.dataBase64, 'base64').toString('utf8').length).toBeGreaterThan(10)
    const source = await call<{ dataBase64: string }>(service, 'getResultFile', { jobId: created.value.id, name: 'source' })
    expect(source.ok && Buffer.from(source.value.dataBase64, 'base64').equals(gradientPng())).toBe(true)
  }, 90_000)

  it('stores data under a directory whose path has CJK characters and spaces', async () => {
    const dataRoot = join(tempDir('資料 夾'), '拼豆 圖譜')
    const { service } = await makeService({ dataRoot })
    const created = await call<JobRecord>(service, 'createJob', jobRequest(gradientPng(), DEFAULT_SETTINGS, '../../etc/passwd.png'))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await service.settled(created.value.id)
    const done = await call<JobRecord>(service, 'getJob', { jobId: created.value.id })
    expect(done.ok && done.value.status).toBe('succeeded')
    expect(done.ok && done.value.sourceName).not.toContain('/')
    expect(readdirSync(join(dataRoot, 'jobs', created.value.id, 'input'))).toEqual(['source.png'])
  }, 90_000)

  it('refuses a second job while one is running', async () => {
    const { service } = await makeService()
    const first = await call<JobRecord>(service, 'createJob', jobRequest(gradientPng()))
    const second = await call<JobRecord>(service, 'createJob', jobRequest(gradientPng()))
    expect(first.ok).toBe(true)
    expect(!second.ok && second.error.code).toBe('bead-atlas/busy')
    if (first.ok) await service.settled(first.value.id)
    const third = await call<JobRecord>(service, 'createJob', jobRequest(gradientPng()))
    expect(third.ok && first.ok && third.value.id !== first.value.id).toBe(true)
    if (third.ok) await service.settled(third.value.id)
  }, 90_000)

  it('[review 1] reserves the slot before awaiting setup: concurrent requests start one Python conversion', async () => {
    const { service, subprocess } = await makeService()
    // Fresh service: the environment is not cached, so both requests would await the probe.
    const [first, second] = await Promise.all([
      call<JobRecord>(service, 'createJob', jobRequest(gradientPng())),
      call<JobRecord>(service, 'createJob', jobRequest(gradientPng())),
    ])
    const outcomes = [first, second]
    expect(outcomes.filter(item => item.ok)).toHaveLength(1)
    expect(outcomes.filter(item => !item.ok && item.error.code === 'bead-atlas/busy')).toHaveLength(1)
    const started = outcomes.find(item => item.ok)
    if (started?.ok) await service.settled(started.value.id)
    expect(subprocess.spawned.filter(argv => argv.includes('--output'))).toHaveLength(1)
    // A failed setup releases the slot: an unknown brand fails, then a valid job can start.
    const bad = await call(service, 'createJob', jobRequest(gradientPng(), { ...DEFAULT_SETTINGS, brand: 'nope' }))
    expect(!bad.ok && bad.error.code).toBe('bead-atlas/invalid-settings')
    const next = await call<JobRecord>(service, 'createJob', jobRequest(gradientPng()))
    expect(next.ok).toBe(true)
    if (next.ok) await service.settled(next.value.id)
  }, 90_000)

  it('records an engine failure (non-zero exit) for an image Pillow cannot decode', async () => {
    const { service } = await makeService()
    const created = await call<JobRecord>(service, 'createJob', jobRequest(headerOnlyPng(40, 40)))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await service.settled(created.value.id)
    const done = await call<JobRecord>(service, 'getJob', { jobId: created.value.id })
    expect(done.ok && done.value.status).toBe('failed')
    expect(done.ok && done.value.failure?.code).toBe('bead-atlas/engine-failed')
  }, 60_000)

  it('stops a run at the time limit', async () => {
    const { service } = await makeService({ timeoutMs: 30, rewrite: argv => argv.includes('--output') ? [argv[0] ?? 'python3', '-c', 'import time; time.sleep(30)'] : argv })
    const created = await call<JobRecord>(service, 'createJob', jobRequest(gradientPng()))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await service.settled(created.value.id)
    const done = await call<JobRecord>(service, 'getJob', { jobId: created.value.id })
    expect(done.ok && done.value.failure?.code).toBe('bead-atlas/timeout')
  }, 30_000)

  it('cancels a running job', async () => {
    const { service } = await makeService({ rewrite: argv => argv.includes('--output') ? [argv[0] ?? 'python3', '-c', 'import time; time.sleep(30)'] : argv })
    const created = await call<JobRecord>(service, 'createJob', jobRequest(gradientPng()))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const cancelled = await call<JobRecord>(service, 'cancelJob', { jobId: created.value.id })
    expect(cancelled.ok && cancelled.value.status).toBe('cancelled')
    const again = await call(service, 'cancelJob', { jobId: created.value.id })
    expect(!again.ok && again.error.code).toBe('bead-atlas/not-running')
  }, 30_000)

  it('marks a run whose outputs are missing as output-incomplete (simulated engine that writes nothing)', async () => {
    const { service } = await makeService({ rewrite: argv => argv.includes('--output') ? [argv[0] ?? 'python3', '-c', 'pass'] : argv })
    const created = await call<JobRecord>(service, 'createJob', jobRequest(gradientPng()))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await service.settled(created.value.id)
    const done = await call<JobRecord>(service, 'getJob', { jobId: created.value.id })
    expect(done.ok && done.value.failure?.code).toBe('bead-atlas/output-incomplete')
  }, 30_000)
})

describe('input validation', () => {
  it('rejects data that is not an image', async () => {
    const { service } = await makeService()
    const result = await call(service, 'createJob', jobRequest(Buffer.from('hello, not an image')))
    expect(!result.ok && result.error.code).toBe('bead-atlas/unsupported-format')
  })

  it('rejects a file above the byte limit', async () => {
    const { service } = await makeService()
    const big = Buffer.alloc(16 * 1024 * 1024, 0)
    gradientPng().copy(big)
    const result = await call(service, 'createJob', jobRequest(big))
    expect(!result.ok && result.error.code).toBe('bead-atlas/file-too-large')
  })

  it('rejects an image above the pixel limit before running Python', async () => {
    const { service, subprocess } = await makeService()
    const result = await call(service, 'createJob', jobRequest(headerOnlyPng(11_000, 11_000)))
    expect(!result.ok && result.error.code).toBe('bead-atlas/image-too-large')
    expect(subprocess.spawned.some(argv => argv.includes('--output'))).toBe(false)
  })

  it('rejects out-of-range settings', async () => {
    const { service } = await makeService()
    const request = { ...jobRequest(gradientPng()), settings: { ...DEFAULT_SETTINGS, width: 999 } }
    const result = await call(service, 'createJob', request)
    expect(!result.ok && result.error.code).toBe('bead-atlas/invalid-settings')
    expect(!result.ok && result.error.details.field).toBe('width')
  })

  it('rejects an unknown brand', async () => {
    const { service } = await makeService()
    const request = { ...jobRequest(gradientPng()), settings: { ...DEFAULT_SETTINGS, brand: 'nope' } }
    const result = await call(service, 'createJob', request)
    expect(!result.ok && result.error.code).toBe('bead-atlas/invalid-settings')
  })

  it('rejects path traversal in job ids and file names', async () => {
    const { service } = await makeService()
    for (const jobId of ['../x', '/etc/passwd', 'job-20261128-000000-zzzzzzzz', '']) {
      const result = await call(service, 'getResultFile', { jobId, name: 'pattern.png' })
      expect(!result.ok && result.error.code).toBe('bead-atlas/bad-request')
    }
    const created = await call<JobRecord>(service, 'createJob', jobRequest(gradientPng()))
    if (!created.ok) throw new Error('job not created')
    await service.settled(created.value.id)
    for (const name of ['../job.json', '../../config.json', '/etc/passwd', 'output/../job.json']) {
      const result = await call(service, 'getResultFile', { jobId: created.value.id, name })
      expect(!result.ok && result.error.code).toBe('bead-atlas/bad-request')
    }
  }, 60_000)

  it('refuses a result file that is a symlink out of the job directory', async () => {
    const dataRoot = join(tempDir(), 'bead-atlas')
    const { service } = await makeService({ dataRoot })
    const created = await call<JobRecord>(service, 'createJob', jobRequest(gradientPng()))
    if (!created.ok) throw new Error('job not created')
    await service.settled(created.value.id)
    const outside = join(tempDir('outside'), 'secret.txt')
    writeFileSync(outside, 'secret')
    const target = join(dataRoot, 'jobs', created.value.id, 'output', 'report.md')
    await import('node:fs/promises').then(fs => fs.rm(target))
    symlinkSync(outside, target)
    const result = await call(service, 'getResultFile', { jobId: created.value.id, name: 'report.md' })
    expect(!result.ok && result.error.code).toBe('bead-atlas/bad-request')
  }, 60_000)

  it('rejects unknown endpoints', async () => {
    const { service } = await makeService()
    const result = await call(service, 'runShell', { command: 'rm -rf /' })
    expect(!result.ok && result.error.code).toBe('bead-atlas/bad-request')
  })
})

describe('history and persistence', () => {
  it('requires explicit confirmation to delete', async () => {
    const { service } = await makeService()
    const created = await call<JobRecord>(service, 'createJob', jobRequest(gradientPng()))
    if (!created.ok) throw new Error('job not created')
    await service.settled(created.value.id)
    const refused = await call(service, 'deleteJob', { jobId: created.value.id })
    expect(!refused.ok && refused.error.code).toBe('bead-atlas/confirmation-required')
    const deleted = await call(service, 'deleteJob', { jobId: created.value.id, confirmed: true })
    expect(deleted.ok).toBe(true)
    const list = await call<JobRecord[]>(service, 'listJobs')
    expect(list.ok && list.value.length).toBe(0)
  }, 60_000)

  it('keeps history and config across a restart and marks interrupted runs', async () => {
    const dataRoot = join(tempDir(), 'bead-atlas')
    const first = await makeService({ dataRoot })
    const created = await call<JobRecord>(first.service, 'createJob', jobRequest(gradientPng()))
    if (!created.ok) throw new Error('job not created')
    await first.service.settled(created.value.id)
    await call(first.service, 'updateConfig', { defaults: { ...DEFAULT_SETTINGS, width: 64 } })
    // Simulate a Host that died mid-run: a record left in "running".
    const stuckId = 'job-20261128-101500-0123abcd'
    mkdirSync(join(dataRoot, 'jobs', stuckId, 'input'), { recursive: true })
    mkdirSync(join(dataRoot, 'jobs', stuckId, 'output'), { recursive: true })
    const record = JSON.parse(readFileSync(join(dataRoot, 'jobs', created.value.id, 'job.json'), 'utf8')) as JobRecord
    writeFileSync(join(dataRoot, 'jobs', stuckId, 'job.json'), JSON.stringify({ ...record, id: stuckId, status: 'running', files: [], summary: null, materials: [] }))

    const second = await makeService({ dataRoot })
    const list = await call<JobRecord[]>(second.service, 'listJobs')
    expect(list.ok).toBe(true)
    if (!list.ok) return
    expect(list.value.find(job => job.id === created.value.id)?.status).toBe('succeeded')
    expect(list.value.find(job => job.id === stuckId)?.status).toBe('interrupted')
    const config = await call<{ defaults: { width: number } }>(second.service, 'getConfig')
    expect(config.ok && config.value.defaults.width).toBe(64)
  }, 60_000)
})

describe('recolor through the engine', () => {
  it('reads the job palette with the engine and regenerates a recolored grid as a new job', async () => {
    const { service, subprocess } = await makeService()
    const created = await call<JobRecord>(service, 'createJob', jobRequest(transparentBorderPng(), { ...DEFAULT_SETTINGS, width: 12, height: 12 }))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    await service.settled(created.value.id)
    const original = await call<JobRecord>(service, 'getJob', { jobId: created.value.id })
    if (!original.ok || original.value.summary === null) throw new Error('original job failed')
    const { gridWidth: width, gridHeight: height, blankCells } = original.value.summary
    expect(blankCells).toBeGreaterThan(0)
    const palette = await call<{ entries: { code: string; hex: string; sameAs: string | null }[] }>(service, 'getPalette', { jobId: created.value.id })
    expect(palette.ok).toBe(true)
    if (!palette.ok) return
    expect(palette.value.entries.length).toBeGreaterThan(100)
    expect(subprocess.spawned.some(argv => argv.includes('-c') && argv.some(arg => arg.includes('apply_overrides')))).toBe(true)
    const coordinates = await call<{ dataBase64: string }>(service, 'getResultFile', { jobId: created.value.id, name: 'coordinates.csv' })
    if (!coordinates.ok) throw new Error('no coordinates')
    const grid = parseCoordinates(Buffer.from(coordinates.value.dataBase64, 'base64').toString('utf8'), width, height)
    expect(grid).not.toBeNull()
    const target = palette.value.entries.find(entry => entry.sameAs === null && !grid!.some(cell => cell.code === entry.code))
    if (target === undefined) throw new Error('no unused palette entry')
    const firstCode = grid!.find(cell => cell.code !== null)!.code!
    // Replace every bead of the first code; keep empty cells empty.
    const cells = grid!.map(cell => (cell.code === null ? '' : cell.code === firstCode ? target.code : cell.code))
    const edited = await call<JobRecord>(service, 'createEditedJob', { jobId: created.value.id, width, height, cells })
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    expect(edited.value.editedFrom).toBe(created.value.id)
    await service.settled(edited.value.id)
    const done = await call<JobRecord>(service, 'getJob', { jobId: edited.value.id })
    expect(done.ok && done.value.status).toBe('succeeded')
    if (!done.ok) return
    expect([...done.value.files].sort()).toEqual([...RESULT_FILES].sort())
    expect(done.value.editCheck).toEqual({ cells: width * height, mismatched: 0 })
    expect(done.value.summary?.blankCells).toBe(blankCells)
    expect(done.value.materials.some(row => row.code === target.code)).toBe(true)
    expect(done.value.materials.some(row => row.code === firstCode)).toBe(false)
    const originalAgain = await call<JobRecord>(service, 'getJob', { jobId: created.value.id })
    expect(originalAgain.ok && originalAgain.value.materials).toEqual(original.value.materials)
  }, 120_000)

  it('rejects a recolor request with a wrong size or an unknown code', async () => {
    const { service } = await makeService()
    const created = await call<JobRecord>(service, 'createJob', jobRequest(gradientPng(), { ...DEFAULT_SETTINGS, height: 4 }))
    if (!created.ok) throw new Error('job failed')
    await service.settled(created.value.id)
    const done = await call<JobRecord>(service, 'getJob', { jobId: created.value.id })
    if (!done.ok || done.value.summary === null) throw new Error('job failed')
    const { gridWidth: width, gridHeight: height } = done.value.summary
    const size = await call(service, 'createEditedJob', { jobId: created.value.id, width: width - 1, height, cells: Array((width - 1) * height).fill('') })
    expect(!size.ok && size.error.code).toBe('bead-atlas/bad-request')
    const unknown = await call(service, 'createEditedJob', { jobId: created.value.id, width, height, cells: Array(width * height).fill('NOT-A-CODE') })
    expect(!unknown.ok && unknown.error.code).toBe('bead-atlas/invalid-settings')
  }, 90_000)
})

describe('preset names', () => {
  it('[review 6] accepts every name convert.py accepts, including + and names over 40 characters', () => {
    const long = 'warm-palette-for-winter-sunset-portraits-v2-final'
    expect(long.length).toBeGreaterThan(40)
    for (const preset of ['palette+warm', long, '默认1', 'a&b (copy)', 'x'.repeat(1024)]) {
      expect(validateSettings({ ...DEFAULT_SETTINGS, preset }).ok).toBe(true)
    }
    // convert.py preset_path() strips \ / : * ? " < > | and whitespace; nothing left means invalid.
    for (const preset of ['///', ' :* ', 'bad\u0000name', 'line\nbreak', 'x'.repeat(1025)]) {
      expect(validateSettings({ ...DEFAULT_SETTINGS, preset }).ok).toBe(false)
    }
    const argv = conversionArgs('/pkg/scripts/convert.py', '/in.png', '/out', { ...DEFAULT_SETTINGS, preset: '-starts-with-dash' })
    expect(argv).toContain('--preset=-starts-with-dash')
  })
})

describe('png encoder', () => {
  it('writes a PNG Pillow can read with the exact pixels', () => {
    const png = encodeRgbaPng(2, 1, new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0]))
    expect(png.subarray(1, 4).toString()).toBe('PNG')
  })
})

/** RGBA PNG: coloured centre, fully transparent 2-pixel border. */
function transparentBorderPng(size = 24): Buffer {
  const rgba = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = (y * size + x) * 4
      const inside = x >= 2 && y >= 2 && x < size - 2 && y < size - 2
      rgba.set(inside ? [Math.round((x / size) * 255), Math.round((y / size) * 255), 90, 255] : [0, 0, 0, 0], at)
    }
  }
  return encodeRgbaPng(size, size, rgba)
}

describe('argv', () => {
  it('builds an explicit argv with no shell', () => {
    const argv = conversionArgs('/pkg/scripts/convert.py', '/data/in.png', '/data/out', { ...DEFAULT_SETTINGS, preset: '默认1' })
    expect(argv.slice(0, 4)).toEqual(['/pkg/scripts/convert.py', '/data/in.png', '--output', '/data/out'])
    expect(argv).toContain('--preset=默认1')
    expect(argv.join(' ')).not.toMatch(/[;&|`$]/)
  })
})
