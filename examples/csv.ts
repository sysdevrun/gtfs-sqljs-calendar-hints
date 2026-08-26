import { readFileSync } from 'node:fs'

// Petit parseur CSV, suffisant pour du GTFS : quotes, CRLF, BOM.
// Générateur pour ne pas matérialiser les gros fichiers (stop_times.txt).
export function* iterCsv(path: string): Generator<Record<string, string>> {
  const text = readFileSync(path, 'utf8')
  let header: string[] | undefined
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i <= text.length; i++) {
    const c = i < text.length ? text[i] : '\n' // flush de la dernière ligne
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') inQuotes = false
      else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') {
        if (!header) header = row
        else yield Object.fromEntries(header.map((h, k) => [h, row[k] ?? '']))
      }
      row = []
    } else {
      field += c
    }
  }
}

export const parseCsv = (path: string) => [...iterCsv(path)]
