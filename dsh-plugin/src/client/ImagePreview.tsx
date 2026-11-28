/**
 * Show one finished job: the interactive bead grid (default), the engine's image
 * outputs, and the stored source image.
 */
import { useEffect, useState } from 'react'
import { BeadGrid, type GridEdits } from './BeadGrid.tsx'
import type { JobFileName, JobRecord } from '../remote/types.ts'
import type { BeadAtlasApi } from './api.ts'
import { payloadToBlob } from './files.ts'
import type { BeadAtlasLocaleKey, Translate } from './locales.ts'
import css from '../../styles/bead-atlas.module.css'

type View = JobFileName | 'grid'

const VIEWS: readonly { file: View; label: BeadAtlasLocaleKey }[] = [
  { file: 'grid', label: 'preview.grid' },
  { file: 'preview.png', label: 'preview.preview' },
  { file: 'pattern.png', label: 'preview.pattern' },
  { file: 'pattern.svg', label: 'preview.svg' },
  { file: 'source', label: 'preview.source' },
]

export interface ImagePreviewProps {
  readonly t: Translate
  readonly api: BeadAtlasApi
  readonly job: JobRecord
  readonly busy: boolean
  readonly onEdits: (edits: GridEdits | null) => void
  readonly onRegenerate: (codes: readonly string[]) => Promise<void>
}

type Loaded = { state: 'loading' } | { state: 'ready'; url: string } | { state: 'failed' }

export function ImagePreview({ t, api, job, busy, onEdits, onRegenerate }: ImagePreviewProps) {
  const [view, setView] = useState<View>('grid')
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })

  // Fetch the selected image from the Host and expose it as a revocable blob URL.
  useEffect(() => {
    const controller = new AbortController()
    let url: string | null = null
    if (view === 'grid') return
    setLoaded({ state: 'loading' })
    void api.getResultFile({ jobId: job.id, name: view }, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (!result.ok) { setLoaded({ state: 'failed' }); return }
      url = URL.createObjectURL(payloadToBlob(result.value))
      setLoaded({ state: 'ready', url })
    })
    return () => {
      controller.abort()
      if (url !== null) URL.revokeObjectURL(url)
    }
  }, [api, job.id, view])

  const label = VIEWS.find(item => item.file === view)?.label ?? 'preview.preview'
  return (
    <div className={css.previewBlock}>
      <div className={css.tabs} role="tablist" aria-label={t('result.title')}>
        {VIEWS.map(item => (
          <button
            key={item.file}
            type="button"
            role="tab"
            aria-selected={item.file === view}
            className={css.tab}
            onClick={() => { setView(item.file) }}
          >
            {t(item.label)}
          </button>
        ))}
      </div>
      {view === 'grid' && (
        <div role="tabpanel" aria-label={t(label)}>
          <BeadGrid t={t} api={api} job={job} busy={busy} onEdits={onEdits} onRegenerate={onRegenerate} />
        </div>
      )}
      {view !== 'grid' && <div className={css.previewFrame} role="tabpanel" aria-label={t(label)} aria-busy={loaded.state === 'loading'}>
        {loaded.state === 'loading' && <p className={css.muted}>{t('preview.loading')}</p>}
        {loaded.state === 'failed' && <p className={css.errorText}>{t('preview.failed')}</p>}
        {loaded.state === 'ready' && (
          <img
            className={css.previewImage}
            data-pixelated={view === 'pattern.png' || view === 'preview.png' || undefined}
            src={loaded.url}
            alt={`${t(label)} · ${job.sourceName}`}
          />
        )}
      </div>}
    </div>
  )
}
