/**
 * Bead Atlas Host service: validates requests, owns jobs, and runs the
 * Python engine. Endpoint names follow the task brief; payloads are JSON.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ENDPOINTS, LIMITS,
  type BeadAtlasEndpoints, type BrandCatalog, type ConversionSettings, type ImageFormat, type EndpointName, type EnvironmentStatus, type JobRecord,
  type JobPalette, type PluginConfig, type RequestError, type ResultFilePayload, type RpcOutcome,
} from '../remote/types.ts'
import { validateSettings } from '../remote/validate.ts'
import { RequestFailure } from './errors.ts'
import { decodeBase64, displayName, FORMAT_EXTENSION, inspectImage } from './image-validation.ts'
import { checkJobId, JobStore } from './job-store.ts'
import { PythonRunner, type SubprocessLike } from './python-runner.ts'
import { presentOutputs, readJobFile, summarizeUsage } from './result-files.ts'
import { ConfigStore } from './config-store.ts'
import { encodeRgbaPng } from './png-encode.ts'
import { parseCoordinates } from '../remote/csv.ts'

export interface ServiceOptions {
  readonly subprocess: SubprocessLike
  /** DSH_HOME/bead-atlas. */
  readonly dataRoot: string
  /** Package root holding scripts/. */
  readonly engineRoot: string
  readonly timeoutMs?: number
  readonly platform?: NodeJS.Platform
}

export class BeadAtlasService {
  readonly store: JobStore
  readonly config: ConfigStore
  readonly runner: PythonRunner
  private readonly running = new Map<string, { controller: AbortController; finished: Promise<void> }>()
  private readonly timeoutMs: number
  private disposed = false
  /** Set synchronously when a createJob passes the busy check, before its first await. */
  private reserved = false
  private catalogCache: BrandCatalog | null = null
  private readonly paletteCache = new Map<string, JobPalette['entries']>()

  constructor(options: ServiceOptions) {
    this.store = new JobStore(options.dataRoot)
    this.config = new ConfigStore(options.dataRoot)
    this.runner = new PythonRunner(options.subprocess, options.engineRoot, () => this.config.value.pythonPath, options.platform)
    this.timeoutMs = options.timeoutMs ?? LIMITS.jobTimeoutMs
  }

  /** Create directories, load config, and mark jobs left running by a previous Host as interrupted. */
  async start(): Promise<{ recovered: string[] }> {
    await this.store.init()
    await this.config.load()
    return { recovered: await this.store.recover() }
  }

  /** Cancel running jobs and wait for their processes to settle. */
  async dispose(): Promise<void> {
    this.disposed = true
    for (const job of this.running.values()) job.controller.abort()
    await Promise.allSettled([...this.running.values()].map(job => job.finished))
  }

  async getEnvironmentStatus(payload: { refresh?: boolean }, signal: AbortSignal): Promise<EnvironmentStatus> {
    const { status } = await this.runner.environment(payload.refresh === true, signal)
    if (payload.refresh === true) { this.catalogCache = null; this.paletteCache.clear() }
    return status
  }

  async listBrands(signal: AbortSignal): Promise<BrandCatalog> {
    if (this.catalogCache !== null) return this.catalogCache
    const catalog = await this.runner.catalog(signal)
    if (catalog === null) throw new RequestFailure('bead-atlas/environment', 'python environment is not ready', {})
    this.catalogCache = catalog
    return catalog
  }

  async createJob(payload: unknown, signal: AbortSignal): Promise<JobRecord> {
    if (this.disposed) throw new RequestFailure('bead-atlas/busy', 'plugin is stopping', {})
    if (typeof payload !== 'object' || payload === null) throw new RequestFailure('bead-atlas/bad-request', 'missing job request', {})
    const request = payload as Record<string, unknown>
    const settings = validateSettings(request.settings)
    if (!settings.ok) throw new RequestFailure('bead-atlas/invalid-settings', 'invalid conversion settings', { ...settings.issue })
    const bytes = decodeBase64(request.dataBase64)
    const facts = inspectImage(bytes)
    return await this.startJob(signal, { bytes, format: facts.format, width: facts.width, height: facts.height, sourceName: displayName(request.fileName), settings: settings.value })
  }

  /**
   * Reserve the single conversion slot, check the environment and catalog, then start Python.
   * The slot is taken before the first await so two concurrent requests cannot both pass.
   */
  private async startJob(signal: AbortSignal, source: {
    bytes: Buffer; format: ImageFormat; width: number; height: number; sourceName: string; settings: ConversionSettings
    editedFrom?: string; expectedCells?: readonly string[]
  }): Promise<JobRecord> {
    if (this.reserved || this.running.size > 0) throw new RequestFailure('bead-atlas/busy', 'another conversion is running', {})
    this.reserved = true
    try {
      const { status } = await this.runner.environment(false, signal)
      if (!status.ready) throw new RequestFailure('bead-atlas/environment', 'python environment is not ready', { problems: status.problems })
      const catalog = await this.listBrands(signal)
      if (!catalog.brands.some(brand => brand.id === source.settings.brand)) {
        throw new RequestFailure('bead-atlas/invalid-settings', 'unknown brand', { field: 'brand', reason: 'range' })
      }
      if (source.settings.preset !== '' && !catalog.presets.some(preset => preset.name === source.settings.preset)) {
        throw new RequestFailure('bead-atlas/invalid-settings', 'unknown preset', { field: 'preset', reason: 'range' })
      }
      const id = this.store.newJobId()
      const paths = await this.store.create(id)
      const input = join(paths.input, `source.${FORMAT_EXTENSION[source.format]}`)
      await writeFile(input, source.bytes, { flag: 'wx' })
      const record: JobRecord = {
        id,
        createdAt: new Date().toISOString(),
        finishedAt: null,
        status: 'running',
        sourceName: source.sourceName,
        sourceFormat: source.format,
        sourceWidth: source.width,
        sourceHeight: source.height,
        sourceBytes: source.bytes.length,
        settings: source.settings,
        files: [],
        summary: null,
        materials: [],
        failure: null,
        ...(source.editedFrom === undefined ? {} : { editedFrom: source.editedFrom }),
      }
      await this.store.save(record)
      const controller = new AbortController()
      const finished = this.run(record, input, paths.output, paths.dir, controller.signal, source.expectedCells)
        .finally(() => { this.running.delete(id) })
      this.running.set(id, { controller, finished })
      return record
    } finally {
      this.reserved = false
    }
  }

  private async run(record: JobRecord, input: string, output: string, cwd: string, signal: AbortSignal, expectedCells?: readonly string[]): Promise<void> {
    let next: JobRecord
    try {
      const outcome = await this.runner.convert(input, output, record.settings, cwd, signal, this.timeoutMs)
      const finishedAt = new Date().toISOString()
      if (outcome.kind === 'cancelled') {
        next = { ...record, status: 'cancelled', finishedAt }
      } else if (outcome.kind === 'timeout') {
        next = { ...record, status: 'failed', finishedAt, failure: { code: 'bead-atlas/timeout', detail: `stopped after ${Math.round(this.timeoutMs / 1000)} s` } }
      } else if (outcome.kind === 'spawn-failed') {
        next = { ...record, status: 'failed', finishedAt, failure: { code: 'bead-atlas/spawn-failed', detail: tail(outcome.stderr) } }
      } else if (outcome.kind === 'failed') {
        next = { ...record, status: 'failed', finishedAt, failure: { code: 'bead-atlas/engine-failed', detail: tail(outcome.stderr) } }
      } else {
        const { present, missing } = await presentOutputs(output)
        if (missing.length > 0) {
          next = { ...record, status: 'failed', finishedAt, files: present, failure: { code: 'bead-atlas/output-incomplete', detail: `missing: ${missing.join(', ')}` } }
        } else {
          const usage = JSON.parse(await readFile(join(output, 'usage.json'), 'utf8')) as unknown
          const { summary, materials } = summarizeUsage(usage)
          next = { ...record, status: 'succeeded', finishedAt, files: present, summary, materials }
          if (expectedCells !== undefined) next = { ...next, editCheck: await checkEdited(output, summary.gridWidth, summary.gridHeight, expectedCells) }
        }
      }
    } catch (error) {
      next = { ...record, status: 'failed', finishedAt: new Date().toISOString(), failure: { code: 'bead-atlas/engine-failed', detail: error instanceof Error ? error.message : String(error) } }
    }
    await this.store.save(next)
  }

  /** Wait until a job's process settles. For tests and orderly shutdown. */
  async settled(jobId: string): Promise<void> {
    await this.running.get(jobId)?.finished
  }

  /**
   * Read a job. With `waitMs`, a running job is awaited up to that long (at most 25 s)
   * so the Client learns the terminal state without a fake progress value.
   */
  async getJob(payload: { jobId?: unknown; waitMs?: unknown }, signal: AbortSignal): Promise<JobRecord> {
    const id = checkJobId(payload.jobId)
    const job = this.running.get(id)
    const waitMs = typeof payload.waitMs === 'number' && Number.isFinite(payload.waitMs) ? Math.min(Math.max(payload.waitMs, 0), 25_000) : 0
    if (job !== undefined && waitMs > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined
      let onAbort: (() => void) | undefined
      await Promise.race([
        job.finished,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, waitMs)
          onAbort = resolve
          signal.addEventListener('abort', onAbort, { once: true })
        }),
      ])
      clearTimeout(timer)
      if (onAbort) signal.removeEventListener('abort', onAbort)
    }
    return await this.store.load(id)
  }

  async cancelJob(payload: { jobId?: unknown }): Promise<JobRecord> {
    const id = checkJobId(payload.jobId)
    const job = this.running.get(id)
    if (job === undefined) throw new RequestFailure('bead-atlas/not-running', 'job is not running', { jobId: id })
    job.controller.abort()
    await job.finished
    return await this.store.load(id)
  }

  async listJobs(): Promise<JobRecord[]> {
    return await this.store.list(LIMITS.maxListedJobs)
  }

  async getResultFile(payload: { jobId?: unknown; name?: unknown }): Promise<ResultFilePayload> {
    const id = checkJobId(payload.jobId)
    await this.store.load(id)
    return await readJobFile(this.store.paths(id), payload.name)
  }

  async deleteJob(payload: { jobId?: unknown; confirmed?: unknown }): Promise<{ deleted: string }> {
    const id = checkJobId(payload.jobId)
    if (payload.confirmed !== true) throw new RequestFailure('bead-atlas/confirmation-required', 'deleting a job needs explicit confirmation', { jobId: id })
    if (this.running.has(id)) throw new RequestFailure('bead-atlas/busy', 'job is still running', { jobId: id })
    await this.store.remove(id)
    return { deleted: id }
  }

  /**
   * The palette a finished job used, read by the Python engine (brand plus the job's preset).
   * Each entry notes an earlier code with the same RGB, because the engine maps that colour to the earlier code.
   */
  async getPalette(payload: { jobId?: unknown }, signal: AbortSignal): Promise<JobPalette> {
    const id = checkJobId(payload.jobId)
    const job = await this.store.load(id)
    if (job.status !== 'succeeded' || job.summary === null) throw new RequestFailure('bead-atlas/not-found', 'job has no finished pattern', { jobId: id })
    const key = `${job.summary.brandId}\u0000${job.settings.preset}`
    let entries = this.paletteCache.get(key)
    if (entries === undefined) {
      const read = await this.runner.palette(job.summary.brandId, job.settings.preset, signal)
      if (read === null) throw new RequestFailure('bead-atlas/environment', 'the engine could not read the palette', {})
      const firstByHex = new Map<string, string>()
      entries = read.entries.map((entry) => {
        const earlier = firstByHex.get(entry.hex) ?? null
        if (earlier === null) firstByHex.set(entry.hex, entry.code)
        return { ...entry, sameAs: earlier }
      })
      this.paletteCache.set(key, entries)
    }
    return { jobId: id, brandId: job.summary.brandId, brand: job.summary.brand, entries }
  }

  /**
   * Regenerate a recolored grid with the unchanged engine. The grid becomes an
   * ordinary RGBA source image at exactly grid size (one pixel per bead, the exact
   * palette RGB; empty cells fully transparent), and convert.py runs on it with the
   * same brand, preset and pegboard settings, the grid size, and no colour limit.
   * The original job is not touched; the result is a new job with all seven files.
   */
  async createEditedJob(payload: unknown, signal: AbortSignal): Promise<JobRecord> {
    if (this.disposed) throw new RequestFailure('bead-atlas/busy', 'plugin is stopping', {})
    if (typeof payload !== 'object' || payload === null) throw new RequestFailure('bead-atlas/bad-request', 'missing edit request', {})
    const request = payload as Record<string, unknown>
    const id = checkJobId(request.jobId)
    const job = await this.store.load(id)
    if (job.status !== 'succeeded' || job.summary === null) throw new RequestFailure('bead-atlas/not-found', 'job has no finished pattern', { jobId: id })
    const { gridWidth: width, gridHeight: height } = job.summary
    if (request.width !== width || request.height !== height) throw new RequestFailure('bead-atlas/bad-request', 'grid size does not match the job', { width, height })
    const cells = request.cells
    if (!Array.isArray(cells) || cells.length !== width * height || !cells.every(cell => typeof cell === 'string')) {
      throw new RequestFailure('bead-atlas/bad-request', 'cells must list one code per grid cell', { cells: width * height })
    }
    if (this.reserved || this.running.size > 0) throw new RequestFailure('bead-atlas/busy', 'another conversion is running', {})
    const palette = await this.getPalette({ jobId: id }, signal)
    const byCode = new Map(palette.entries.map(entry => [entry.code, entry]))
    const rgba = new Uint8Array(width * height * 4)
    let placed = 0
    ;(cells as string[]).forEach((code, index) => {
      if (code === '') return
      const entry = byCode.get(code)
      if (entry === undefined) throw new RequestFailure('bead-atlas/invalid-settings', 'unknown bead code', { field: 'cells', reason: 'range', index })
      const value = Number.parseInt(entry.hex.slice(1), 16)
      rgba.set([(value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF, 0xFF], index * 4)
      placed++
    })
    if (placed === 0) throw new RequestFailure('bead-atlas/bad-request', 'the grid has no beads', {})
    const bytes = encodeRgbaPng(width, height, rgba)
    return await this.startJob(signal, {
      bytes,
      format: 'png',
      width,
      height,
      sourceName: job.sourceName,
      settings: { ...job.settings, brand: job.summary.brandId, width, height, maxColors: 0 },
      editedFrom: id,
      expectedCells: cells as string[],
    })
  }

  getConfig(): PluginConfig {
    return this.config.value
  }

  async updateConfig(payload: unknown): Promise<PluginConfig> {
    const before = this.config.value.pythonPath
    const next = await this.config.update(payload)
    if (next.pythonPath !== before) { this.runner.invalidate(); this.catalogCache = null }
    return next
  }

  /**
   * Dispatch one RPC endpoint and fold every failure into a coded result.
   * @param endpoint - endpoint name from the channel.
   * @param payload - untrusted JSON payload.
   * @param signal - request cancellation.
   */
  async dispatch(endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcOutcome<unknown>> {
    if (!(ENDPOINTS as readonly string[]).includes(endpoint)) {
      return failure({ code: 'bead-atlas/bad-request', message: `unknown endpoint ${endpoint}`, details: {} })
    }
    const body = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
    try {
      const name = endpoint as EndpointName
      const value = await this.call(name, body, signal)
      return { ok: true, value }
    } catch (error) {
      if (error instanceof RequestFailure) return failure({ code: error.code, message: error.message, details: error.details })
      return failure({ code: 'bead-atlas/internal', message: error instanceof Error ? error.message : 'internal error', details: {} })
    }
  }

  private async call(name: EndpointName, body: Record<string, unknown>, signal: AbortSignal): Promise<BeadAtlasEndpoints[EndpointName]['result']> {
    switch (name) {
      case 'getEnvironmentStatus': return await this.getEnvironmentStatus(body as { refresh?: boolean }, signal)
      case 'listBrands': return await this.listBrands(signal)
      case 'createJob': return await this.createJob(body, signal)
      case 'getJob': return await this.getJob(body, signal)
      case 'cancelJob': return await this.cancelJob(body)
      case 'listJobs': return await this.listJobs()
      case 'getResultFile': return await this.getResultFile(body)
      case 'deleteJob': return await this.deleteJob(body)
      case 'getConfig': return this.getConfig()
      case 'updateConfig': return await this.updateConfig(body)
      case 'getPalette': return await this.getPalette(body, signal)
      case 'createEditedJob': return await this.createEditedJob(body, signal)
    }
  }
}

function failure(error: RequestError): RpcOutcome<never> {
  return { ok: false, error }
}

/** Compare the engine's coordinates.csv with the requested codes, cell by cell. */
async function checkEdited(output: string, width: number, height: number, expected: readonly string[]): Promise<{ cells: number; mismatched: number }> {
  const grid = parseCoordinates(await readFile(join(output, 'coordinates.csv'), 'utf8'), width, height)
  if (grid === null) return { cells: expected.length, mismatched: expected.length }
  let mismatched = 0
  grid.forEach((cell, index) => { if ((cell.code ?? '') !== (expected[index] ?? '')) mismatched++ })
  return { cells: expected.length, mismatched }
}

function tail(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > 2000 ? trimmed.slice(-2000) : trimmed
}
