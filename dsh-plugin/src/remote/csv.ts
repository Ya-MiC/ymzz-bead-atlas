/**
 * Minimal RFC 4180 reader for the CSV files convert.py writes with Python's csv
 * module (quoted fields, doubled quotes, CRLF or LF line ends).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const body = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
  for (let index = 0; index < body.length; index++) {
    const char = body[index]
    if (quoted) {
      if (char === '"') {
        if (body[index + 1] === '"') { field += '"'; index++ } else quoted = false
      } else field += char
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') { row.push(field); field = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && body[index + 1] === '\n') index++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += char
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

/** One grid cell from coordinates.csv: the bead code, or null for an empty (no bead) cell. */
export interface GridCell {
  readonly code: string | null
  readonly hex: string | null
}

/**
 * Read coordinates.csv into a row-major grid. Position comes from the row order
 * (convert.py writes one line per cell, row-major), not from the row/column fields.
 * @param text - coordinates.csv content.
 * @param width - grid width from usage.json.
 * @param height - grid height from usage.json.
 * @returns the cells, or null when the file does not match the grid size.
 */
export function parseCoordinates(text: string, width: number, height: number): GridCell[] | null {
  const rows = parseCsv(text)
  const header = rows.shift()
  if (header === undefined) return null
  const codeAt = header.indexOf('code')
  const hexAt = header.indexOf('reference_hex')
  if (codeAt < 0 || hexAt < 0) return null
  const cells = rows.filter(row => row.length > 1).map((row) => {
    const code = row[codeAt] ?? ''
    const hex = row[hexAt] ?? ''
    return code === '' ? { code: null, hex: null } : { code, hex: hex === '' ? null : hex.toUpperCase() }
  })
  return cells.length === width * height ? cells : null
}
