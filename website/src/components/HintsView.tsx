import { useState } from 'react'
import type { GeneratedHints } from '../hints'

export default function HintsView({ generated }: { generated: GeneratedHints }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="hints-view">
      <button className="link-button" onClick={() => setOpen(o => !o)}>
        {open ? '▾' : '▸'} Hints générés : {generated.holidays.length} jours fériés,{' '}
        {generated.vacationRanges.length} périodes de vacances scolaires
      </button>
      {open && (
        <div className="hints-detail">
          <h3>Jours fériés</h3>
          <ul>
            {generated.holidays.map(h => (
              <li key={h.date}><code>{h.date}</code> — {h.name}</li>
            ))}
          </ul>
          <h3>Vacances scolaires (jours lundi-vendredi retenus)</h3>
          <ul>
            {generated.vacationRanges.map(v => (
              <li key={v.label + v.first}>{v.label} : <code>{v.first}</code> → <code>{v.last}</code></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
