import { useMemo, useState } from 'react'
import { highlight, languages } from 'prismjs'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-json'
import type { CalendarHintsOptions, CalendarHintsResult } from '../../../src/calendar-hints'
import type { GeneratedHints } from '../hints'
import { buildCallSnippet, prettyJson } from '../snippets'

// La coloration (et le DOM qu'elle produit — le résultat JSON peut faire
// plusieurs centaines de ko) n'est calculée qu'à l'ouverture du bloc.
function CodeBlock({ summary, code, language }: {
  summary: string
  code: string
  language: 'typescript' | 'json'
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const html = useMemo(
    () => (open ? highlight(code, languages[language], language) : ''),
    [open, code, language],
  )
  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <details className="code-details" onToggle={e => setOpen(e.currentTarget.open)}>
      <summary>
        {summary} <span className="muted small">({code.split('\n').length.toLocaleString('fr-FR')} lignes)</span>
      </summary>
      {open && (
        <div className="code-wrapper">
          <button className="code-copy" onClick={copy}>{copied ? '✔ copié' : 'copier'}</button>
          <pre className="code-block"><code dangerouslySetInnerHTML={{ __html: html }} /></pre>
        </div>
      )}
    </details>
  )
}

export default function CodeSnippets({ generated, options, result, feedLabel }: {
  generated: GeneratedHints
  options: CalendarHintsOptions
  result: CalendarHintsResult
  feedLabel: string
}) {
  const callCode = useMemo(
    () => buildCallSnippet(generated.hints, options, feedLabel),
    [generated, options, feedLabel],
  )
  const resultCode = useMemo(() => prettyJson(result) + '\n', [result])
  return (
    <section className="card">
      <h2>Sous le capot</h2>
      <p className="muted">
        L'appel à <a href="https://www.npmjs.com/package/gtfs-sqljs-calendar-hints">gtfs-sqljs-calendar-hints</a>{' '}
        exactement tel qu'exécuté par cette analyse — hints et options compris — et le résultat
        brut qu'il a renvoyé.
      </p>
      <CodeBlock summary="Appel de la librairie (TypeScript)" code={callCode} language="typescript" />
      <CodeBlock summary="Résultat de l'analyse (JSON)" code={resultCode} language="json" />
    </section>
  )
}
