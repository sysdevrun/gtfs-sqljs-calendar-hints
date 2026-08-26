import { describe, expect, it } from 'vitest'
import { findCalendarPeriods, type Hint } from '../src/calendar-hints'
import { makeStubSource, twoWeekSpec, type StubSpec } from './helpers/stub-source'

// Dans le feed de référence, H1 (fériés) et S1 (dimanches) ont le même contenu
// horaire sous des trip_id différents : trip-content les fusionne (3 périodes
// au lieu de 4). Chaque test ci-dessous fait varier UNE dimension du contenu
// pour vérifier que la fusion ne survit qu'à l'identité exacte.
const HOLIDAYS: Hint = { name: 'Jours fériés', policy: 'match-all', days: ['2026-01-07', '2026-01-14'] }

async function periodCount(spec: StubSpec): Promise<number> {
  const result = await findCalendarPeriods(makeStubSource(spec), [HOLIDAYS], { signatureMode: 'trip-content' })
  return result.periods.length
}

describe('trip-content signature mode', () => {
  it('does not merge identical times on a different route', async () => {
    const spec = twoWeekSpec()
    spec.trips.H1.route = 'R2'
    expect(await periodCount(spec)).toBe(4) // comme en trip-ids
  })

  it('does not merge identical times with a different direction', async () => {
    const spec = twoWeekSpec()
    spec.trips.H1.direction = 1
    expect(await periodCount(spec)).toBe(4)
  })

  it('treats a null direction consistently, but null ≠ 0', async () => {
    const bothNull = twoWeekSpec()
    bothNull.trips.S1.direction = null
    bothNull.trips.H1.direction = null
    expect(await periodCount(bothNull)).toBe(3) // fusionnés

    const mixed = twoWeekSpec()
    mixed.trips.H1.direction = null // S1 garde direction 0
    expect(await periodCount(mixed)).toBe(4)
  })

  it('is insensitive to the delivery order of stop_times (sorted by stop_sequence)', async () => {
    const spec = twoWeekSpec()
    spec.trips.S1.stops = [['Y', '09:30:00', undefined, 2], ['X', '09:00:00', undefined, 1]]
    expect(await periodCount(spec)).toBe(3) // toujours fusionnés avec H1
  })

  it('handles null arrival/departure times (interpolated stops)', async () => {
    const spec = twoWeekSpec()
    spec.trips.S1.stops = [['X', null, null], ['Y', '09:30:00']]
    spec.trips.H1.stops = [['X', null, null], ['Y', '09:30:00']]
    expect(await periodCount(spec)).toBe(3) // contenus toujours identiques → fusionnés
  })

  it('merges trips without any stop_times when route and direction are equal', async () => {
    const spec: StubSpec = {
      range: { start: '20260105', end: '20260118' },
      calendars: { SAT: '0000010', SUN: '0000001' },
      trips: { NA: { service: 'SAT' }, NB: { service: 'SUN' } },
    }
    // lun-ven fermés (0 trips) = 1 période fusionnée de 10 jours
    const tripIds = await findCalendarPeriods(makeStubSource(spec), [])
    expect(tripIds.periods).toHaveLength(3) // fermés, samedis (NA), dimanches (NB)

    const content = await findCalendarPeriods(makeStubSource(spec), [], { signatureMode: 'trip-content' })
    expect(content.periods).toHaveLength(2) // NA ≡ NB : samedis + dimanches fusionnés
    const weekend = content.periods.find(p => p.tripCount === 1)
    expect(weekend?.days).toEqual(['2026-01-10', '2026-01-11', '2026-01-17', '2026-01-18'])
  })
})
