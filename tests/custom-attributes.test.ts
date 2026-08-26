import { describe, expect, it } from 'vitest'
import { findCalendarPeriods, type Hint } from '../src/calendar-hints'
import { makeStubSource, twoWeekSpec } from './helpers/stub-source'

// Attributs personnalisés sur les hints : les résultats référencent les
// objets d'origine (jamais de copie), et le générique H extends Hint propage
// leur type jusque dans hintResults[].hint, groups[].hint et periods[].hints.
const stub = makeStubSource(twoWeekSpec())

interface ColoredHint extends Hint {
  color: string
  meta?: { id: number }
}

describe('custom hint attributes', () => {
  it('returns the original hint object by reference in hintResults and groups', async () => {
    const holidays: ColoredHint = {
      name: 'Jours fériés', policy: 'match-all', days: ['2026-01-07', '2026-01-14'],
      color: '#e33', meta: { id: 42 },
    }
    const result = await findCalendarPeriods(stub, [holidays])
    expect(result.hintResults[0].hint).toBe(holidays)
    expect(result.hintResults[0].hint.color).toBe('#e33') // typé via le générique, pas juste présent au runtime
    expect(result.hintResults[0].groups[0].hint).toBe(holidays)
    expect(result.hintResults[0].groups[0].hint.meta?.id).toBe(42)
  })

  it('lists each contributing hint once per period, leftover groups included', async () => {
    // per-day-of-week sur lundis + mardis : 2 groupes de même signature,
    // fusionnés avec les jeudis/vendredis de la passe finale → 1 période
    const weekdays: ColoredHint = {
      name: 'Semaine', policy: 'per-day-of-week',
      days: ['2026-01-05', '2026-01-06', '2026-01-12', '2026-01-13'],
      color: '#33e',
    }
    const result = await findCalendarPeriods(stub, [weekdays])
    const period = result.periods.find(p => p.hints.length > 0)!
    expect(period.hints).toHaveLength(1) // dédupliqué par identité, pas un par groupe
    expect(period.hints[0]).toBe(weekdays)
    expect(period.labels).toEqual([
      'Semaine — Mondays', 'Semaine — Tuesdays',
      'Remaining days — Thursdays', 'Remaining days — Fridays',
    ])
  })

  it('aggregates several hints on one period, in hint order, by reference', async () => {
    // en trip-content, fériés (H1) et dimanches (S1) partagent la signature
    const holidays: Hint = { name: 'Jours fériés', policy: 'match-all', days: ['2026-01-07', '2026-01-14'] }
    const sundays: Hint = { name: 'Dimanches', policy: 'match-all', days: ['2026-01-11', '2026-01-18'] }
    const result = await findCalendarPeriods(stub, [holidays, sundays], { signatureMode: 'trip-content' })
    const merged = result.periods.find(p => p.hints.length === 2)!
    expect(merged.hints[0]).toBe(holidays)
    expect(merged.hints[1]).toBe(sundays)
    expect(merged.days).toEqual(['2026-01-07', '2026-01-11', '2026-01-14', '2026-01-18'])
  })

  it('excludes the synthetic leftover hint: leftover-only periods have hints: []', async () => {
    const result = await findCalendarPeriods(stub, [])
    expect(result.periods.length).toBeGreaterThan(0)
    for (const p of result.periods) expect(p.hints).toEqual([])
    // le pseudo-hint reste visible sur les groupes de leftoverResult
    expect(result.leftoverResult.groups[0].hint.name).toBe('Remaining days')
  })
})
