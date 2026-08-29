import { useMemo } from 'react'
import type { CalendarHintsResult, HintResult, Period } from '../../../src/calendar-hints'
import { buildDayTypes, dayTypeBackground, frLabel, periodLabel, type DayTypeStyle } from '../day-types'
import { eachDay, type GeneratedHints } from '../hints'
import CalendarGrid from './CalendarGrid'

const WEEKDAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const weekdayOf = (iso: string) => new Date(iso + 'T00:00:00Z').getUTCDay()

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

function PeriodCard({ period, style }: { period: Period; style: DayTypeStyle }) {
  return (
    <div className="period-card" style={{ borderLeftColor: style.color }}>
      <div className="period-labels">
        <span className="day-type-swatch" style={{ background: dayTypeBackground(style) }} />
        {periodLabel(period.labels)}
      </div>
      <div className="muted">
        {period.days.length} jours ({period.days[0]} → {period.days[period.days.length - 1]}) —{' '}
        {period.tripCount.toLocaleString('fr-FR')} courses — services {servicesLabel(period.serviceIds)}
      </div>
    </div>
  )
}

export default function ResultsView({ result, generated }: {
  result: CalendarHintsResult
  generated: GeneratedHints
}) {
  // Périodes dans l'ordre des hints (puis des jours restants), pas par taille
  const orderedPeriods = useMemo(() => {
    const order = new Map<string, number>()
    let i = 0
    for (const r of [...result.hintResults, result.leftoverResult]) {
      for (const g of r.groups) {
        if (!order.has(g.signature)) order.set(g.signature, i++)
      }
    }
    return [...result.periods].sort(
      (a, b) => (order.get(a.signature) ?? Infinity) - (order.get(b.signature) ?? Infinity),
    )
  }, [result])
  // Un type de jour par signature : les périodes d'abord (mêmes couleurs que
  // les cartes ci-dessous), puis les signatures restées non classées.
  const dayTypes = useMemo(() => buildDayTypes(result, orderedPeriods), [result, orderedPeriods])
  const unclassifiedCount = result.unclassified.reduce((n, g) => n + g.days.length, 0)
  const holidays = useMemo(() => new Set(generated.holidays.map(h => h.date)), [generated])
  // Tous les jours des périodes de vacances, dimanches exclus
  const vacationDays = useMemo(
    () =>
      new Set(
        generated.vacationRanges
          .flatMap(v => eachDay(v.first, v.last))
          .filter(d => weekdayOf(d) !== 0),
      ),
    [generated],
  )

  return (
    <>
      <section className="card">
        <h2>Synthèse des périodes</h2>
        <p className="muted">
          Plage analysée : <code>{result.firstDay}</code> → <code>{result.lastDay}</code>{' '}
          ({result.days.length} jours, {dayTypes.list.length} signatures distinctes,{' '}
          {unclassifiedCount} jour{unclassifiedCount > 1 ? 's' : ''} non classé{unclassifiedCount > 1 ? 's' : ''})
        </p>
        <div className="period-list">
          {orderedPeriods.map(p => (
            <PeriodCard key={p.signature} period={p} style={dayTypes.bySignature.get(p.signature)!.style} />
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Calendrier</h2>
        <p className="muted">
          Chaque jour est peint selon son <strong>type de jour</strong> : deux jours qui font
          tourner exactement les mêmes courses partagent la même couleur et le même motif —
          y compris les jours qu'aucun hint n'a classés, entourés de pointillés.
          Les jours de <u>vacances scolaires</u> (hors dimanche) sont soulignés, les jours
          fériés marqués d'un astérisque*.
        </p>
        <CalendarGrid result={result} dayTypes={dayTypes} holidays={holidays} vacationDays={vacationDays} />
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
                <span
                  className="day-type-swatch day-type-swatch-unclassified"
                  style={{ background: dayTypeBackground(dayTypes.bySignature.get(g.signature)!.style) }}
                />{' '}
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
