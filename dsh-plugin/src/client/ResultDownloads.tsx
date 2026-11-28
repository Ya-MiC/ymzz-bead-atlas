/** Download buttons for the seven engine outputs. Each file is fetched from the Host and saved by the browser. */
import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { RESULT_FILES, type JobRecord, type ResultFileName } from '../remote/types.ts'
import type { BeadAtlasApi } from './api.ts'
import { payloadToBlob, saveBlob } from './files.ts'
import type { BeadAtlasLocaleKey, Translate } from './locales.ts'
import css from '../../styles/bead-atlas.module.css'

export interface ResultDownloadsProps {
  readonly t: Translate
  readonly api: BeadAtlasApi
  readonly job: JobRecord
}

/** Download name: job id prefix keeps files from different jobs apart in one folder. */
export function downloadName(job: JobRecord, file: ResultFileName): string {
  return `${job.id}-${file}`
}

export function ResultDownloads({ t, api, job }: ResultDownloadsProps) {
  const [busy, setBusy] = useState<ResultFileName | null>(null)
  const [failed, setFailed] = useState<ResultFileName | null>(null)

  const download = async (file: ResultFileName) => {
    setBusy(file)
    setFailed(null)
    const result = await api.getResultFile({ jobId: job.id, name: file })
    setBusy(null)
    if (!result.ok) { setFailed(file); return }
    saveBlob(payloadToBlob(result.value), downloadName(job, file))
  }

  return (
    <section className={css.downloads} aria-label={t('downloads.title')}>
      <h3 className={css.cardTitle}>{t('downloads.title')}</h3>
      <ul className={css.downloadList}>
        {RESULT_FILES.filter(file => job.files.includes(file)).map((file) => {
          const name = t(`file.${file}` as BeadAtlasLocaleKey)
          return (
            <li key={file}>
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                aria-label={t('downloads.download', { name })}
                onClick={() => { void download(file) }}
              >
                {name}
              </Button>
            </li>
          )
        })}
      </ul>
      {failed !== null && <p className={css.errorText} role="alert">{t('downloads.failed', { name: t(`file.${failed}` as BeadAtlasLocaleKey) })}</p>}
    </section>
  )
}
