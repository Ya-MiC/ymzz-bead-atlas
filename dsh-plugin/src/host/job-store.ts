/**
 * On-disk job records under DSH_HOME/bead-atlas. Every path is derived from a
 * Host-generated job id and checked to stay inside the jobs root; no browser
 * supplied name ever becomes part of a path.
 */
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep, isAbsolute } from 'node:path'
import type { JobRecord } from '../remote/types.ts'
import { RequestFailure } from './errors.ts'

const JOB_ID = /^job-\d{8}-\d{6}-[0-9a-f]{8}$/

/** Whether `child` is strictly inside `parent` after resolution. */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..')
}

/**
 * Validate a job id from the Client.
 * @param id - untrusted id.
 * @returns the id when it has the Host's own shape.
 */
export function checkJobId(id: unknown): string {
  if (typeof id !== 'string' || !JOB_ID.test(id)) {
    throw new RequestFailure('bead-atlas/bad-request', 'invalid job id', {})
  }
  return id
}

function stamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
}

export interface JobPaths {
  readonly dir: string
  readonly input: string
  readonly output: string
  readonly record: string
}

/** Atomically write JSON next to its destination, then rename over it. */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8')
  await rename(temporary, path)
}

export class JobStore {
  readonly jobsRoot: string

  constructor(readonly dataRoot: string) {
    this.jobsRoot = join(dataRoot, 'jobs')
  }

  async init(): Promise<void> {
    await mkdir(this.jobsRoot, { recursive: true })
    await mkdir(join(this.dataRoot, 'logs'), { recursive: true })
  }

  /** Allocate a new id whose directory does not exist yet. */
  newJobId(now: Date = new Date()): string {
    for (;;) {
      const id = `job-${stamp(now)}-${randomBytes(4).toString('hex')}`
      if (!existsSync(join(this.jobsRoot, id))) return id
    }
  }

  paths(id: string): JobPaths {
    checkJobId(id)
    const dir = join(this.jobsRoot, id)
    if (!isInside(this.jobsRoot, dir)) throw new RequestFailure('bead-atlas/bad-request', 'job path escapes the data directory', {})
    return { dir, input: join(dir, 'input'), output: join(dir, 'output'), record: join(dir, 'job.json') }
  }

  /** Create the directory of a new job; refuses to reuse an existing one. */
  async create(id: string): Promise<JobPaths> {
    const paths = this.paths(id)
    await mkdir(this.jobsRoot, { recursive: true })
    await mkdir(paths.dir, { recursive: false })
    await mkdir(paths.input)
    return paths
  }

  async save(record: JobRecord): Promise<void> {
    await writeJsonAtomic(this.paths(record.id).record, record)
  }

  async load(id: string): Promise<JobRecord> {
    const paths = this.paths(id)
    let text: string
    try {
      text = await readFile(paths.record, 'utf8')
    } catch {
      throw new RequestFailure('bead-atlas/not-found', 'job not found', { jobId: id })
    }
    return JSON.parse(text) as JobRecord
  }

  /** All readable job records, newest first. Unreadable entries are skipped. */
  async list(limit: number): Promise<JobRecord[]> {
    let names: string[]
    try { names = await readdir(this.jobsRoot) } catch { return [] }
    const ids = names.filter(name => JOB_ID.test(name)).sort().reverse().slice(0, limit)
    const records: JobRecord[] = []
    for (const id of ids) {
      try { records.push(await this.load(id)) } catch { /* skip a damaged or partial job */ }
    }
    return records
  }

  /**
   * Mark jobs that were running when the Host stopped. Their process is gone,
   * so they become `interrupted`; output is kept as found.
   * @returns ids that were recovered.
   */
  async recover(): Promise<string[]> {
    const recovered: string[] = []
    for (const record of await this.list(Number.MAX_SAFE_INTEGER)) {
      if (record.status !== 'running') continue
      await this.save({ ...record, status: 'interrupted', finishedAt: new Date().toISOString() })
      recovered.push(record.id)
    }
    return recovered
  }

  /** Delete one job directory after confirming it resolves inside the jobs root. */
  async remove(id: string): Promise<void> {
    const paths = this.paths(id)
    if (!existsSync(paths.dir)) throw new RequestFailure('bead-atlas/not-found', 'job not found', { jobId: id })
    const real = await realpath(paths.dir)
    const root = await realpath(this.jobsRoot)
    if (!isInside(root, real)) throw new RequestFailure('bead-atlas/bad-request', 'job path escapes the data directory', {})
    await rm(real, { recursive: true, force: false })
  }
}
