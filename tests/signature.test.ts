import { describe, expect, it } from 'vitest'
import { findCalendarPeriods, weekdayOf } from '../src/calendar-hints'
import { makeStubSource, type StubSpec } from './helpers/stub-source'

describe('weekdayOf', () => {
  it('uses the JS convention: 0=Sunday … 6=Saturday, computed in UTC', () => {
    expect(weekdayOf('2026-01-04')).toBe(0) // dimanche
    expect(weekdayOf('2026-01-05')).toBe(1) // lundi
    expect(weekdayOf('2026-01-10')).toBe(6) // samedi
  })
})

// Les signatures apparaissent dans les résultats exportés (DayInfo, Period,
// Mismatch) : leur format et le hash sous-jacent ne doivent pas changer
// silencieusement entre versions. Valeurs golden figées.
describe('signature stability', () => {
  const spec: StubSpec = {
    range: { start: '20260105', end: '20260111' },
    calendars: { WD: '1111100' },
    trips: { T1: { service: 'WD', stops: [['X', '08:00:00'], ['Y', '08:30:00']] } },
  }

  it('a day with no service has the empty signature', async () => {
    const result = await findCalendarPeriods(makeStubSource(spec), [])
    const sunday = result.days.find(d => d.date === '2026-01-11')
    expect(sunday?.signature).toBe('0t:000015050000cde7')
  })

  it('trip-ids signatures are stable', async () => {
    const result = await findCalendarPeriods(makeStubSource(spec), [])
    expect(result.days[0].signature).toBe('1t:005974200304fa84')
  })

  it('trip-content signatures are stable', async () => {
    const result = await findCalendarPeriods(makeStubSource(spec), [], { signatureMode: 'trip-content' })
    expect(result.days[0].signature).toBe('1t:6bfb55e1c4ee5737')
  })
})
