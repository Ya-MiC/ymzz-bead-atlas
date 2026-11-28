/** Browser-side file helpers: reading a picked file, decoding results, and saving downloads. */
import type { ResultFilePayload } from '../remote/types.ts'

/** Read a File as base64 (without the data: prefix). */
export async function fileToBase64(file: Blob): Promise<string> {
  const reader = new FileReader()
  const done = new Promise<string>((resolve, reject) => {
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      const comma = text.indexOf(',')
      resolve(comma >= 0 ? text.slice(comma + 1) : '')
    }
    reader.onerror = () => { reject(reader.error ?? new Error('read failed')) }
  })
  reader.readAsDataURL(file)
  return await done
}

/** Turn a result payload into a Blob. */
export function payloadToBlob(payload: ResultFilePayload): Blob {
  const binary = atob(payload.dataBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: payload.mediaType })
}

/** Decode a text result (CSV, Markdown, JSON) as UTF-8. */
export function payloadToText(payload: ResultFilePayload): string {
  const binary = atob(payload.dataBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return new TextDecoder('utf-8').decode(bytes)
}

/** Save a Blob through a temporary anchor; the browser decides the download location. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => { URL.revokeObjectURL(url) }, 30_000)
}

/** Read pixel dimensions of a picked image in the browser, or null when the browser cannot decode it. */
export async function imageSize(file: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      const size = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      return size
    } catch {
      return null
    }
  }
  return null
}
