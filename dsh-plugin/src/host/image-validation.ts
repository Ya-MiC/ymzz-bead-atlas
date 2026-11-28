/**
 * Validate uploaded image bytes before anything touches disk: the declared
 * size, the real format from the file signature (not the name or MIME), and
 * the pixel dimensions read from the header. The Python engine still decodes
 * the full image afterwards; this check only bounds what it is given.
 */
import { LIMITS, type ImageFormat } from '../remote/types.ts'
import { RequestFailure } from './errors.ts'

export interface ImageFacts {
  readonly format: ImageFormat
  readonly width: number
  readonly height: number
  readonly bytes: number
}

export interface ImageLimits {
  readonly maxFileBytes: number
  readonly maxPixels: number
  readonly maxEdgePx: number
}

const DEFAULT_LIMITS: ImageLimits = {
  maxFileBytes: LIMITS.maxFileBytes,
  maxPixels: LIMITS.maxPixels,
  maxEdgePx: LIMITS.maxEdgePx,
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/**
 * Decode base64 text with an upper bound checked before decoding.
 * @param text - base64 payload from the Client.
 * @param maxBytes - largest decoded size accepted.
 * @returns the decoded bytes.
 */
export function decodeBase64(text: unknown, maxBytes: number = DEFAULT_LIMITS.maxFileBytes): Buffer {
  if (typeof text !== 'string' || text.length === 0 || text.length % 4 !== 0 || !BASE64.test(text)) {
    throw new RequestFailure('bead-atlas/bad-request', 'image data is not base64 text', {})
  }
  const estimated = (text.length / 4) * 3
  if (estimated - 2 > maxBytes) {
    throw new RequestFailure('bead-atlas/file-too-large', 'image file exceeds the size limit', { maxBytes })
  }
  const bytes = Buffer.from(text, 'base64')
  if (bytes.length > maxBytes) {
    throw new RequestFailure('bead-atlas/file-too-large', 'image file exceeds the size limit', { maxBytes })
  }
  return bytes
}

function pngSize(b: Buffer): [number, number] | null {
  if (b.length < 24 || b.toString('latin1', 12, 16) !== 'IHDR') return null
  return [b.readUInt32BE(16), b.readUInt32BE(20)]
}

function gifSize(b: Buffer): [number, number] | null {
  if (b.length < 10) return null
  return [b.readUInt16LE(6), b.readUInt16LE(8)]
}

function bmpSize(b: Buffer): [number, number] | null {
  if (b.length < 26) return null
  const header = b.readUInt32LE(14)
  if (header === 12) return [b.readUInt16LE(18), b.readUInt16LE(20)]
  if (header < 40) return null
  return [Math.abs(b.readInt32LE(18)), Math.abs(b.readInt32LE(22))]
}

function webpSize(b: Buffer): [number, number] | null {
  if (b.length < 30) return null
  const chunk = b.toString('latin1', 12, 16)
  if (chunk === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null
    return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null
    const bits = b.readUInt32LE(21)
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1]
  }
  if (chunk === 'VP8X') {
    return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)]
  }
  return null
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

function jpegSize(b: Buffer): [number, number] | null {
  let offset = 2
  while (offset + 4 <= b.length) {
    if (b[offset] !== 0xff) return null
    const marker = b[offset + 1] as number
    if (marker === 0xff) { offset += 1; continue }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue }
    if (marker === 0xd9 || marker === 0xda) return null
    const length = b.readUInt16BE(offset + 2)
    if (length < 2) return null
    if (SOF.has(marker)) {
      if (offset + 9 > b.length) return null
      return [b.readUInt16BE(offset + 7), b.readUInt16BE(offset + 5)]
    }
    offset += 2 + length
  }
  return null
}

/**
 * Identify the format from the file signature.
 * @param b - file bytes.
 * @returns the accepted format, or null.
 */
export function sniffFormat(b: Buffer): ImageFormat | null {
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  if (b.length >= 6 && (b.toString('latin1', 0, 6) === 'GIF87a' || b.toString('latin1', 0, 6) === 'GIF89a')) return 'gif'
  if (b.length >= 2 && b.toString('latin1', 0, 2) === 'BM') return 'bmp'
  return null
}

/**
 * Check the uploaded image and read its dimensions.
 * @param bytes - decoded file bytes.
 * @param limits - size and pixel bounds.
 * @returns format, dimensions and byte length.
 */
export function inspectImage(bytes: Buffer, limits: ImageLimits = DEFAULT_LIMITS): ImageFacts {
  if (bytes.length > limits.maxFileBytes) {
    throw new RequestFailure('bead-atlas/file-too-large', 'image file exceeds the size limit', { maxBytes: limits.maxFileBytes })
  }
  const format = sniffFormat(bytes)
  if (format === null) {
    throw new RequestFailure('bead-atlas/unsupported-format', 'file is not a PNG, JPEG, WebP, GIF, or BMP image', {})
  }
  const size = format === 'png' ? pngSize(bytes)
    : format === 'jpeg' ? jpegSize(bytes)
      : format === 'webp' ? webpSize(bytes)
        : format === 'gif' ? gifSize(bytes)
          : bmpSize(bytes)
  if (size === null || size[0] < 1 || size[1] < 1) {
    throw new RequestFailure('bead-atlas/unsupported-format', 'image header could not be read', { format })
  }
  const [width, height] = size
  if (width > limits.maxEdgePx || height > limits.maxEdgePx || width * height > limits.maxPixels) {
    throw new RequestFailure('bead-atlas/image-too-large', 'image dimensions exceed the pixel limit', {
      width, height, maxPixels: limits.maxPixels, maxEdgePx: limits.maxEdgePx,
    })
  }
  return { format, width, height, bytes: bytes.length }
}

/** File extension the stored copy of each format uses. */
export const FORMAT_EXTENSION: Record<ImageFormat, string> = {
  png: 'png', jpeg: 'jpg', webp: 'webp', gif: 'gif', bmp: 'bmp',
}

/**
 * Make an uploaded file name safe to display. The name is never used to build a path.
 * @param name - name the browser reported.
 * @returns a short single-line label.
 */
export function displayName(name: unknown): string {
  if (typeof name !== 'string') return 'image'
  const base = name.split(/[\\/]/).pop() ?? ''
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return clean.length === 0 ? 'image' : clean.slice(0, 120)
}
