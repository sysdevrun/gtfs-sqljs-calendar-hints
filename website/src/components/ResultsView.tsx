import { useMemo } from 'react'
import type { CalendarHintsResult, HintResult, Period } from '../../../src/calendar-hints'
import CalendarGrid from './CalendarGrid'

const WEEKDAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const weekdayOf = (iso: string) => new Date(iso + 'T00:00:00Z').getUTCDay()

// Palette stable pour colorer les périodes (calendrier + cartes)
export const PERIOD_COLORS = [
  '#2563eb', '#16a34a', '#ea580c', '#9333ea', '#0891b2', '#ca8a04',
  '#dc2626', '#4f46e5', '#059669', '#d97706', '#db2777', '#65a30d',
]

// La librairie produit des libellés en anglais ; on les traduit à l'affichage
const LABEL_FR: [string, string][] = [
  ['Remaining days', 'Jours restants'],
  ['Mondays', 'lundis'],
  ['Tuesdays', 'mardis'],
  ['Wednesdays', 'mercredis'],
  ['Thursdays', 'jeudis'],
  ['Fridays', 'vendredis'],
  ['Saturdays', 'samedis'],
  ['Sundays', 'dimanches'],
]

export function frLabel(label: string): string {
  return LABEL_FR.reduce((s, [en, fr]) => s.replaceAll(en, fr), label)
}

function formatDays(days: string[]): string {
  if (days.length <= 10) return days.join(', ')
  return `${days.length} jours (${days[0]} → ${days[days.length - 1]})`
}

function servicesLabel(services: string[]): string {
  if (services.length === 0) return 'aucun'
  if (services.length <= 4) return services.join(' + ')
  return `${services.slice(0, 4).join(' + ')} +${services.length - 4} autres`
}

function HintResultView({ r }: { r: HintResult }) {
  return (
    <div className={`hint-result ${r.matched ? 'hint-matched' : r.mismatches.length > 0 ? 'hint-failed' : ''}`}>
      <div className="hint-result-header">
        <span className={`badge ${r.matched ? 'badge-ok' : r.mismatches.length > 0 ? 'badge-ko' : 'badge-neutral'}`}>
          {r.matched ? '✔ matché' : r.mismatches.length > 0 ? '✘ non matché' : '— sans objet'}
        </span>
        <strong>{frLabel(r.hint.name)}</strong>
        <span className="muted">
          ({r.hint.policy}, {r.hint.days.length} jours fournis, {r.inScopeDays.length} examinés
          {r.ignoredDays.length > 0 ? `, ${r.ignoredDays.length} hors plage ou déjà consommés` : ''})
        </span>
      </div>
      {r.groups.map(g => (
        <div key={g.label} className="hint-group">
          ✔ <strong>{frLabel(g.label)}</strong> : {g.days.length} j., {g.tripCount.toLocaleString('fr-FR')} courses,
          services {servicesLabel(g.serviceIds)}
          <div className="muted small">{formatDays(g.days)}</div>
        </div>
      ))}
      {r.mismatches.map((m, i) => (
        <div key={i} className="hint-mismatch">✘ {m.message}</div>
      ))}
    </div>
  )
}

function PeriodCard({ period, color }: { period: Period; color: string }) {
  return (
    <div className="period-card" style={{ borderLeftColor: color }}>
      <div className="period-labels">{period.labels.map(frLabel).join(' + ')}</div>
      <div className="muted">
        {period.days.length} jours ({period.days[0]} → {period.days[period.days.length - 1]}) —{' '}
        {period.tripCount.toLocaleString('fr-FR')} courses — services {servicesLabel(period.serviceIds)}
      </div>
    </div>
  )
}

export default function ResultsView({ result }: { result: CalendarHintsResult }) {
  const distinctSignatures = useMemo(
    () => new Set(result.days.map(d => d.signature)).size,
    [result],
  )
  const unclassifiedCount = result.unclassified.reduce((n, g) => n + g.days.length, 0)

  return (
    <>
      <section className="card">
        <h2>Synthèse des périodes</h2>
        <p className="muted">
          Plage analysée : <code>{result.firstDay}</code> → <code>{result.lastDay}</code>{' '}
          ({result.days.length} jours, {distinctSignatures} signatures distinctes,{' '}
          {unclassifiedCount} jour{unclassifiedCount > 1 ? 's' : ''} non classé{unclassifiedCount > 1 ? 's' : ''})
        </p>
        <div className="period-list">
          {result.periods.map((p, i) => (
            <PeriodCard key={p.signature} period={p} color={PERIOD_COLORS[i % PERIOD_COLORS.length]} />
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Calendrier</h2>
        <p className="muted">Chaque jour est coloré selon sa période ; les jours non classés sont hachurés.</p>
        <CalendarGrid result={result} colors={PERIOD_COLORS} />
      </section>

      <section className="card">
        <h2>Détail des hints</h2>
        {[...result.hintResults, result.leftoverResult].map((r, i) => (
          <HintResultView key={i} r={r} />
        ))}
      </section>

      {result.unclassified.length > 0 && (
        <section className="card">
          <h2>Jours non classés</h2>
          {result.unclassified.map(g => {
            const weekdays = [...new Set(g.days.map(d => WEEKDAYS_FR[weekdayOf(d)]))].join(', ')
            return (
              <div key={g.signature} className="hint-mismatch">
                <code>[{g.signature}]</code> {g.days.length} j. ({weekdays}),{' '}
                {g.tripCount.toLocaleString('fr-FR')} courses, services {servicesLabel(g.serviceIds)}
                <div className="muted small">{formatDays(g.days)}</div>
              </div>
            )
          })}
        </section>
      )}
    </>
  )
}
