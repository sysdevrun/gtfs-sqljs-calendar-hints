import { describe, expect, it } from 'vitest'
import { findCalendarPeriods, weekdayOf, type Hint } from '../src/calendar-hints'
import { eachDay, makeStubSource } from './helpers/stub-source'

// 4 semaines (2026-01-05 → 2026-02-01). Le samedi 2026-01-24 reçoit un trip
// supplémentaire E1 (service EXTRA, exception type 1) : tous les autres jours
// de semaine sont réguliers, les samedis ne le sont pas.
const stub = makeStubSource({
  range: { start: '20260105', end: '20260201' },
  calendars: { WD: '1111100', SAT: '0000010', SUN: '0000001' },
  calendarDates: [['EXTRA', '20260124', 1]],
  trips: {
    T1: { service: 'WD' },
    T2: { service: 'WD' },
    A1: { service: 'SAT' },
    S1: { service: 'SUN' },
    E1: { service: 'EXTRA' },
  },
})

const ALL_DAYS = eachDay('2026-01-05', '2026-02-01')
const SATURDAYS = ['2026-01-10', '2026-01-17', '2026-01-24', '2026-01-31']
const WEEK_HINT: Hint = { name: 'Semaine', policy: 'per-day-of-week', days: ALL_DAYS }

describe('per-day-of-week policy', () => {
  it('groups each weekday separately, Monday→Sunday, skipping the mismatched one', async () => {
    const result = await findCalendarPeriods(stub, [WEEK_HINT])
    const [r] = result.hintResults
    expect(r.matched).toBe(true)
    expect(r.groups.map(g => g.label)).toEqual([
      'Semaine — Mondays', 'Semaine — Tuesdays', 'Semaine — Wednesdays',
      'Semaine — Thursdays', 'Semaine — Fridays', 'Semaine — Sundays',
    ])
    expect(r.groups.map(g => g.weekday)).toEqual([1, 2, 3, 4, 5, 0])
    expect(r.groups[0].days).toEqual(['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'])
  })

  it('reports the mismatching weekday with its concrete days', async () => {
    const result = await findCalendarPeriods(stub, [WEEK_HINT])
    const [m] = result.hintResults[0].mismatches
    expect(m.weekday).toBe(6)
    expect(m.message).toMatch(/^Saturdays: 2 distinct signatures/)
    // le plus grand groupe d'abord : les 3 samedis normaux face au samedi dévié
    expect(m.dayA).toBe('2026-01-10')
    expect(m.dayB).toBe('2026-01-24')
    expect(m.tripsOnlyInA).toBe(0)
    expect(m.tripsOnlyInB).toBe(1) // E1
  })

  it('consumes only the matched weekdays', async () => {
    const result = await findCalendarPeriods(stub, [WEEK_HINT])
    // seuls les samedis restent pour la passe finale, qui échoue à son tour
    expect([...result.leftoverResult.hint.days].sort()).toEqual(SATURDAYS)
    expect(result.leftoverResult.matched).toBe(false)
    expect(result.unclassified).toHaveLength(2)
    expect(result.unclassified[0].days).toEqual(['2026-01-10', '2026-01-17', '2026-01-31'])
    expect(result.unclassified[1].days).toEqual(['2026-01-24'])
  })

  it('a hint restricted to some weekdays leaves the others untouched', async () => {
    const mondays = ALL_DAYS.filter(d => weekdayOf(d) === 1)
    const result = await findCalendarPeriods(stub, [{ name: 'Lundis', policy: 'per-day-of-week', days: mondays }])
    expect(result.hintResults[0].groups).toHaveLength(1)
    expect(result.leftoverResult.hint.days).toHaveLength(ALL_DAYS.length - mondays.length)
  })

  it('is not matched when no weekday group matches', async () => {
    const result = await findCalendarPeriods(stub, [{ name: 'Samedis', policy: 'per-day-of-week', days: SATURDAYS }])
    const [r] = result.hintResults
    expect(r.matched).toBe(false)
    expect(r.groups).toHaveLength(0)
    expect(r.mismatches).toHaveLength(1)
  })
})
