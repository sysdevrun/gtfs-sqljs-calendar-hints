import { describe, expect, it } from 'vitest'
import { findCalendarPeriods, type Hint } from '../src/calendar-hints'
import { eachDay, makeStubSource, twoWeekSpec, type StubSpec, type StubTrip } from './helpers/stub-source'

const stub = makeStubSource(twoWeekSpec())
const HOLIDAYS: Hint = { name: 'Jours fériés', policy: 'match-all', days: ['2026-01-07', '2026-01-14'] }

// Variante du feed de référence où les mercredis sont simplement fermés :
// WD retiré par type 2, rien ajouté (0 trips ces jours-là).
function closedWednesdaysSpec(): StubSpec {
  const spec = twoWeekSpec()
  spec.calendarDates = [['WD', '20260107', 2], ['WD', '20260114', 2]]
  return spec
}

describe('hint ordering and cascading', () => {
  it('days consumed by an earlier hint land in ignoredDays', async () => {
    const vacances: Hint = { name: 'Vacances', policy: 'match-all', days: ['2026-01-07', '2026-01-08'] }
    const result = await findCalendarPeriods(stub, [HOLIDAYS, vacances])
    const [, r] = result.hintResults
    expect(r.ignoredDays).toEqual(['2026-01-07']) // consommé par le hint fériés
    expect(r.inScopeDays).toEqual(['2026-01-08'])
    expect(r.matched).toBe(true)
  })

  it('a failed hint consumes nothing: a later hint can still match its days', async () => {
    const bad: Hint = { name: 'Mauvais', policy: 'match-all', days: ['2026-01-05', '2026-01-10'] }
    const saturdays: Hint = { name: 'Samedis', policy: 'match-all', days: ['2026-01-10', '2026-01-17'] }
    const result = await findCalendarPeriods(stub, [bad, saturdays])
    expect(result.hintResults[0].matched).toBe(false)
    expect(result.hintResults[1].inScopeDays).toEqual(['2026-01-10', '2026-01-17'])
    expect(result.hintResults[1].matched).toBe(true)
  })
})

describe('non-canonical hint days', () => {
  it('deduplicates and sorts the hint days', async () => {
    const messy: Hint = { name: 'Désordonné', policy: 'match-all', days: ['2026-01-14', '2026-01-07', '2026-01-07'] }
    const result = await findCalendarPeriods(stub, [messy])
    const [r] = result.hintResults
    expect(r.inScopeDays).toEqual(['2026-01-07', '2026-01-14'])
    expect(r.matched).toBe(true)
  })

  it('a hint entirely out of range is neither matched nor a mismatch', async () => {
    const outside: Hint = { name: 'Hors plage', policy: 'match-all', days: ['2025-12-25', '2026-06-01'] }
    const result = await findCalendarPeriods(stub, [outside])
    const [r] = result.hintResults
    expect(r.matched).toBe(false)
    expect(r.inScopeDays).toEqual([])
    expect(r.ignoredDays).toEqual(['2025-12-25', '2026-06-01'])
    expect(r.groups).toHaveLength(0)
    expect(r.mismatches).toHaveLength(0)
  })
})

describe('days with zero trips (network closed)', () => {
  it('a closed day appears with 0 trips, no services, and the 0t signature', async () => {
    const closed = makeStubSource(closedWednesdaysSpec())
    const result = await findCalendarPeriods(closed, [{ name: 'Mixte', policy: 'match-all', days: ['2026-01-05', '2026-01-07'] }])
    const day = result.days.find(d => d.date === '2026-01-07')
    expect(day?.tripCount).toBe(0)
    expect(day?.serviceIds).toEqual([])
    expect(day?.signature).toMatch(/^0t:/)
    const [m] = result.hintResults[0].mismatches
    expect(m.message).toContain('(0 trips, services none)')
    expect(m.tripsOnlyInA).toBe(2)
    expect(m.tripsOnlyInB).toBe(0)
  })

  it('names the closed side correctly when the largest group is the closed one', async () => {
    const closed = makeStubSource(closedWednesdaysSpec())
    const hint: Hint = { name: 'Mixte', policy: 'match-all', days: ['2026-01-05', '2026-01-07', '2026-01-14'] }
    const result = await findCalendarPeriods(closed, [hint])
    const [m] = result.hintResults[0].mismatches
    expect(m.dayA).toBe('2026-01-07') // le groupe fermé (2 jours) passe en premier
    expect(m.message).toContain('e.g. 2026-01-07 (0 trips, services none)')
  })

  it('identical closed days group into a single 0-trip period', async () => {
    const closed = makeStubSource(closedWednesdaysSpec())
    const result = await findCalendarPeriods(closed, [])
    const period = result.periods.find(p => p.tripCount === 0)
    expect(period?.days).toEqual(['2026-01-07', '2026-01-14'])
    expect(period?.serviceIds).toEqual([])
  })
})

describe('services without trips', () => {
  it('an active service with no trips changes nothing to signatures or counts', async () => {
    const spec = twoWeekSpec()
    spec.calendars!.GHOST = '1111111' // présent dans calendar.txt, absent de trips.txt
    const stubWithGhost = makeStubSource(spec)
    const bad: Hint = { name: 'Mauvais', policy: 'match-all', days: ['2026-01-05', '2026-01-10'] }
    const result = await findCalendarPeriods(stubWithGhost, [bad, HOLIDAYS])
    const monday = result.days.find(d => d.date === '2026-01-05')
    expect(monday?.serviceIds).toEqual(['GHOST', 'WD'])
    expect(monday?.tripCount).toBe(2) // GHOST ne compte pas
    expect(result.hintResults[0].matched).toBe(false) // le mismatch traverse aussi les jours GHOST
    expect(result.periods).toHaveLength(4) // classification inchangée
  })
})

describe('feeds without calendar.txt (dates-only)', () => {
  it('derives the range from type-1 exceptions and classifies normally', async () => {
    const datesOnly = makeStubSource({
      calendarDates: [
        ['D1', '20260105', 1], ['D1', '20260106', 1], ['D1', '20260107', 1],
        ['D1', '20260108', 1], ['D1', '20260109', 1],
        ['D2', '20260110', 1],
      ],
      trips: { T1: { service: 'D1' }, A1: { service: 'D2' } },
    })
    const result = await findCalendarPeriods(datesOnly, [])
    expect(result.firstDay).toBe('2026-01-05')
    expect(result.lastDay).toBe('2026-01-10')
    expect(result.days).toHaveLength(6)
    expect(result.unclassified).toHaveLength(0)
    expect(result.periods.map(p => p.days.length).sort()).toEqual([1, 5])
  })
})

describe('errors', () => {
  it('throws when no range can be derived (no calendar, no type-1 dates)', async () => {
    const empty = makeStubSource({ calendarDates: [['X', '20260105', 2]], trips: { T1: { service: 'X' } } })
    await expect(findCalendarPeriods(empty, [])).rejects.toThrow(/cannot determine the feed date range/)
  })

  it('throws when the clipping options empty the range', async () => {
    await expect(findCalendarPeriods(stub, [], { firstDay: '2027-01-01' })).rejects.toThrow(/empty analysed range/)
  })
})

describe('mismatch details', () => {
  it('lists at most 6 signature groups in the message, largest first', async () => {
    // 8 signatures distinctes : S1..S8 avec 1..8 trips ; S1 actif un second
    // jour pour que le plus grand groupe compte 2 jours.
    const trips: Record<string, StubTrip> = {}
    const calendarDates: [string, string, 1 | 2][] = []
    for (let i = 1; i <= 8; i++) {
      calendarDates.push([`S${i}`, `202601${String(4 + i).padStart(2, '0')}`, 1])
      for (let j = 1; j <= i; j++) trips[`T${i}_${j}`] = { service: `S${i}` }
    }
    calendarDates.push(['S1', '20260113', 1])
    const many = makeStubSource({ calendarDates, trips })

    const hint: Hint = { name: 'Tout', policy: 'match-all', days: eachDay('2026-01-05', '2026-01-13') }
    const result = await findCalendarPeriods(many, [hint])
    const [m] = result.hintResults[0].mismatches
    expect(m.signatureCounts).toHaveLength(8)
    expect(m.signatureCounts[0]).toMatchObject({ dayCount: 2, exampleDay: '2026-01-05' })
    expect(m.dayA).toBe('2026-01-05')
    expect(m.message).toContain('8 distinct signatures')
    expect(m.message).toContain('… 2 more')
  })
})

describe('global invariants', () => {
  it('periods and unclassified groups partition the analysed days exactly, deterministically', async () => {
    const hints: Hint[] = [{ name: 'Mauvais', policy: 'match-all', days: ['2026-01-05', '2026-01-10'] }, HOLIDAYS]
    const result = await findCalendarPeriods(stub, hints)
    const classified = [
      ...result.periods.flatMap(p => p.days),
      ...result.unclassified.flatMap(g => g.days),
    ].sort()
    expect(classified).toEqual(result.days.map(d => d.date))

    const again = await findCalendarPeriods(stub, hints)
    expect(again).toEqual(result)
  })
})
