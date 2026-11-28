/** Pick or drop one image. Only early feedback here; the Host re-validates everything. */
import { useId, useRef, useState, type DragEvent } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { LIMITS } from '../remote/types.ts'
import { formatBytes } from './format.ts'
import type { Translate } from './locales.ts'
import css from '../../styles/bead-atlas.module.css'

export interface PickedImage {
  readonly file: Blob
  readonly name: string
  readonly bytes: number
  readonly url: string
  readonly width: number | null
  readonly height: number | null
  readonly isGif: boolean
}

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,.png,.jpg,.jpeg,.webp,.gif,.bmp'
const TYPE_PATTERN = /^image\/(png|jpeg|webp|gif|bmp|x-ms-bmp)$/
const NAME_PATTERN = /\.(png|jpe?g|webp|gif|bmp)$/i

export interface ImageUploaderProps {
  readonly t: Translate
  readonly image: PickedImage | null
  readonly disabled: boolean
  readonly onPick: (file: File) => void
  readonly onClear: () => void
  readonly problem: string | null
}

/** Check type and size before reading the file. Returns a message or null. */
export function precheckFile(t: Translate, file: File): string | null {
  if (!TYPE_PATTERN.test(file.type) && !NAME_PATTERN.test(file.name)) return t('upload.badType')
  if (file.size > LIMITS.maxFileBytes) return t('upload.tooLarge', { max: Math.round(LIMITS.maxFileBytes / 1024 / 1024) })
  return null
}

export function ImageUploader({ t, image, disabled, onPick, onClear, problem }: ImageUploaderProps) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const hintId = useId()

  const choose = () => { input.current?.click() }
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (disabled) return
    const file = event.dataTransfer.files[0]
    if (file !== undefined) onPick(file)
  }

  return (
    <section className={css.card} aria-labelledby={`${hintId}-title`}>
      <h2 id={`${hintId}-title`} className={css.cardTitle}>{t('upload.title')}</h2>
      <div
        className={css.dropZone}
        data-dragging={dragging || undefined}
        data-has-image={image !== null || undefined}
        onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true) }}
        onDragLeave={() => { setDragging(false) }}
        onDrop={drop}
      >
        {image === null
          ? (
            <div className={css.dropEmpty}>
              <p className={css.muted} id={hintId}>{dragging ? t('upload.dropHere') : t('upload.formats')}</p>
              <Button variant="primary" onClick={choose} disabled={disabled} aria-describedby={hintId}>{t('upload.choose')}</Button>
            </div>
            )
          : (
            <figure className={css.pickedFigure}>
              <img className={css.pickedImage} src={image.url} alt={image.name} />
              <figcaption className={css.pickedCaption}>
                <span className={css.fileName} title={image.name}>{image.name}</span>
                <span className={css.muted}>
                  {image.width !== null && image.height !== null
                    ? t('upload.meta', { width: image.width, height: image.height, size: formatBytes(image.bytes) })
                    : t('upload.metaNoSize', { size: formatBytes(image.bytes) })}
                </span>
              </figcaption>
            </figure>
            )}
      </div>
      {image?.isGif === true && <p className={css.note}>{t('upload.gifNote')}</p>}
      {problem !== null && <p className={css.errorText} role="alert">{problem}</p>}
      {image !== null && (
        <div className={css.row}>
          <Button variant="outline" size="sm" onClick={choose} disabled={disabled}>{t('upload.replace')}</Button>
          <Button variant="ghost" size="sm" onClick={onClear} disabled={disabled}>{t('upload.clear')}</Button>
        </div>
      )}
      <input
        ref={input}
        className={css.hiddenInput}
        type="file"
        accept={ACCEPT}
        aria-label={t('upload.choose')}
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file !== undefined) onPick(file)
        }}
      />
    </section>
  )
}
