// Génération des extraits de code affichés sous les résultats : l'appel réel
// à la librairie (hints et options effectivement passés au worker) et son
// résultat brut. Le JSON.stringify standard mettrait chaque date sur sa
// propre ligne — `prettyJson` replie les tableaux de primitives pour rester
// lisible sans rien omettre.
import type { CalendarHintsOptions, Hint } from '../../src/calendar-hints'

const WIDTH = 120
const isPrimitive = (v: unknown) => v === null || typeof v !== 'object'
const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/

export type SnippetStyle = 'json' | 'ts'

/** Sérialisation JSON indentée, tableaux et petits objets repliés en ligne.
 *  En style `ts`, les clés-identifiants perdent leurs guillemets (les valeurs
 *  restent sérialisées en JSON, valide en TypeScript). */
export function prettyJson(value: unknown, style: SnippetStyle = 'json', indent = ''): string {
  const key = (k: string) => (style === 'ts' && IDENTIFIER_RE.test(k) ? k : JSON.stringify(k))
  if (isPrimitive(value)) return JSON.stringify(value)
  const inner = indent + '  '

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    if (value.every(isPrimitive)) {
      const items = value.map(v => JSON.stringify(v))
      const oneLine = `[${items.join(', ')}]`
      if (indent.length + oneLine.length <= WIDTH) return oneLine
      // Repli : autant d'éléments que possible par ligne, sans virgule finale
      const lines: string[] = []
      let line = ''
      for (const item of items) {
        const candidate = line === '' ? item : `${line}, ${item}`
        if (line !== '' && inner.length + candidate.length + 1 > WIDTH) {
          lines.push(line + ',')
          line = item
        } else {
          line = candidate
        }
      }
      lines.push(line)
      return `[\n${lines.map(l => inner + l).join('\n')}\n${indent}]`
    }
    const items = value.map(v => inner + prettyJson(v, style, inner))
    return `[\n${items.join(',\n')}\n${indent}]`
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return '{}'
  const parts = entries.map(([k, v]) => `${key(k)}: ${prettyJson(v, style, inner)}`)
  if (parts.every(p => !p.includes('\n'))) {
    const oneLine = `{ ${parts.join(', ')} }`
    if (indent.length + oneLine.length <= WIDTH) return oneLine
  }
  return `{\n${parts.map(p => inner + p).join(',\n')}\n${indent}}`
}

/** L'appel à `findCalendarPeriods` tel qu'exécuté par la démo, hints et
 *  options réels inclus, sous forme de programme TypeScript complet. */
export function buildCallSnippet(hints: Hint[], options: CalendarHintsOptions, feedLabel: string): string {
  return `import { GtfsSqlJs } from 'gtfs-sqljs'
import { createSqlJsAdapter } from 'gtfs-sqljs/adapters/sql-js'
import { findCalendarPeriods, type Hint } from 'gtfs-sqljs-calendar-hints'

// Chargement du feed (ici « ${feedLabel} »), une seule fois
const gtfs = await GtfsSqlJs.fromZip(gtfsUrl, { adapter: await createSqlJsAdapter() })

// Hints tels que générés par la démo (jours fériés, vacances scolaires…)
const hints: Hint[] = ${prettyJson(hints, 'ts')}

const result = await findCalendarPeriods(gtfs, hints, ${prettyJson(options, 'ts')})
`
}
