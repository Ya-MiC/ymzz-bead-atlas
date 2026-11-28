/**
 * Run the existing Python engine (scripts/convert.py) through DSH's
 * subprocess service. Every call passes an explicit argv; nothing is ever
 * interpreted by a shell, and the only user-derived argv entries are
 * validated settings and Host-created paths.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { LIMITS, type BrandCatalog, type BrandInfo, type ConversionSettings, type EnvironmentProblem, type EnvironmentStatus, type PresetInfo } from '../remote/types.ts'

/** The subset of DSH `ctx.subprocess` this plugin uses (see @deepseek-ai/dsh-subprocess). */
export interface SubprocessLike {
  resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string>
  spawn(spec: {
    argv: readonly string[]
    cwd: string
    stdio: { stdin: 'ignore'; stdout: { maxBytes: number }; stderr: { maxBytes: number } }
    graceMs: number
    signal?: AbortSignal | undefined
    env?: NodeJS.ProcessEnv | undefined
  }): {
    readonly done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>
    readonly collected: {
      readonly stdout?: { readFrom(offset: number): { text: string } }
      readonly stderr?: { readFrom(offset: number): { text: string } }
    }
    terminate(): void
  }
}

/**
 * Read the Pillow version requirements.txt pins.
 * @param engineRoot - package root.
 * @returns the pinned version text, or 'unknown'.
 */
export function requiredPillow(engineRoot: string): string {
  try {
    const match = /^\s*pillow\s*[=<>~!]=?\s*([^\s#]+)/im.exec(readFileSync(join(engineRoot, 'requirements.txt'), 'utf8'))
    return match?.[1] ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Oldest Pillow scripts/convert.py works with: it calls `Image.get_flattened_data()`,
 * which Pillow added in 12.1 (https://pillow.readthedocs.io/en/stable/releasenotes/12.1.0.html).
 */
export const MIN_PILLOW = '12.1'

/**
 * Compare a Pillow version string with a minimum, numerically by release segment.
 * Unparseable versions count as too old so the GUI shows guidance instead of failing later.
 * @param version - e.g. '13.0.0', '12.1.0.dev0'.
 * @param minimum - e.g. '12.1'.
 */
export function pillowAtLeast(version: string, minimum: string = MIN_PILLOW): boolean {
  const parse = (text: string): number[] | null => {
    const match = /^(\d+(?:\.\d+)*)/.exec(text.trim())
    return match?.[1] === undefined ? null : match[1].split('.').map(part => Number.parseInt(part, 10))
  }
  const have = parse(version)
  const need = parse(minimum)
  if (have === null || need === null) return false
  for (let index = 0; index < Math.max(have.length, need.length); index++) {
    const a = have[index] ?? 0
    const b = need[index] ?? 0
    if (a !== b) return a > b
  }
  return true
}

const CHECK_CODE = [
  'import json, sys',
  'info = {"version": list(sys.version_info[:3])}',
  'try:',
  '    import PIL',
  '    info["pillow"] = PIL.__version__',
  'except Exception:',
  '    info["pillow"] = None',
  'print(json.dumps(info))',
].join('\n')

/**
 * Read one palette with the engine's own functions (load_brands, load_preset,
 * read_palette_csv, apply_overrides), so the GUI never carries a palette copy.
 * The preset handling repeats the loading steps of convert.py main() (lines that
 * read a preset's brand, overrides and extra colours); no matching logic is involved.
 * argv: [scripts dir, brand id, preset name or ''].
 */
const PALETTE_CODE = [
  'import json, sys',
  'sys.path.insert(0, sys.argv[1])',
  'import convert',
  'payload, brands = convert.load_brands()',
  'brand_id, preset = sys.argv[2], sys.argv[3]',
  'overrides, extra = {}, {}',
  'if preset:',
  '    data = convert.load_preset(preset)',
  '    brand_id = data.get("brand", brand_id)',
  '    for code, value in (data.get("overrides") or {}).items():',
  '        overrides[code] = {"rgb": convert.hex_to_rgb(value), "name": code}',
  '    for item in data.get("extra_colors") or []:',
  '        extra[item["code"]] = {"rgb": convert.hex_to_rgb(item["hex"]), "name": item.get("name", item["code"])}',
  'brand = brands[brand_id]',
  'entries = convert.apply_overrides(convert.read_palette_csv(convert.DATA_DIR / brand["file"]), overrides, extra)',
  'print(json.dumps({"brand_id": brand_id, "brand": brand["name"], "entries": [',
  '    {"code": e["code"], "name": e["name"], "hex": convert.rgb_to_hex(e["rgb"]), "origin": e["origin"]} for e in entries',
  ']}, ensure_ascii=False))',
].join('\n')

const PALETTE_OUTPUT_BYTES = 2 * 1024 * 1024

const CHILD_ENV: NodeJS.ProcessEnv = {
  PYTHONIOENCODING: 'utf-8',
  PYTHONUTF8: '1',
  PYTHONDONTWRITEBYTECODE: '1',
}

const PYTHON_NAME = /^(python(3(\.\d+)?)?|py)(\.exe)?$/i

/** A resolved interpreter: executable plus any fixed launcher arguments. */
export interface PythonCommand {
  readonly executable: string
  readonly prefix: readonly string[]
  readonly configured: boolean
}

export interface RunOutcome {
  readonly kind: 'ok' | 'failed' | 'timeout' | 'cancelled' | 'spawn-failed'
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}

/**
 * Check that a configured interpreter path is acceptable before it is ever executed.
 * @param path - absolute path from plugin configuration.
 * @returns whether it names an existing Python-like executable file.
 */
export function acceptablePythonPath(path: string): boolean {
  if (!isAbsolute(path) || !PYTHON_NAME.test(basename(path))) return false
  try { return statSync(path).isFile() } catch { return false }
}

export class PythonRunner {
  private cachedEnvironment: { status: EnvironmentStatus; command: PythonCommand | null } | null = null

  constructor(
    private readonly subprocess: SubprocessLike,
    /** Package root holding scripts/convert.py, scripts/brands.json and scripts/data. */
    readonly engineRoot: string,
    private readonly pythonPath: () => string | null,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  get convertScript(): string {
    return join(this.engineRoot, 'scripts', 'convert.py')
  }

  /** Files the engine needs, relative to the package root, read from brands.json. */
  engineFiles(): { missing: string[] } {
    const missing: string[] = []
    const required = ['scripts/convert.py', 'scripts/brands.json', 'requirements.txt']
    for (const file of required) if (!existsSync(join(this.engineRoot, file))) missing.push(file)
    const registry = join(this.engineRoot, 'scripts', 'brands.json')
    if (existsSync(registry)) {
      try {
        const parsed = JSON.parse(readFileSync(registry, 'utf8')) as { brands?: { file?: unknown }[] }
        for (const brand of parsed.brands ?? []) {
          if (typeof brand.file !== 'string') continue
          const file = `scripts/data/${brand.file}`
          if (!existsSync(join(this.engineRoot, file))) missing.push(file)
        }
      } catch {
        missing.push('scripts/brands.json')
      }
    }
    return { missing }
  }

  private candidates(): PythonCommand[] {
    const configured = this.pythonPath()
    if (configured !== null) {
      const prefix = /^py(\.exe)?$/i.test(basename(configured)) ? ['-3'] : []
      return [{ executable: configured, prefix, configured: true }]
    }
    const names = this.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python']
    return names.map(name => ({ executable: name, prefix: name === 'py' ? ['-3'] : [], configured: false }))
  }

  private async probe(command: PythonCommand, signal: AbortSignal): Promise<{ version: number[]; pillow: string | null } | null> {
    let executable = command.executable
    if (!command.configured) {
      try { executable = await this.subprocess.resolveExecutable(command.executable, undefined, signal) } catch { return null }
    } else if (!acceptablePythonPath(executable)) {
      return null
    }
    const outcome = await this.execute([executable, ...command.prefix, '-c', CHECK_CODE], this.engineRoot, 15_000, signal)
    if (outcome.kind !== 'ok') return null
    try {
      const parsed = JSON.parse(outcome.stdout.trim().split(/\r?\n/).pop() ?? '') as { version?: unknown; pillow?: unknown }
      if (!Array.isArray(parsed.version) || !parsed.version.every(part => typeof part === 'number')) return null
      ;(command as { executable: string }).executable = executable
      return { version: parsed.version as number[], pillow: typeof parsed.pillow === 'string' ? parsed.pillow : null }
    } catch {
      return null
    }
  }

  /**
   * Detect Python, its version, Pillow, and the engine files. Results are cached until `refresh`.
   * @param refresh - ignore the cached result.
   * @param signal - cancellation.
   */
  async environment(refresh: boolean, signal: AbortSignal): Promise<{ status: EnvironmentStatus; command: PythonCommand | null }> {
    if (!refresh && this.cachedEnvironment !== null) return this.cachedEnvironment
    const problems: EnvironmentProblem[] = []
    let found: { command: PythonCommand; version: number[]; pillow: string | null } | null = null
    let firstTooOld: { command: PythonCommand; version: number[]; pillow: string | null } | null = null
    for (const candidate of this.candidates()) {
      const command = { ...candidate }
      const result = await this.probe(command, signal)
      if (result === null) continue
      const [major = 0, minor = 0] = result.version
      if (major > 3 || (major === 3 && minor >= 10)) { found = { command, ...result }; break }
      firstTooOld ??= { command, ...result }
    }
    const reported = found ?? firstTooOld
    if (reported === null) problems.push('python-not-found')
    else if (found === null) problems.push('python-too-old')
    if (found !== null && found.pillow === null) problems.push('pillow-missing')
    else if (found !== null && found.pillow !== null && !pillowAtLeast(found.pillow)) problems.push('pillow-too-old')
    const { missing } = this.engineFiles()
    if (missing.length > 0) problems.push('engine-incomplete')
    const status: EnvironmentStatus = {
      ready: problems.length === 0,
      problems,
      python: {
        found: reported !== null,
        command: reported === null ? null : basename(reported.command.executable),
        version: reported === null ? null : reported.version.join('.'),
        configured: this.pythonPath() !== null,
      },
      pillow: { found: found?.pillow != null, version: found?.pillow ?? null, required: requiredPillow(this.engineRoot), minimum: MIN_PILLOW },
      engine: { complete: missing.length === 0, missing },
      checkedAt: new Date().toISOString(),
    }
    this.cachedEnvironment = { status, command: problems.length === 0 && found !== null ? found.command : null }
    return this.cachedEnvironment
  }

  /** Forget the cached environment, e.g. after the Python path changes. */
  invalidate(): void {
    this.cachedEnvironment = null
  }

  private async ready(signal: AbortSignal): Promise<PythonCommand | null> {
    const { command } = await this.environment(false, signal)
    return command
  }

  /**
   * List brands and presets by asking the engine itself, so the palette data has one source.
   * @param signal - cancellation.
   */
  async catalog(signal: AbortSignal): Promise<BrandCatalog | null> {
    const command = await this.ready(signal)
    if (command === null) return null
    const brandsRun = await this.execute([command.executable, ...command.prefix, this.convertScript, '--list-brands'], this.engineRoot, 30_000, signal)
    if (brandsRun.kind !== 'ok') return null
    const presetsRun = await this.execute([command.executable, ...command.prefix, this.convertScript, '--list-presets'], this.engineRoot, 30_000, signal)
    return { brands: parseBrands(brandsRun.stdout), presets: presetsRun.kind === 'ok' ? parsePresets(presetsRun.stdout) : [] }
  }

  /**
   * Read a brand palette (with a preset's overrides applied) through the engine.
   * @param brandId - brand id the job used.
   * @param preset - preset name the job used, or ''.
   * @returns parsed entries, or null when Python is not ready or the engine refuses.
   */
  async palette(brandId: string, preset: string, signal: AbortSignal): Promise<{ brandId: string; brand: string; entries: { code: string; name: string; hex: string; origin: string }[] } | null> {
    const command = await this.ready(signal)
    if (command === null) return null
    const run = await this.execute([command.executable, ...command.prefix, '-c', PALETTE_CODE, join(this.engineRoot, 'scripts'), brandId, preset], this.engineRoot, 30_000, signal, PALETTE_OUTPUT_BYTES)
    if (run.kind !== 'ok') return null
    try {
      const parsed = JSON.parse(run.stdout.trim().split(/\r?\n/).pop() ?? '') as { brand_id?: unknown; brand?: unknown; entries?: unknown }
      if (typeof parsed.brand_id !== 'string' || typeof parsed.brand !== 'string' || !Array.isArray(parsed.entries)) return null
      const entries = (parsed.entries as Record<string, unknown>[]).filter(entry =>
        typeof entry.code === 'string' && typeof entry.name === 'string' && typeof entry.hex === 'string' && /^#[0-9A-F]{6}$/.test(entry.hex) && typeof entry.origin === 'string',
      ) as { code: string; name: string; hex: string; origin: string }[]
      return { brandId: parsed.brand_id, brand: parsed.brand, entries }
    } catch {
      return null
    }
  }

  /**
   * Run one conversion into a fresh output directory.
   * @param input - Host-created absolute path of the stored source image.
   * @param output - Host-created absolute output directory; must not exist yet.
   * @param settings - validated settings.
   * @param cwd - the job directory.
   * @param signal - user cancellation.
   * @param timeoutMs - hard deadline.
   */
  async convert(input: string, output: string, settings: ConversionSettings, cwd: string, signal: AbortSignal, timeoutMs: number = LIMITS.jobTimeoutMs): Promise<RunOutcome> {
    const command = await this.ready(signal)
    if (command === null) return { kind: 'spawn-failed', exitCode: null, stdout: '', stderr: 'python environment is not ready' }
    return await this.execute([command.executable, ...command.prefix, ...conversionArgs(this.convertScript, input, output, settings)], cwd, timeoutMs, signal)
  }

  private async execute(argv: readonly string[], cwd: string, timeoutMs: number, signal: AbortSignal, maxBytes: number = LIMITS.maxProcessOutputBytes): Promise<RunOutcome> {
    if (signal.aborted) return { kind: 'cancelled', exitCode: null, stdout: '', stderr: '' }
    let handle: ReturnType<SubprocessLike['spawn']>
    try {
      handle = this.subprocess.spawn({
        argv,
        cwd,
        stdio: { stdin: 'ignore', stdout: { maxBytes }, stderr: { maxBytes: LIMITS.maxProcessOutputBytes } },
        graceMs: 2000,
        env: CHILD_ENV,
      })
    } catch (error) {
      return { kind: 'spawn-failed', exitCode: null, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
    }
    let timedOut = false
    let cancelled = false
    const timer = setTimeout(() => { timedOut = true; handle.terminate() }, timeoutMs)
    const onAbort = (): void => { cancelled = true; handle.terminate() }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      const outcome = await handle.done
      const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
      const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
      if (cancelled) return { kind: 'cancelled', exitCode: outcome.exitCode, stdout, stderr }
      if (timedOut) return { kind: 'timeout', exitCode: outcome.exitCode, stdout, stderr }
      return { kind: outcome.exitCode === 0 ? 'ok' : 'failed', exitCode: outcome.exitCode, stdout, stderr }
    } catch (error) {
      return { kind: 'spawn-failed', exitCode: null, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
  }
}

/**
 * Build the convert.py argv for validated settings. Exported for tests.
 */
export function conversionArgs(script: string, input: string, output: string, s: ConversionSettings): string[] {
  const args = [
    script, input,
    '--output', output,
    '--brand', s.brand,
    '--width', String(s.width),
    '--height', String(s.height),
    '--max-colors', String(s.maxColors),
    '--bead-mm', String(s.beadMm),
    '--background', s.background,
    '--board-width', String(s.boardWidth),
    '--board-height', String(s.boardHeight),
    '--pack-size', String(s.packSize),
    '--spare-percent', String(s.sparePercent),
  ]
  // `--preset=NAME` keeps a name that starts with '-' from being read as an option.
  if (s.preset !== '') args.push(`--preset=${s.preset}`)
  return args
}

/** Parse `convert.py --list-brands` tab-separated rows. */
export function parseBrands(text: string): BrandInfo[] {
  const brands: BrandInfo[] = []
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split('\t')
    if (cells.length < 5) continue
    const [id = '', display = '', family = '', colors = '', mm = ''] = cells
    brands.push({ id, display, family, colors: Number.parseInt(colors, 10) || 0, beadMm: Number.parseFloat(mm) || 0 })
  }
  return brands
}

/** Parse `convert.py --list-presets` tab-separated rows. */
export function parsePresets(text: string): PresetInfo[] {
  const presets: PresetInfo[] = []
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split('\t')
    if (cells.length < 5) continue
    presets.push({ name: cells[0] ?? '', brand: cells[1] ?? '' })
  }
  return presets
}
