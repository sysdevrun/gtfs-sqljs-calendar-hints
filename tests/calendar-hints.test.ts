import { describe, expect, it } from 'vitest'
import { findCalendarPeriods, type Hint } from '../src/calendar-hints'
import { makeStubSource, twoWeekSpec } from './helpers/stub-source'

// Feed synthétique de 2 semaines (2026-01-05 → 2026-01-18), via un stub
// GtfsCalendarSource — le typage structurel rend gtfs-sqljs inutile en test.
// Voir twoWeekSpec() pour le détail des services.
const stub = makeStubSource(twoWeekSpec())

const HOLIDAYS_HINT: Hint = { name: 'Jours fériés', policy: 'match-all', days: ['2026-01-07', '2026-01-14', '2026-06-01'] }

describe('findCalendarPeriods', () => {
  it('computes the feed range from calendars and type-1 exceptions', async () => {
    const result = await findCalendarPeriods(stub, [])
    expect(result.firstDay).toBe('2026-01-05')
    expect(result.lastDay).toBe('2026-01-18')
    expect(result.days).toHaveLength(14)
  })

  it('matches a match-all hint and ignores out-of-range days', async () => {
    const result = await findCalendarPeriods(stub, [HOLIDAYS_HINT])
    const [holidays] = result.hintResults
    expect(holidays.matched).toBe(true)
    expect(holidays.inScopeDays).toEqual(['2026-01-07', '2026-01-14'])
    expect(holidays.ignoredDays).toEqual(['2026-06-01'])
    expect(holidays.groups[0].days).toEqual(['2026-01-07', '2026-01-14'])
    expect(holidays.groups[0].serviceIds).toEqual(['HOL'])
  })

  it('reports a structured mismatch with two concrete differing days', async () => {
    const bad: Hint = { name: 'Mauvais hint', policy: 'match-all', days: ['2026-01-05', '2026-01-10'] }
    const result = await findCalendarPeriods(stub, [bad])
    const [r] = result.hintResults
    expect(r.matched).toBe(false)
    const [m] = r.mismatches
    expect(m.signatureCounts).toHaveLength(2)
    expect([m.dayA, m.dayB].sort()).toEqual(['2026-01-05', '2026-01-10'])
    expect(m.tripsOnlyInA + m.tripsOnlyInB).toBe(3) // {T1,T2} vs {A1}
    expect(m.message).toContain('2026-01-05')
    // un hint raté ne consomme aucun jour
    expect(result.days).toHaveLength(14)
    expect(result.unclassified.reduce((n, g) => n + g.days.length, 0)).toBe(0) // passe finale complète
  })

  it('classifies everything: leftover per-day-of-week pass and merged periods (trip-ids)', async () => {
    const result = await findCalendarPeriods(stub, [HOLIDAYS_HINT])
    expect(result.unclassified).toHaveLength(0)
    // lun/mar/jeu/ven fusionnés (mêmes trips), + samedis, + dimanches, + fériés
    expect(result.periods).toHaveLength(4)
    const weekdays = result.periods.find(p => p.labels.length === 4)
    expect(weekdays?.days).toHaveLength(8)
    // en trip-ids, fériés (H1) ≠ dimanches (S1)
    const holidays = result.periods.find(p => p.labels[0] === 'Jours fériés')
    expect(holidays?.days).toEqual(['2026-01-07', '2026-01-14'])
  })

  it('merges holidays with Sundays in trip-content mode (same schedule, different trip ids)', async () => {
    const result = await findCalendarPeriods(stub, [HOLIDAYS_HINT], { signatureMode: 'trip-content' })
    expect(result.unclassified).toHaveLength(0)
    expect(result.periods).toHaveLength(3)
    const sundaysAndHolidays = result.periods.find(p => p.labels.includes('Jours fériés'))
    expect(sundaysAndHolidays?.days).toEqual(['2026-01-07', '2026-01-11', '2026-01-14', '2026-01-18'])
  })

  it('clips the analysed range via firstDay/lastDay options', async () => {
    const result = await findCalendarPeriods(stub, [], { firstDay: '2026-01-12', lastDay: '2026-01-14' })
    expect(result.firstDay).toBe('2026-01-12')
    expect(result.lastDay).toBe('2026-01-14')
    expect(result.days).toHaveLength(3)
  })
})
