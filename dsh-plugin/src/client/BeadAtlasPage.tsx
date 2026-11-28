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
import { ImageUploader, precheckFile, type PickedImage } from './ImageUploader.tsx'
import { JobHistory, statusKey } from './JobHistory.tsx'
import type { BeadAtlasLocaleKey, Translate } from './locales.ts'
import { MaterialsTable } from './MaterialsTable.tsx'
import { ResultDownloads } from './ResultDownloads.tsx'
import css from '../../styles/bead-atlas.module.css'

export interface BeadAtlasPageProps {
  readonly t: Translate
  readonly api: BeadAtlasApi
}

type Phase = 'idle' | 'submitting' | 'running' | 'cancelling'
const PYTHON_DOWNLOAD_URL = 'https://www.python.org/downloads/'
const WAIT_MS = 20_000

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

function Summary({ t, job }: { t: Translate; job: JobRecord }) {
  const summary = job.summary
  if (summary === null) return null
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

export function BeadAtlasPage({ t, api }: BeadAtlasPageProps) {
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
  const life = useRef<AbortController | null>(null)

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

  /** Follow one running job until the Host reports a terminal state. */
  const follow = useCallback(async (jobId: string) => {
    setPhase(previous => (previous === 'cancelling' ? previous : 'running'))
    for (;;) {
      const signal = life.current?.signal
      if (signal?.aborted !== false) return
      const result = await api.getJob({ jobId, waitMs: WAIT_MS }, signal)
      if (signal.aborted) return
      if (!result.ok) { fail(result.error); break }
      setCurrent(result.value)
      if (result.value.status !== 'running') break
    }
    setPhase('idle')
    await refreshJobs()
  }, [api, fail, refreshJobs])

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
  useEffect(() => () => { if (image !== null) URL.revokeObjectURL(image.url) }, [image])

  const pick = async (file: File | Blob, name: string) => {
    setUploadProblem(null)
    if (file instanceof File) {
      const problem = precheckFile(t, file)
      if (problem !== null) { setUploadProblem(problem); return }
    }
    const size = await imageSize(file)
    setImage({
      file,
      name,
      bytes: file.size,
      url: URL.createObjectURL(file),
      width: size?.width ?? null,
      height: size?.height ?? null,
      isGif: file.type === 'image/gif' || /\.gif$/i.test(name),
    })
  }

  const generate = async (source: PickedImage, chosen: Settings) => {
    setMessage(null)
    const bad = invalidField(chosen)
    if (bad !== null) { setMessage(t('settings.invalid', { field: bad })); return }
    setPhase('submitting')
    const dataBase64 = await fileToBase64(source.file)
    const result = await api.createJob({ fileName: source.name, dataBase64, settings: chosen }, life.current?.signal)
    if (!result.ok) { setPhase('idle'); fail(result.error); return }
    setCurrent(result.value)
    void refreshJobs()
    await follow(result.value.id)
  }

  const cancel = async () => {
    if (current === null) return
    setPhase('cancelling')
    const result = await api.cancelJob({ jobId: current.id })
    if (!result.ok && result.error.code !== 'bead-atlas/not-running') fail(result.error)
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
          onClear={() => { setImage(null) }}
        />
        <ConversionSettings t={t} settings={settings} catalog={catalog} disabled={working || !ready} onChange={setSettings} />
      </div>

      <div className={css.actionBar}>
        <Button
          variant="primary"
          disabled={!ready || image === null || working}
          onClick={() => { if (image !== null) void generate(image, settings) }}
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
        {message !== null && <p className={css.errorText} role="alert">{message}</p>}
      </div>

      <section className={css.card} aria-labelledby="bead-atlas-result-title" aria-live="polite">
        <div className={css.cardHeader}>
          <h2 id="bead-atlas-result-title" className={css.cardTitle}>{t('result.title')}</h2>
          {current !== null && <span className={css.status} data-status={current.status}>{t(statusKey(current.status))}</span>}
        </div>
        {current === null && <p className={css.muted}>{t('result.empty')}</p>}
        {current !== null && current.status !== 'succeeded' && current.status !== 'running' && failureText !== null && (
          <p className={css.errorText} role="alert">{failureText}</p>
        )}
        {current !== null && current.status === 'succeeded' && (
          <div className={css.resultLayout}>
            <ImagePreview t={t} api={api} job={current} />
            <div className={css.resultSide}>
              <Summary t={t} job={current} />
              <p className={css.note}>{t('result.hexNote')}</p>
              <ResultDownloads t={t} api={api} job={current} />
            </div>
            <MaterialsTable t={t} materials={current.materials} />
          </div>
        )}
      </section>

      <JobHistory
        t={t}
        jobs={jobs}
        selectedId={current?.id ?? null}
        busy={working}
        onView={(job) => { setCurrent(job) }}
        onRegenerate={(job) => { void regenerate(job) }}
        onDelete={remove}
        onRefresh={() => { void refreshJobs() }}
      />
    </div>
  )
}
