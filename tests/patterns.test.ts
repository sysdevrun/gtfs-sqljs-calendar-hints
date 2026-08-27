import { describe, expect, it } from 'vitest'
import { detectDayPatterns, findCalendarPeriods } from '../src/calendar-hints'
import { eachDay, makeStubSource, twoWeekSpec, type StubSpec } from './helpers/stub-source'

const patternsOf = async (spec: StubSpec, options = {}) =>
  detectDayPatterns((await findCalendarPeriods(makeStubSource(spec), [], options)).days)

describe('detectDayPatterns', () => {
  it('returns no pattern for an empty day list', () => {
    expect(detectDayPatterns([])).toEqual([])
  })

  it('describes the reference two-week feed without any hint (trip-ids)', async () => {
    const patterns = await patternsOf(twoWeekSpec())

    // Largest group first, ties broken by first day
    expect(patterns.map(p => p.label)).toEqual([
      'Mondays to Tuesdays, Thursdays to Fridays', // WD minus the two exception Wednesdays
      'Wednesdays', // HOL
      'Saturdays', // SAT
      'Sundays', // SUN
    ])
    expect(patterns.every(p => p.kind === 'full-range' && p.missingDays.length === 0 && p.missingRanges.length === 0)).toBe(true)

    const wd = patterns[0]
    expect(wd.days).toEqual([
      '2026-01-05', '2026-01-06', '2026-01-08', '2026-01-09',
      '2026-01-12', '2026-01-13', '2026-01-15', '2026-01-16',
    ])
    expect(wd.weekdays).toEqual([1, 2, 4, 5]) // Monday first
    expect(wd.tripCount).toBe(2)
    expect(wd.serviceIds).toEqual(['WD'])
    expect(wd.firstDay).toBe('2026-01-05')
    expect(wd.lastDay).toBe('2026-01-16')
  })

  it('merges holidays into the Sunday group in trip-content mode', async () => {
    const patterns = await patternsOf(twoWeekSpec(), { signatureMode: 'trip-content' })

    // H1 (holiday Wednesdays) has the same content as S1 (Sundays)
    const sundayLike = patterns.find(p => p.days.includes('2026-01-11'))!
    expect(sundayLike.days).toEqual(['2026-01-07', '2026-01-11', '2026-01-14', '2026-01-18'])
    expect(sundayLike.weekdays).toEqual([3, 0])
    expect(sundayLike.kind).toBe('full-range')
    expect(sundayLike.label).toBe('Wednesdays, Sundays')
  })

  it('labels a group covering all seven weekdays "Every day"', async () => {
    const spec: StubSpec = {
      range: { start: '20260105', end: '20260118' },
      calendars: { ALL: '1111111' },
      trips: { T1: { service: 'ALL' } },
    }
    const patterns = await patternsOf(spec)
    expect(patterns).toHaveLength(1)
    expect(patterns[0].label).toBe('Every day')
    expect(patterns[0].weekdays).toEqual([1, 2, 3, 4, 5, 6, 0])
  })

  it('detects a weekday service confined to a sub-range as a span', async () => {
    // Two Mon-Fri services on consecutive fortnights, built from type-1
    // exceptions only (the stub shares a single calendar range)
    const isWeekend = (d: string) => ['2026-01-10', '2026-01-11', '2026-01-24', '2026-01-25'].includes(d)
    const week1And2 = eachDay('2026-01-05', '2026-01-16').filter(d => !isWeekend(d))
    const week3And4 = eachDay('2026-01-19', '2026-01-30').filter(d => !isWeekend(d))
    const spec: StubSpec = {
      calendarDates: [
        ...week1And2.map(d => ['A', d.replaceAll('-', ''), 1] as [string, string, 1]),
        ...week3And4.map(d => ['B', d.replaceAll('-', ''), 1] as [string, string, 1]),
      ],
      trips: { TA: { service: 'A' }, TB: { service: 'B' } },
    }
    const patterns = await patternsOf(spec)

    const a = patterns.find(p => p.serviceIds.includes('A'))!
    expect(a.kind).toBe('span')
    expect(a.label).toBe('Mondays to Fridays from 2026-01-05 to 2026-01-16')
    const b = patterns.find(p => p.serviceIds.includes('B'))!
    expect(b.kind).toBe('span')
    expect(b.label).toBe('Mondays to Fridays from 2026-01-19 to 2026-01-30')

    // The tripless weekends in between form the empty-signature group,
    // covering every Saturday and Sunday of the analysed range
    const weekends = patterns.find(p => p.tripCount === 0)!
    expect(weekends.kind).toBe('full-range')
    expect(weekends.label).toBe('Saturdays to Sundays')
    expect(weekends.days).toEqual(['2026-01-10', '2026-01-11', '2026-01-17', '2026-01-18', '2026-01-24', '2026-01-25'])
  })

  it('reports gaps as exceptions, with consecutive missing days collapsed into ranges', async () => {
    // Three Mon-Fri weeks; Tuesday+Wednesday of week 1 and Thursday of week 3
    // are removed (no replacement service)
    const spec: StubSpec = {
      range: { start: '20260105', end: '20260123' },
      calendars: { WD: '1111100' },
      calendarDates: [
        ['WD', '20260106', 2],
        ['WD', '20260107', 2],
        ['WD', '20260122', 2],
      ],
      trips: { T1: { service: 'WD' } },
    }
    const patterns = await patternsOf(spec)

    const wd = patterns[0]
    expect(wd.kind).toBe('span-with-exceptions')
    expect(wd.label).toBe('Mondays to Fridays from 2026-01-05 to 2026-01-23 except 3 days')
    expect(wd.missingDays).toEqual(['2026-01-06', '2026-01-07', '2026-01-22'])
    expect(wd.missingRanges).toEqual([
      { firstDay: '2026-01-06', lastDay: '2026-01-07' },
      { firstDay: '2026-01-22', lastDay: '2026-01-22' },
    ])

    // The removed days share the empty signature with the tripless weekends;
    // the gaps of that combined group are the days its weekday set (Tue, Wed,
    // Thu, Sat, Sun) *does* run — consecutive within the weekday set, so
    // Tue+Wed+Thu of a normal week collapse into one range
    const off = patterns.find(p => p.tripCount === 0)!
    expect(off.days).toEqual([
      '2026-01-06', '2026-01-07', '2026-01-10', '2026-01-11',
      '2026-01-17', '2026-01-18', '2026-01-22',
    ])
    expect(off.kind).toBe('span-with-exceptions')
    expect(off.label).toBe('Tuesdays to Thursdays, Saturdays to Sundays from 2026-01-06 to 2026-01-22 except 6 days')
    expect(off.missingDays).toEqual([
      '2026-01-08', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-20', '2026-01-21',
    ])
    expect(off.missingRanges).toEqual([
      { firstDay: '2026-01-08', lastDay: '2026-01-08' },
      { firstDay: '2026-01-13', lastDay: '2026-01-15' },
      { firstDay: '2026-01-20', lastDay: '2026-01-21' },
    ])
  })

  it('uses the singular for a single missing day and the date as label for a single-day group', async () => {
    // Two Mon-Fri weeks; an extra service X joins WD on Thursday 2026-01-08,
    // giving that day a unique signature
    const spec: StubSpec = {
      range: { start: '20260105', end: '20260116' },
      calendars: { WD: '1111100' },
      calendarDates: [['X', '20260108', 1]],
      trips: { T1: { service: 'WD' }, TX: { service: 'X' } },
    }
    const patterns = await patternsOf(spec)

    expect(patterns[0].label).toBe('Mondays to Fridays from 2026-01-05 to 2026-01-16 except 1 day')
    expect(patterns[0].missingRanges).toEqual([{ firstDay: '2026-01-08', lastDay: '2026-01-08' }])

    const special = patterns.find(p => p.days.length === 1)!
    expect(special.serviceIds).toEqual(['WD', 'X'])
    expect(special.kind).toBe('span')
    expect(special.label).toBe('2026-01-08')
  })
})
