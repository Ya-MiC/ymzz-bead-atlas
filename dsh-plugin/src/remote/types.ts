/**
 * Wire vocabulary shared by the Bead Atlas Host and Client halves.
 *
 * Every value here crosses DSH's Connection RPC channel as JSON, so the shapes
 * are plain data: no Buffers, Files, or class instances. Binary file content
 * travels as base64 text because Connection RPC parameters are JSON only.
 */

/** Authenticated Connection RPC channel owned by this plugin. */
export const BEAD_ATLAS_CHANNEL = '/bead-atlas'

/** Shared panel id: the sidebar entry and the main panel it opens. */
export const BEAD_ATLAS_PANEL_ID = 'bead-atlas'

/** The seven files the Python engine writes for every successful job. */
export const RESULT_FILES = [
  'pattern.png',
  'pattern.svg',
  'preview.png',
  'materials.csv',
  'coordinates.csv',
  'usage.json',
  'report.md',
] as const

export type ResultFileName = (typeof RESULT_FILES)[number]

/** A file a Client may request: one of the seven outputs, or the stored source image. */
export type JobFileName = ResultFileName | 'source'

/** Image formats the GUI accepts. GIF converts only its first frame. */
export const ACCEPTED_FORMATS = ['png', 'jpeg', 'webp', 'gif', 'bmp'] as const
export type ImageFormat = (typeof ACCEPTED_FORMATS)[number]

/** Hard limits the Host enforces; the Client mirrors them only for early feedback. */
export const LIMITS = {
  /** Largest accepted source file, in bytes. */
  maxFileBytes: 15 * 1024 * 1024,
  /** Largest accepted source image, in pixels (width × height). */
  maxPixels: 40_000_000,
  /** Largest accepted source edge, in pixels. */
  maxEdgePx: 12_000,
  /** Longest a single conversion may run before the Host stops it. */
  jobTimeoutMs: 120_000,
  /** Bytes of stdout and stderr the Host keeps from one Python run. */
  maxProcessOutputBytes: 64 * 1024,
  /** Largest result file the Host returns over RPC, in bytes. */
  maxResultBytes: 40 * 1024 * 1024,
  /** Number of jobs listed in the history. */
  maxListedJobs: 200,
} as const

/**
 * Conversion settings. Each range matches what scripts/convert.py accepts,
 * so the GUI cannot request a run the CLI would refuse.
 */
export interface ConversionSettings {
  /** Brand id from `convert.py --list-brands`. */
  readonly brand: string
  /** Named preset from scripts/presets, or '' for none. A preset's brand wins over `brand`. */
  readonly preset: string
  /** Grid width in cells; 0 lets the engine choose its default (48). Range 0–300. */
  readonly width: number
  /** Grid height in cells; 0 follows the image aspect ratio. Range 0–300. */
  readonly height: number
  /** Most colors to use; 0 means no limit. Range 0–2093. */
  readonly maxColors: number
  /** Bead diameter in mm; 0 uses the brand's own diameter. Otherwise 0.1–20. */
  readonly beadMm: number
  /** Background for semi-transparent pixels, `#RRGGBB`. */
  readonly background: string
  /** Pegboard width in cells, 1–300. */
  readonly boardWidth: number
  /** Pegboard height in cells, 1–300. */
  readonly boardHeight: number
  /** Beads per pack, 1–1,000,000. */
  readonly packSize: number
  /** Spare percentage added to each color, 0–100. */
  readonly sparePercent: number
}

export const DEFAULT_SETTINGS: ConversionSettings = {
  brand: 'mard',
  preset: '',
  width: 48,
  height: 0,
  maxColors: 32,
  beadMm: 0,
  background: '#FFFFFF',
  boardWidth: 29,
  boardHeight: 29,
  packSize: 1000,
  sparePercent: 10,
}

/** Numeric bounds for each numeric setting: [min, max, integer]. */
export const SETTING_BOUNDS = {
  width: [0, 300, true],
  height: [0, 300, true],
  maxColors: [0, 2093, true],
  beadMm: [0, 20, false],
  boardWidth: [1, 300, true],
  boardHeight: [1, 300, true],
  packSize: [1, 1_000_000, true],
  sparePercent: [0, 100, false],
} as const satisfies Record<string, readonly [number, number, boolean]>

/** One brand palette as the Python engine lists it. */
export interface BrandInfo {
  readonly id: string
  readonly display: string
  readonly family: string
  readonly colors: number
  readonly beadMm: number
}

/** One saved preset as the Python engine lists it. */
export interface PresetInfo {
  readonly name: string
  readonly brand: string
}

export interface BrandCatalog {
  readonly brands: readonly BrandInfo[]
  readonly presets: readonly PresetInfo[]
}

/** Problems the environment check can report. Codes only; the Client owns the sentences. */
export type EnvironmentProblem =
  | 'python-not-found'
  | 'python-too-old'
  | 'pillow-missing'
  | 'engine-incomplete'

export interface EnvironmentStatus {
  readonly ready: boolean
  readonly problems: readonly EnvironmentProblem[]
  readonly python: {
    readonly found: boolean
    /** Executable file name only (never the full path or environment). */
    readonly command: string | null
    readonly version: string | null
    readonly configured: boolean
  }
  readonly pillow: {
    readonly found: boolean
    readonly version: string | null
    readonly required: string
  }
  readonly engine: {
    readonly complete: boolean
    readonly missing: readonly string[]
  }
  readonly checkedAt: string
}

/**
 * Job states. Only facts the Host can observe: a job is queued while its
 * process starts, running while the process lives, then exactly one terminal
 * state. There is no percentage because the engine reports none.
 */
export type JobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'

export type JobFailureCode =
  | 'bead-atlas/engine-failed'
  | 'bead-atlas/timeout'
  | 'bead-atlas/output-incomplete'
  | 'bead-atlas/spawn-failed'
  | 'bead-atlas/environment'

export interface JobSummary {
  readonly brand: string
  readonly brandId: string
  readonly gridWidth: number
  readonly gridHeight: number
  readonly placedBeads: number
  readonly blankCells: number
  readonly usedColors: number
  readonly estimatedWidthCm: number
  readonly estimatedHeightCm: number
  readonly estimatedBoards: number
  readonly purchaseBeads: number
  readonly estimatedPacks: number
  readonly meanDeltaE00: number
  readonly maxDeltaE00: number
}

export interface MaterialRow {
  readonly code: string
  readonly name: string
  readonly referenceHex: string
  readonly origin: string
  readonly beadCount: number
  readonly purchaseBeads: number
  readonly packsToBuy: number
}

export interface JobRecord {
  readonly id: string
  readonly createdAt: string
  readonly finishedAt: string | null
  readonly status: JobStatus
  /** Display name of the uploaded file, sanitized; never used as a path. */
  readonly sourceName: string
  readonly sourceFormat: ImageFormat
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly sourceBytes: number
  readonly settings: ConversionSettings
  readonly files: readonly ResultFileName[]
  readonly summary: JobSummary | null
  readonly materials: readonly MaterialRow[]
  readonly failure: { readonly code: JobFailureCode; readonly detail: string } | null
}

export interface PluginConfig {
  /** Absolute path to a Python executable, or null to search PATH. */
  readonly pythonPath: string | null
  /** Settings the form opens with. */
  readonly defaults: ConversionSettings
}

export interface CreateJobRequest {
  readonly fileName: string
  readonly dataBase64: string
  readonly settings: ConversionSettings
}

export interface ResultFilePayload {
  readonly name: JobFileName
  readonly mediaType: string
  readonly bytes: number
  readonly dataBase64: string
}

/** Request failures. Codes only; the Client owns the sentences. */
export type RequestErrorCode =
  | 'bead-atlas/forbidden'
  | 'bead-atlas/bad-request'
  | 'bead-atlas/unsupported-format'
  | 'bead-atlas/file-too-large'
  | 'bead-atlas/image-too-large'
  | 'bead-atlas/invalid-settings'
  | 'bead-atlas/not-found'
  | 'bead-atlas/busy'
  | 'bead-atlas/not-running'
  | 'bead-atlas/environment'
  | 'bead-atlas/confirmation-required'
  | 'bead-atlas/invalid-config'
  | 'bead-atlas/internal'

export interface RequestError {
  readonly code: RequestErrorCode
  readonly message: string
  readonly details: Record<string, unknown>
}

export type RpcOutcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: RequestError }

/** Every endpoint, its payload, and its result. */
export interface BeadAtlasEndpoints {
  getEnvironmentStatus: { payload: { readonly refresh?: boolean }; result: EnvironmentStatus }
  listBrands: { payload: Record<string, never>; result: BrandCatalog }
  createJob: { payload: CreateJobRequest; result: JobRecord }
  getJob: { payload: { readonly jobId: string; readonly waitMs?: number }; result: JobRecord }
  cancelJob: { payload: { readonly jobId: string }; result: JobRecord }
  listJobs: { payload: Record<string, never>; result: readonly JobRecord[] }
  getResultFile: { payload: { readonly jobId: string; readonly name: JobFileName }; result: ResultFilePayload }
  deleteJob: { payload: { readonly jobId: string; readonly confirmed: boolean }; result: { readonly deleted: string } }
  getConfig: { payload: Record<string, never>; result: PluginConfig }
  updateConfig: { payload: Partial<PluginConfig>; result: PluginConfig }
}

export type EndpointName = keyof BeadAtlasEndpoints
export const ENDPOINTS: readonly EndpointName[] = [
  'getEnvironmentStatus', 'listBrands', 'createJob', 'getJob', 'cancelJob', 'listJobs',
  'getResultFile', 'deleteJob', 'getConfig', 'updateConfig',
]

export const MEDIA_TYPES: Record<JobFileName, string> = {
  'pattern.png': 'image/png',
  'pattern.svg': 'image/svg+xml',
  'preview.png': 'image/png',
  'materials.csv': 'text/csv',
  'coordinates.csv': 'text/csv',
  'usage.json': 'application/json',
  'report.md': 'text/markdown',
  source: 'application/octet-stream',
}
