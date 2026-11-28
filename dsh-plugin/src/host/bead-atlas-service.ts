/**
 * Bead Atlas Host service: validates requests, owns jobs, and runs the
 * Python engine. Endpoint names follow the task brief; payloads are JSON.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ENDPOINTS, LIMITS,
  type BeadAtlasEndpoints, type BrandCatalog, type EndpointName, type EnvironmentStatus, type JobRecord,
  type PluginConfig, type RequestError, type ResultFilePayload, type RpcOutcome,
} from '../remote/types.ts'
import { validateSettings } from '../remote/validate.ts'
import { RequestFailure } from './errors.ts'
import { decodeBase64, displayName, FORMAT_EXTENSION, inspectImage } from './image-validation.ts'
import { checkJobId, JobStore } from './job-store.ts'
import { PythonRunner, type SubprocessLike } from './python-runner.ts'
import { presentOutputs, readJobFile, summarizeUsage } from './result-files.ts'
import { ConfigStore } from './config-store.ts'

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
  private catalogCache: BrandCatalog | null = null

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
    if (payload.refresh === true) this.catalogCache = null
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
    if (this.running.size > 0) throw new RequestFailure('bead-atlas/busy', 'another conversion is running', {})
    const { status } = await this.runner.environment(false, signal)
    if (!status.ready) throw new RequestFailure('bead-atlas/environment', 'python environment is not ready', { problems: status.problems })
    const catalog = await this.listBrands(signal)
    if (!catalog.brands.some(brand => brand.id === settings.value.brand)) {
      throw new RequestFailure('bead-atlas/invalid-settings', 'unknown brand', { field: 'brand', reason: 'range' })
    }
    if (settings.value.preset !== '' && !catalog.presets.some(preset => preset.name === settings.value.preset)) {
      throw new RequestFailure('bead-atlas/invalid-settings', 'unknown preset', { field: 'preset', reason: 'range' })
    }
    const id = this.store.newJobId()
    const paths = await this.store.create(id)
    const input = join(paths.input, `source.${FORMAT_EXTENSION[facts.format]}`)
    await writeFile(input, bytes, { flag: 'wx' })
    const record: JobRecord = {
      id,
      createdAt: new Date().toISOString(),
      finishedAt: null,
      status: 'running',
      sourceName: displayName(request.fileName),
      sourceFormat: facts.format,
      sourceWidth: facts.width,
      sourceHeight: facts.height,
      sourceBytes: facts.bytes,
      settings: settings.value,
      files: [],
      summary: null,
      materials: [],
      failure: null,
    }
    await this.store.save(record)
    const controller = new AbortController()
    const finished = this.run(record, input, paths.output, paths.dir, controller.signal)
      .finally(() => { this.running.delete(id) })
    this.running.set(id, { controller, finished })
    return record
  }

  private async run(record: JobRecord, input: string, output: string, cwd: string, signal: AbortSignal): Promise<void> {
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
    }
  }
}

function failure(error: RequestError): RpcOutcome<never> {
  return { ok: false, error }
}

function tail(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > 2000 ? trimmed.slice(-2000) : trimmed
}
