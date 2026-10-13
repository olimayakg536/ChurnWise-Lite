// Small CSV reader/writer (handles quotes, commas in fields, CRLF, and a BOM).

export function parseCSV(text) {
  const clean = text.replace(/^﻿/, '')
  const records = []
  let field = ''
  let record = []
  let inQuotes = false

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      record.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++
      record.push(field)
      field = ''
      records.push(record)
      record = []
    } else {
      field += ch
    }
  }
  if (field !== '' || record.length > 0) {
    record.push(field)
    records.push(record)
  }

  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ''))
  if (nonEmpty.length < 2) throw new Error('The CSV needs a header row and at least one data row.')

  const headers = nonEmpty[0].map((h) => h.trim())
  const rows = nonEmpty.slice(1).map((r) => {
    const obj = {}
    headers.forEach((h, i) => {
      obj[h] = (r[i] ?? '').trim()
    })
    return obj
  })
  return { headers, rows }
}

// Spreadsheet apps can run text that starts with = + - @ as a formula, so text cells get a leading apostrophe.
function escapeCell(value) {
  if (value === null || value === undefined) return ''
  let s = String(value)
  if (typeof value === 'string' && /^[=+\-@]/.test(s)) s = "'" + s
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
  return s
}

export function toCSV(columns, rows) {
  const header = columns.map((c) => escapeCell(c.label)).join(',')
  const lines = rows.map((row) => columns.map((c) => escapeCell(row[c.key])).join(','))
  return [header, ...lines].join('\n') + '\n'
}

export function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
