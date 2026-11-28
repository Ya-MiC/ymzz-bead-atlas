/** Plugin configuration in DSH_HOME/bead-atlas/config.json. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type PluginConfig } from '../remote/types.ts'
import { validateSettings } from '../remote/validate.ts'
import { RequestFailure } from './errors.ts'
import { writeJsonAtomic } from './job-store.ts'
import { acceptablePythonPath } from './python-runner.ts'

const DEFAULT_CONFIG: PluginConfig = { pythonPath: null, defaults: DEFAULT_SETTINGS }

export class ConfigStore {
  private current: PluginConfig = DEFAULT_CONFIG
  readonly path: string

  constructor(dataRoot: string) {
    this.path = join(dataRoot, 'config.json')
  }

  get value(): PluginConfig {
    return this.current
  }

  /** Load the saved file; an unreadable or invalid file falls back to defaults without being overwritten. */
  async load(): Promise<PluginConfig> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<PluginConfig>
      this.current = normalize(parsed)
    } catch {
      this.current = DEFAULT_CONFIG
    }
    return this.current
  }

  /** Validate and persist a partial update. */
  async update(patch: unknown): Promise<PluginConfig> {
    if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
      throw new RequestFailure('bead-atlas/invalid-config', 'config must be an object', {})
    }
    const next = { ...this.current, ...(patch as Partial<PluginConfig>) }
    if (next.pythonPath !== null && (typeof next.pythonPath !== 'string' || !acceptablePythonPath(next.pythonPath))) {
      throw new RequestFailure('bead-atlas/invalid-config', 'pythonPath must be an absolute path to a python executable', { field: 'pythonPath' })
    }
    const defaults = validateSettings(next.defaults)
    if (!defaults.ok) throw new RequestFailure('bead-atlas/invalid-config', 'invalid default settings', { field: defaults.issue.field })
    this.current = { pythonPath: next.pythonPath, defaults: defaults.value }
    await writeJsonAtomic(this.path, this.current)
    return this.current
  }
}

function normalize(raw: Partial<PluginConfig>): PluginConfig {
  const pythonPath = typeof raw.pythonPath === 'string' && acceptablePythonPath(raw.pythonPath) ? raw.pythonPath : null
  const defaults = validateSettings(raw.defaults ?? DEFAULT_SETTINGS)
  return { pythonPath, defaults: defaults.ok ? defaults.value : DEFAULT_SETTINGS }
}
