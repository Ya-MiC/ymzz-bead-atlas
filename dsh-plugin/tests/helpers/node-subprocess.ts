/**
 * TEST ADAPTER, not DSH: a child_process implementation of the small
 * `ctx.subprocess` surface the Host uses (resolveExecutable + spawn with
 * explicit argv, cwd, capped output, terminate). It runs REAL processes, so the
 * Host tests exercise the real Python engine. The real DSH subprocess service
 * is exercised separately in the local DSH integration run.
 */
import { spawn as spawnChild } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import type { SubprocessLike } from '../../src/host/python-runner.ts'

export interface NodeSubprocessOptions {
  /** PATH used for resolveExecutable and the child. Defaults to process.env.PATH. */
  readonly path?: string
  /** Rewrite argv before spawning (used to simulate engine misbehaviour). */
  readonly rewrite?: (argv: readonly string[]) => readonly string[]
}

export class NodeSubprocess implements SubprocessLike {
  readonly spawned: (readonly string[])[] = []
  constructor(private readonly options: NodeSubprocessOptions = {}) {}

  private get path(): string { return this.options.path ?? process.env.PATH ?? '' }

  async resolveExecutable(command: string): Promise<string> {
    if (isAbsolute(command)) return command
    for (const dir of this.path.split(delimiter)) {
      if (dir === '') continue
      const candidate = join(dir, command)
      try { accessSync(candidate, constants.X_OK); return candidate } catch { /* next */ }
    }
    throw new Error(`executable not found: ${command}`)
  }

  spawn(spec: Parameters<SubprocessLike['spawn']>[0]): ReturnType<SubprocessLike['spawn']> {
    const argv = this.options.rewrite?.(spec.argv) ?? spec.argv
    this.spawned.push(argv)
    const [file, ...args] = argv
    if (file === undefined) throw new Error('empty argv')
    const child = spawnChild(file, args, {
      cwd: spec.cwd,
      env: { PATH: this.path, HOME: process.env.HOME ?? '', ...spec.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let outBytes = 0
    let errBytes = 0
    child.stdout.on('data', (chunk: Buffer) => { if (outBytes < spec.stdio.stdout.maxBytes) { out.push(chunk); outBytes += chunk.length } })
    child.stderr.on('data', (chunk: Buffer) => { if (errBytes < spec.stdio.stderr.maxBytes) { err.push(chunk); errBytes += chunk.length } })
    const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (exitCode, signal) => { resolve({ exitCode, signal }) })
    })
    let killTimer: ReturnType<typeof setTimeout> | undefined
    void done.finally(() => { clearTimeout(killTimer) }).catch(() => {})
    return {
      done,
      collected: {
        stdout: { readFrom: () => ({ text: Buffer.concat(out).toString('utf8') }) },
        stderr: { readFrom: () => ({ text: Buffer.concat(err).toString('utf8') }) },
      },
      terminate: () => {
        child.kill('SIGTERM')
        killTimer = setTimeout(() => { child.kill('SIGKILL') }, spec.graceMs)
      },
    }
  }
}
