/** Recent jobs with view, regenerate, and confirmed delete. */
import { useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { JobRecord, JobStatus } from '../remote/types.ts'
import { formatTime } from './format.ts'
import type { BeadAtlasLocaleKey, Translate } from './locales.ts'
import css from '../../styles/bead-atlas.module.css'

export interface JobHistoryProps {
  readonly t: Translate
  readonly jobs: readonly JobRecord[] | null
  readonly selectedId: string | null
  readonly busy: boolean
  readonly onView: (job: JobRecord) => void
  readonly onRegenerate: (job: JobRecord) => void
  readonly onDelete: (job: JobRecord) => Promise<void>
  readonly onRefresh: () => void
}

export function statusKey(status: JobStatus): BeadAtlasLocaleKey {
  return `status.${status}` as BeadAtlasLocaleKey
}

export function JobHistory({ t, jobs, selectedId, busy, onView, onRegenerate, onDelete, onRefresh }: JobHistoryProps) {
  const [pending, setPending] = useState<JobRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  const confirm = async () => {
    if (pending === null) return
    setDeleting(true)
    await onDelete(pending)
    setDeleting(false)
    setPending(null)
  }

  return (
    <section className={css.card} aria-labelledby="bead-atlas-history-title">
      <div className={css.cardHeader}>
        <h2 id="bead-atlas-history-title" className={css.cardTitle}>{t('history.title')}</h2>
        <Button variant="ghost" size="sm" onClick={onRefresh}>{t('history.refresh')}</Button>
      </div>
      {jobs === null && <p className={css.muted}>{t('history.loading')}</p>}
      {jobs !== null && jobs.length === 0 && <p className={css.muted}>{t('history.empty')}</p>}
      {jobs !== null && jobs.length > 0 && (
        <ul className={css.historyList}>
          {jobs.map(job => (
            <li key={job.id} className={css.historyItem} data-selected={job.id === selectedId || undefined}>
              <div className={css.historyMain}>
                <span className={css.fileName} title={job.sourceName}>{job.sourceName}</span>
                <span className={css.muted}>
                  {formatTime(job.createdAt)}
                  {' · '}
                  {job.summary?.brand ?? job.settings.brand}
                  {job.summary !== null && ` · ${t('result.gridValue', { width: job.summary.gridWidth, height: job.summary.gridHeight })}`}
                  {' · '}
                  {`${job.files.length}/7`}
                </span>
                <code className={css.jobId}>{job.id}</code>
              </div>
              <span className={css.status} data-status={job.status}>{t(statusKey(job.status))}</span>
              <div className={css.historyActions}>
                <Button variant="outline" size="sm" onClick={() => { onView(job) }} aria-label={`${t('history.view')} ${job.id}`}>{t('history.view')}</Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => { onRegenerate(job) }} aria-label={`${t('history.regenerate')} ${job.id}`}>{t('history.regenerate')}</Button>
                <Button variant="ghost" size="sm" disabled={busy && job.status === 'running'} onClick={() => { setPending(job) }} aria-label={`${t('history.delete')} ${job.id}`}>{t('history.delete')}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={pending !== null}
        onClose={() => { if (!deleting) setPending(null) }}
        title={t('delete.title')}
        tone="warning"
        closeLabel={t('delete.close')}
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setPending(null) }} disabled={deleting}>{t('delete.cancel')}</Button>
            <Button variant="primary" onClick={() => { void confirm() }} disabled={deleting} data-modal-autofocus>{t('delete.confirm')}</Button>
          </>
        )}
      >
        {pending !== null && <p>{t('delete.body', { id: pending.id, count: pending.files.length })}</p>}
      </Modal>
    </section>
  )
}
