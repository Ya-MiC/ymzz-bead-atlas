/** Test fixtures: a real Python with Pillow, generated images, and fake interpreters. */
import { chmodSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

export const ENGINE_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/** Python with Pillow: BEAD_ATLAS_TEST_PYTHON, else python3 on PATH. */
export const TEST_PYTHON = process.env.BEAD_ATLAS_TEST_PYTHON ?? 'python3'
export const HAS_CONFIGURED_PYTHON = process.env.BEAD_ATLAS_TEST_PYTHON !== undefined && existsSync(process.env.BEAD_ATLAS_TEST_PYTHON)

/** Temporary directory whose name contains CJK characters and spaces. */
export function tempDir(label = '拼豆 測試'): string {
  return mkdtempSync(join(tmpdir(), `${label} `))
}

function crc32(buffer: Buffer): number {
  let crc = ~0
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** A real RGB PNG with a colour gradient. */
export function gradientPng(width = 64, height = 48): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const rows: Buffer[] = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3)
    for (let x = 0; x < width; x++) {
      row[1 + x * 3] = Math.round((x / width) * 255)
      row[2 + x * 3] = Math.round((y / height) * 255)
      row[3 + x * 3] = 128
    }
    rows.push(row)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** A PNG whose header claims the given size but has no pixel data. */
export function headerOnlyPng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * A fake `python3` that answers the environment probe with a chosen version
 * and Pillow state. It is a POSIX shell script; used only to simulate
 * environments this machine does not have.
 */
export function fakePython(dir: string, version: [number, number, number], pillow: string | null): string {
  const path = join(dir, 'python3')
  const payload = JSON.stringify({ version, pillow })
  writeFileSync(path, `#!/bin/sh\necho '${payload}'\n`)
  chmodSync(path, 0o755)
  return path
}
