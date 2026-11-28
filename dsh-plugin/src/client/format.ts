/** Small display helpers shared by the Client components. */
import type { RequestError } from '../remote/types.ts'
import type { BeadAtlasLocaleKey, Translate } from './locales.ts'

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

export function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

/** Sentence for a request error. Transport errors (gateway/*) get a generic line with their code. */
export function errorText(t: Translate, error: RequestError): string {
  const key = `error.${error.code}` as BeadAtlasLocaleKey
  const params: Record<string, string | number> = { message: error.message, code: error.code }
  for (const [name, value] of Object.entries(error.details)) {
    if (typeof value === 'string' || typeof value === 'number') params[name] = value
  }
  if (!error.code.startsWith('bead-atlas/')) return t('error.transport', params)
  const text = t(key, params)
  return text === key ? t('error.bead-atlas/internal', params) : text
}
