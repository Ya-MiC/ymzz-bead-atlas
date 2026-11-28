/**
 * Bead Atlas main panel: environment check → pick image → settings → generate
 * → preview → download, plus job history. All state is real Host state; the
 * running view shows no percentage because the engine reports none.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  DEFAULT_SETTINGS,
  type BrandCatalog,
  type ConversionSettings as Settings,
  type EnvironmentStatus,
  type JobRecord,
  type RequestError,
} from '../remote/types.ts'
import type { BeadAtlasApi } from './api.ts'
import { ConversionSettings, invalidField } from './ConversionSettings.tsx'
import { fileToBase64, imageSize, payloadToBlob } from './files.ts'
import { errorText, formatNumber } from './format.ts'
import { ImagePreview } from './ImagePreview.tsx'
import type { GridEdits } from './BeadGrid.tsx'
import { ImageUploader, precheckFile, type PickedImage } from './ImageUploader.tsx'
import { JobHistory, statusKey } from './JobHistory.tsx'
import type { BeadAtlasLocaleKey, Translate } from './locales.ts'
import { MaterialsTable } from './MaterialsTable.tsx'
import { ResultDownloads } from './ResultDownloads.tsx'
import css from '../../styles/bead-atlas.module.css'

export interface BeadAtlasPageProps {
  readonly t: Translate
  readonly api: BeadAtlasApi
  /**
   * Waits between retries after a status request fails; its length is the retry limit.
   * Derived values: the design archive sets no retry count (see docs/DSH-PLUGIN.md).
   */
  readonly pollRetryDelaysMs?: readonly number[]
}

type Phase = 'idle' | 'submitting' | 'running' | 'cancelling'
const PYTHON_DOWNLOAD_URL = 'https://www.python.org/downloads/'
const WAIT_MS = 20_000
const POLL_RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000, 15000]
/** Status errors that are answers, not transient failures: retrying cannot change them. */
const FINAL_POLL_ERRORS = new Set(['bead-atlas/not-found', 'bead-atlas/bad-request', 'bead-atlas/forbidden'])

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

function EnvironmentPanel({ t, status, error, onRecheck, onSavePath, pythonPath }: {
  t: Translate
  status: EnvironmentStatus | null
  error: string | null
  pythonPath: string
  onRecheck: () => void
  onSavePath: (path: string) => Promise<boolean>
}) {
  const [path, setPath] = useState(pythonPath)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => { setPath(pythonPath) }, [pythonPath])
  if (status === null) {
    return <p className={css.envLine} role="status">{error ?? t('env.checking')}</p>
  }
  if (status.ready) {
    return (
      <p className={css.envLine} role="status">
        <span className={css.envDot} aria-hidden="true" />
        {t('env.ready', { python: status.python.version ?? '', pillow: status.pillow.version ?? '' })}
      </p>
    )
  }
  return (
    <section className={css.envPanel} aria-labelledby="bead-atlas-env-title" role="region">
      <h2 id="bead-atlas-env-title" className={css.cardTitle}>{t('env.notReady')}</h2>
      <ul className={css.envList}>
        {status.problems.map(problem => (
          <li key={problem}>
            {problem === 'python-not-found' && <>{t('env.python-not-found')} <a href={PYTHON_DOWNLOAD_URL} target="_blank" rel="noreferrer noopener">{t('env.download')}</a></>}
            {problem === 'python-too-old' && <>{t('env.python-too-old', { version: status.python.version ?? '?' })} <a href={PYTHON_DOWNLOAD_URL} target="_blank" rel="noreferrer noopener">{t('env.download')}</a></>}
            {problem === 'pillow-missing' && (
              <>
                {t('env.pillow-missing', { required: status.pillow.required })}
                <pre className={css.command}>{`${status.python.command ?? 'python3'} -m pip install -r requirements.txt`}</pre>
              </>
            )}
            {problem === 'pillow-too-old' && (
              <>
                {t('env.pillow-too-old', { version: status.pillow.version ?? '?', minimum: status.pillow.minimum, required: status.pillow.required })}
                <pre className={css.command}>{`${status.python.command ?? 'python3'} -m pip install --upgrade -r requirements.txt`}</pre>
              </>
            )}
            {problem === 'engine-incomplete' && t('env.engine-incomplete', { files: status.engine.missing.join(', ') })}
          </li>
        ))}
      </ul>
      <form
        className={css.pathForm}
        onSubmit={(event) => {
          event.preventDefault()
          void onSavePath(path.trim()).then((ok) => { setNote(ok ? t('env.pathSaved') : t('env.pathInvalid')) })
        }}
      >
        <label className={css.field} htmlFor="bead-atlas-python-path">
          <span className={css.fieldLabel}>{t('env.pythonPath')}</span>
          <input id="bead-atlas-python-path" className={css.input} value={path} onChange={(event) => { setPath(event.target.value) }} spellCheck={false} autoComplete="off" />
          <span className={css.fieldHint}>{t('env.pythonPathHint')}</span>
        </label>
        <div className={css.row}>
          <Button type="submit" variant="outline" size="sm">{t('env.savePath')}</Button>
          <Button variant="primary" size="sm" onClick={onRecheck}>{t('env.recheck')}</Button>
        </div>
        {note !== null && <p className={css.muted} role="status">{note}</p>}
      </form>
    </section>
  )
}

function Summary({ t, job, edits }: { t: Translate; job: JobRecord; edits: GridEdits | null }) {
  const base = job.summary
  if (base === null) return null
  const summary = edits === null ? base : { ...base, ...edits.totals }
  const items: [BeadAtlasLocaleKey, string][] = [
    ['result.brand', summary.brand],
    ['result.grid', t('result.gridValue', { width: summary.gridWidth, height: summary.gridHeight })],
    ['result.beads', formatNumber(summary.placedBeads)],
    ['result.blank', formatNumber(summary.blankCells)],
    ['result.colors', formatNumber(summary.usedColors)],
    ['result.size', t('result.sizeValue', { width: summary.estimatedWidthCm, height: summary.estimatedHeightCm })],
    ['result.boards', formatNumber(summary.estimatedBoards)],
    ['result.purchase', formatNumber(summary.purchaseBeads)],
    ['result.meanDe', summary.meanDeltaE00.toFixed(2)],
    ['result.maxDe', summary.maxDeltaE00.toFixed(2)],
  ]
  return (
    <dl className={css.stats}>
      {items.map(([label, value]) => (
        <div key={label} className={css.stat}>
          <dt>{t(label)}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function BeadAtlasPage({ t, api, pollRetryDelaysMs = POLL_RETRY_DELAYS_MS }: BeadAtlasPageProps) {
  const [env, setEnv] = useState<EnvironmentStatus | null>(null)
  const [envError, setEnvError] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<BrandCatalog | null>(null)
  const [pythonPath, setPythonPath] = useState('')
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [image, setImage] = useState<PickedImage | null>(null)
  const [uploadProblem, setUploadProblem] = useState<string | null>(null)
  const [jobs, setJobs] = useState<readonly JobRecord[] | null>(null)
  const [current, setCurrent] = useState<JobRecord | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [pollNote, setPollNote] = useState<string | null>(null)
  const [edits, setEdits] = useState<GridEdits | null>(null)
  /** Job that finished in this session and has not been looked at yet; offers "view result" instead of moving the page. */
  const [justFinished, setJustFinished] = useState<string | null>(null)
  const resultHeading = useRef<HTMLHeadingElement>(null)
  /** True while a newly picked image is being decoded; Generate waits for it. */
  const [decoding, setDecoding] = useState(false)
  const life = useRef<AbortController | null>(null)
  /** Increments on every pick so a slow decode of an older pick cannot overwrite a newer one. */
  const pickToken = useRef(0)
  const following = useRef<string | null>(null)

  const fail = useCallback((error: RequestError) => { setMessage(errorText(t, error)) }, [t])

  const refreshJobs = useCallback(async () => {
    const result = await api.listJobs({}, life.current?.signal)
    if (result.ok) setJobs(result.value)
    return result.ok ? result.value : null
  }, [api])

  const checkEnvironment = useCallback(async (refresh: boolean) => {
    setEnv(null)
    setEnvError(null)
    const result = await api.getEnvironmentStatus({ refresh }, life.current?.signal)
    if (!result.ok) { setEnvError(errorText(t, result.error)); return }
    setEnv(result.value)
    if (result.value.ready) {
      const brands = await api.listBrands({}, life.current?.signal)
      if (brands.ok) setCatalog(brands.value)
    }
  }, [api, t])

  /**
   * Follow one running job until the Host reports a terminal state. A failed status
   * request is retried a limited number of times while the running view (and its
   * cancel control) stays up; only a terminal state, a final error, or the retry
   * limit ends tracking.
   */
  const follow = useCallback(async (jobId: string) => {
    if (following.current === jobId) return
    following.current = jobId
    setPhase(previous => (previous === 'cancelling' ? previous : 'running'))
    let failures = 0
    try {
      for (;;) {
        const signal = life.current?.signal
        if (signal?.aborted !== false) return
        const result = await api.getJob({ jobId, waitMs: WAIT_MS }, signal)
        if (signal.aborted) return
        if (!result.ok) {
          failures++
          if (FINAL_POLL_ERRORS.has(result.error.code) || failures > pollRetryDelaysMs.length) {
            setPollNote(null)
            fail(result.error)
            break
          }
          setPollNote(t('status.retrying', { attempt: failures, max: pollRetryDelaysMs.length }))
          await pause(pollRetryDelaysMs[failures - 1] ?? 1000, signal)
          continue
        }
        failures = 0
        setPollNote(null)
        setCurrent(result.value)
        if (result.value.status !== 'running') {
          if (result.value.status === 'succeeded') setJustFinished(jobId)
          break
        }
      }
    } finally {
      if (following.current === jobId) following.current = null
    }
    setPhase('idle')
    await refreshJobs()
  }, [api, fail, refreshJobs, pollRetryDelaysMs, t])

  // Load the environment, form defaults, and history once when the panel opens.
  useEffect(() => {
    const controller = new AbortController()
    life.current = controller
    void (async () => {
      await checkEnvironment(false)
      const config = await api.getConfig({}, controller.signal)
      if (config.ok && !controller.signal.aborted) {
        setSettings(config.value.defaults)
        setPythonPath(config.value.pythonPath ?? '')
      }
      const list = await refreshJobs()
      const running = list?.find(job => job.status === 'running')
      const latest = running ?? list?.[0]
      if (latest !== undefined && !controller.signal.aborted) setCurrent(latest)
      if (running !== undefined) await follow(running.id)
    })()
    return () => { controller.abort() }
  }, [api, checkEnvironment, follow, refreshJobs])

  // Release the picked image's object URL when it is replaced or the panel closes.
  const imageUrl = image?.url ?? null
  useEffect(() => () => { if (imageUrl !== null && imageUrl !== '') URL.revokeObjectURL(imageUrl) }, [imageUrl])

  const pick = async (file: File | Blob, name: string) => {
    const token = ++pickToken.current
    setUploadProblem(null)
    if (file instanceof File) {
      const problem = precheckFile(t, file)
      if (problem !== null) { setUploadProblem(problem); return }
    }
    // Make the new file the active one at once and mark it decoding, so Generate can
    // never send the previous image while this one is still being read.
    setDecoding(true)
    setImage({
      file,
      name,
      bytes: file.size,
      url: URL.createObjectURL(file),
      width: null,
      height: null,
      isGif: file.type === 'image/gif' || /\.gif$/i.test(name),
    })
    const size = await imageSize(file)
    if (token !== pickToken.current) return
    setImage(previous => (previous !== null && previous.file === file ? { ...previous, width: size?.width ?? null, height: size?.height ?? null } : previous))
    setDecoding(false)
  }

  const generate = async (source: PickedImage, chosen: Settings) => {
    setMessage(null)
    const bad = invalidField(chosen)
    if (bad !== null) { setMessage(t('settings.invalid', { field: bad })); return }
    setPhase('submitting')
    setJustFinished(null)
    let dataBase64: string
    try {
      dataBase64 = await fileToBase64(source.file)
    } catch {
      // A FileReader failure must not leave the panel stuck in "submitting".
      setPhase('idle')
      setMessage(t('upload.readFailed'))
      return
    }
    const result = await api.createJob({ fileName: source.name, dataBase64, settings: chosen }, life.current?.signal)
    if (!result.ok) {
      setPhase('idle')
      fail(result.error)
      if (result.error.code === 'bead-atlas/busy') void refreshJobs()
      return
    }
    setCurrent(result.value)
    void refreshJobs()
    await follow(result.value.id)
  }

  const cancel = async () => {
    if (current === null) return
    setMessage(null)
    setPhase('cancelling')
    const result = await api.cancelJob({ jobId: current.id })
    if (result.ok) {
      if (following.current === null) { setCurrent(result.value); setPhase('idle'); void refreshJobs() }
      return
    }
    if (result.error.code === 'bead-atlas/not-running') {
      if (following.current === null) setPhase('idle')
      return
    }
    // The job is still running: give the cancel control back so the user can retry.
    fail(result.error)
    setPhase(following.current === null ? 'idle' : 'running')
  }

  const regenerate = async (job: JobRecord) => {
    setMessage(null)
    const source = await api.getResultFile({ jobId: job.id, name: 'source' })
    if (!source.ok) { fail(source.error); return }
    const blob = payloadToBlob({ ...source.value, mediaType: `image/${job.sourceFormat}` })
    await pick(blob, job.sourceName)
    setSettings(job.settings)
    const size = await imageSize(blob)
    await generate({
      file: blob, name: job.sourceName, bytes: blob.size, url: '', width: size?.width ?? null, height: size?.height ?? null, isGif: job.sourceFormat === 'gif',
    }, job.settings)
  }

  const regenerateEdited = async (codes: readonly string[]) => {
    if (current?.summary == null) return
    setMessage(null)
    const result = await api.createEditedJob({ jobId: current.id, width: current.summary.gridWidth, height: current.summary.gridHeight, cells: codes }, life.current?.signal)
    if (!result.ok) { fail(result.error); return }
    setEdits(null)
    setCurrent(result.value)
    void refreshJobs()
    await follow(result.value.id)
  }

  const remove = async (job: JobRecord) => {
    const result = await api.deleteJob({ jobId: job.id, confirmed: true })
    if (!result.ok) { fail(result.error); return }
    if (current?.id === job.id) setCurrent(null)
    await refreshJobs()
  }

  const savePath = async (path: string) => {
    const result = await api.updateConfig({ pythonPath: path === '' ? null : path })
    if (!result.ok) return false
    setPythonPath(result.value.pythonPath ?? '')
    await checkEnvironment(true)
    return true
  }

  const ready = env?.ready === true
  const working = phase !== 'idle'
  const currentId = current?.id ?? null
  // Live edits belong to one job; switching jobs drops them.
  useEffect(() => { setEdits(null) }, [currentId])
  const jobRunning = current?.status === 'running'
  const failureText = current?.failure == null
    ? null
    : t(`failure.${current.failure.code}` as BeadAtlasLocaleKey, { detail: current.failure.detail })

  return (
    <div className={css.page} data-testid="bead-atlas-page">
      <header className={css.header}>
        <div>
          <h1 className={css.title}>{t('title')}</h1>
          <p className={css.subtitle}>{t('subtitle')}</p>
        </div>
        <EnvironmentPanel t={t} status={env} error={envError} pythonPath={pythonPath} onRecheck={() => { void checkEnvironment(true) }} onSavePath={savePath} />
      </header>

      <div className={css.workspace}>
        <ImageUploader
          t={t}
          image={image}
          disabled={working}
          problem={uploadProblem}
          onPick={(file) => { void pick(file, file.name) }}
          onClear={() => { pickToken.current++; setDecoding(false); setImage(null) }}
        />
        <ConversionSettings t={t} settings={settings} catalog={catalog} disabled={working || !ready} onChange={setSettings} />
      </div>

      <div className={css.actionBar}>
        <Button
          variant="primary"
          disabled={!ready || image === null || working || decoding || jobRunning}
          onClick={() => { if (image !== null && !decoding) void generate(image, settings) }}
        >
          {t('action.generate')}
        </Button>
        {(phase === 'running' || phase === 'cancelling' || phase === 'submitting') && (
          <>
            <span className={css.runningText} role="status" aria-live="polite">
              <span className={css.spinner} aria-hidden="true" />
              {phase === 'cancelling' ? t('status.cancelling') : t('status.running')}
            </span>
            {phase !== 'submitting' && (
              <Button variant="outline" size="sm" disabled={phase === 'cancelling'} onClick={() => { void cancel() }}>{t('action.cancel')}</Button>
            )}
          </>
        )}
        {justFinished !== null && justFinished === current?.id && phase === 'idle' && (
          <button
            type="button"
            className={css.jumpLink}
            onClick={() => {
              const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
              resultHeading.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
              resultHeading.current?.focus({ preventScroll: true })
              setJustFinished(null)
            }}
          >
            {t('action.viewResult')}
          </button>
        )}
        {decoding && <span className={css.muted} role="status">{t('upload.decoding')}</span>}
        {phase === 'idle' && jobRunning && (
          <>
            <span className={css.muted} role="status">{t('status.busyHint')}</span>
            <Button variant="outline" size="sm" onClick={() => { if (current !== null) void follow(current.id) }}>{t('action.resume')}</Button>
            <Button variant="outline" size="sm" onClick={() => { void cancel() }}>{t('action.cancel')}</Button>
          </>
        )}
        {pollNote !== null && <span className={css.muted} role="status">{pollNote}</span>}
        {message !== null && <p className={css.errorText} role="alert">{message}</p>}
      </div>

      <section className={css.card} aria-labelledby="bead-atlas-result-title" aria-live="polite">
        <div className={css.cardHeader}>
          <h2 id="bead-atlas-result-title" className={css.cardTitle} ref={resultHeading} tabIndex={-1}>{t('result.title')}</h2>
          {current !== null && <span className={css.status} data-status={current.status}>{t(statusKey(current.status))}</span>}
        </div>
        {current === null && <p className={css.muted}>{t('result.empty')}</p>}
        {current !== null && current.status !== 'succeeded' && current.status !== 'running' && failureText !== null && (
          <p className={css.errorText} role="alert">{failureText}</p>
        )}
        {current !== null && current.status === 'succeeded' && (
          <div className={css.resultLayout} key={current.id} data-reveal>
            <ImagePreview t={t} api={api} job={current} busy={working || jobRunning} onEdits={setEdits} onRegenerate={regenerateEdited} />
            <div className={css.resultSide}>
              {current.editedFrom !== undefined && (
                <p className={css.note}>
                  {t('result.editedFrom', { id: current.editedFrom })}
                  {current.editCheck !== undefined && current.editCheck.mismatched > 0 && <> {t('result.editMismatch', { count: current.editCheck.mismatched })}</>}
                </p>
              )}
              {edits !== null && <p className={css.editNotice} role="status">{t('result.editsPending', { count: formatNumber(edits.changed) })}</p>}
              <Summary t={t} job={current} edits={edits} />
              <p className={css.note}>{t('result.hexNote')}</p>
              <ResultDownloads t={t} api={api} job={current} />
            </div>
            <MaterialsTable t={t} materials={edits?.materials ?? current.materials} edited={edits !== null} />
          </div>
        )}
      </section>

      <JobHistory
        t={t}
        jobs={jobs}
        selectedId={current?.id ?? null}
        busy={working}
        onView={(job) => {
          setCurrent(job)
          if (job.status === 'running' && phase === 'idle') void follow(job.id)
        }}
        onRegenerate={(job) => { void regenerate(job) }}
        onDelete={remove}
        onRefresh={() => { void refreshJobs() }}
      />
    </div>
  )
}
