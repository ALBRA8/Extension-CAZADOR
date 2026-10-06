import type { FieldDefinition } from '@/types'

/** Trigger a browser download from a Blob. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Sanitize a string for CSV (RFC 4180 quoting). */
function csvEscape(value: string): string {
  if (value == null) return ''
  const s = String(value)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function safeFilename(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'cazador'
}

/** Export rows to CSV (Excel-compatible with UTF-8 BOM). */
export function exportCsv(
  rows: Record<string, string>[],
  fields: FieldDefinition[],
  title: string,
): void {
  const header = fields.map((f) => csvEscape(f.name)).join(',')
  const lines = rows.map((row) =>
    fields.map((f) => csvEscape(row[f.id] ?? '')).join(','),
  )
  // Prepend BOM so Excel detects UTF-8 correctly.
  const csv = '\ufeff' + [header, ...lines].join('\r\n')
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${safeFilename(title)}.csv`)
}

/**
 * Export rows to a real .xlsx file.
 *
 * We generate a minimal XLSX (Office Open XML SpreadsheetML) without any
 * external dependency. It produces a valid workbook readable by Excel,
 * Numbers and Google Sheets.
 */
export function exportXlsx(
  rows: Record<string, string>[],
  fields: FieldDefinition[],
  title: string,
): void {
  // Build the sheet XML.
  const cells = [
    // Header row
    ...fields.map((f, i) => cellXml(i, 1, f.name, 'string')),
    // Data rows
    ...rows.flatMap((row, r) =>
      fields.map((f, c) => cellXml(c, r + 2, row[f.id] ?? '', 'string')),
    ),
  ].join('')

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${cells}</sheetData>
</worksheet>`

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Hoja1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`

  // Minimal XLSX zip — we assemble it manually using a ZIP store (no compression)
  // because all major spreadsheet readers accept uncompressed entries.
  const files: { name: string; content: Uint8Array }[] = [
    { name: '[Content_Types].xml', content: enc(contentTypesXml) },
    { name: '_rels/.rels', content: enc(rootRelsXml) },
    { name: 'xl/workbook.xml', content: enc(workbookXml) },
    { name: 'xl/_rels/workbook.xml.rels', content: enc(workbookRelsXml) },
    { name: 'xl/worksheets/sheet1.xml', content: enc(sheetXml) },
  ]

  const zipBlob = buildZip(files)
  triggerDownload(zipBlob, `${safeFilename(title)}.xlsx`)
}

// ─── XLSX parts ──────────────────────────────────────────────────────────────
const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`

const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`

function cellXml(col: number, row: number, value: string, type: 'string' | 'number'): string {
  const ref = colToLetter(col) + row
  const v = xmlEscape(String(value ?? ''))
  if (type === 'number' && v !== '') {
    return `<c r="${ref}" t="n"><v>${v}</v></c>`
  }
  return `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`
}

function colToLetter(n: number): string {
  let s = ''
  n = n + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

// ─── Minimal ZIP writer (store, no compression) ──────────────────────────────
function crc32(bytes: Uint8Array): number {
  let c = ~0
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i]
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
  }
  return ~c >>> 0
}

function buildZip(files: { name: string; content: Uint8Array }[]): Blob {
  const enc = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const f of files) {
    const nameBytes = enc.encode(f.name)
    const crc = crc32(f.content)
    const size = f.content.length

    // Local file header (30 bytes + name)
    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true) // signature
    lh.setUint16(4, 20, true) // version
    lh.setUint16(6, 0, true) // flags
    lh.setUint16(8, 0, true) // method = store
    lh.setUint16(10, 0, true) // time
    lh.setUint16(12, 0, true) // date
    lh.setUint32(14, crc, true)
    lh.setUint32(18, size, true) // compressed size
    lh.setUint32(22, size, true) // uncompressed size
    lh.setUint16(26, nameBytes.length, true)
    lh.setUint16(28, 0, true) // extra len

    localParts.push(new Uint8Array(lh.buffer), nameBytes, f.content)

    // Central directory header (46 bytes + name)
    const ch = new DataView(new ArrayBuffer(46))
    ch.setUint32(0, 0x02014b50, true)
    ch.setUint16(4, 20, true) // version made by
    ch.setUint16(6, 20, true) // version needed
    ch.setUint16(8, 0, true)
    ch.setUint16(10, 0, true) // method
    ch.setUint16(12, 0, true)
    ch.setUint16(14, 0, true)
    ch.setUint32(16, crc, true)
    ch.setUint32(20, size, true)
    ch.setUint32(24, size, true)
    ch.setUint16(28, nameBytes.length, true)
    ch.setUint16(30, 0, true) // extra
    ch.setUint16(32, 0, true) // comment
    ch.setUint16(34, 0, true) // disk
    ch.setUint16(36, 0, true) // int attrs
    ch.setUint32(38, 0, true) // ext attrs
    ch.setUint32(42, offset, true) // local header offset

    centralParts.push(new Uint8Array(ch.buffer), nameBytes)

    offset += 30 + nameBytes.length + size
  }

  const centralBytes = concat(centralParts)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(4, 0, true)
  end.setUint16(6, 0, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, centralBytes.length, true)
  end.setUint32(16, offset, true)
  end.setUint16(20, 0, true)

  return new Blob(
    [...localParts, centralBytes, new Uint8Array(end.buffer)] as BlobPart[],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  )
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let i = 0
  for (const p of parts) {
    out.set(p, i)
    i += p.length
  }
  return out
}
