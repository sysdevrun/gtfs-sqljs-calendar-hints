import { describe, expect, it } from 'vitest'
import { findCalendarPeriods, type GtfsCalendarSource } from '../src/calendar-hints'

// Feed synthétique de 2 semaines (2026-01-05 → 2026-01-18), via un stub
// GtfsCalendarSource — le typage structurel rend gtfs-sqljs inutile en test.
//
// - WD  (lun-ven)  : trips T1, T2
// - SAT (samedi)   : trip A1
// - SUN (dimanche) : trip S1
// - HOL (fériés)   : trip H1, actif uniquement par exceptions type 1 les
//   mercredis 2026-01-07 et 2026-01-14 (où WD est retiré par type 2).
//   H1 a exactement le même contenu horaire que S1 (ids différents).

const CALENDARS = {
  WD: { monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 0, sunday: 0 },
  SAT: { monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 1, sunday: 0 },
  SUN: { monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 0, sunday: 1 },
} as const

const CALENDAR_DATES = [
  { service_id: 'WD', date: '20260107', exception_type: 2 },
  { service_id: 'HOL', date: '20260107', exception_type: 1 },
  { service_id: 'WD', date: '20260114', exception_type: 2 },
  { service_id: 'HOL', date: '20260114', exception_type: 1 },
]

const TRIPS = [
  { trip_id: 'T1', service_id: 'WD', route_id: 'R1', direction_id: 0 },
  { trip_id: 'T2', service_id: 'WD', route_id: 'R1', direction_id: 1 },
  { trip_id: 'A1', service_id: 'SAT', route_id: 'R1', direction_id: 0 },
  { trip_id: 'S1', service_id: 'SUN', route_id: 'R1', direction_id: 0 },
  { trip_id: 'H1', service_id: 'HOL', route_id: 'R1', direction_id: 0 },
]

const STOP_TIMES: Record<string, { stop_id: string; arrival_time: string; departure_time: string; stop_sequence: number }[]> = {
  T1: [
    { stop_id: 'X', arrival_time: '08:00:00', departure_time: '08:00:00', stop_sequence: 1 },
    { stop_id: 'Y', arrival_time: '08:30:00', departure_time: '08:31:00', stop_sequence: 2 },
  ],
  T2: [
    { stop_id: 'Y', arrival_time: '17:00:00', departure_time: '17:00:00', stop_sequence: 1 },
    { stop_id: 'X', arrival_time: '17:30:00', departure_time: '17:30:00', stop_sequence: 2 },
  ],
  A1: [
    { stop_id: 'X', arrival_time: '10:00:00', departure_time: '10:00:00', stop_sequence: 1 },
    { stop_id: 'Y', arrival_time: '10:30:00', departure_time: '10:30:00', stop_sequence: 2 },
  ],
  // S1 et H1 : même contenu exact, trip_id différents
  S1: [
    { stop_id: 'X', arrival_time: '09:00:00', departure_time: '09:00:00', stop_sequence: 1 },
    { stop_id: 'Y', arrival_time: '09:30:00', departure_time: '09:30:00', stop_sequence: 2 },
  ],
  H1: [
    { stop_id: 'X', arrival_time: '09:00:00', departure_time: '09:00:00', stop_sequence: 1 },
    { stop_id: 'Y', arrival_time: '09:30:00', departure_time: '09:30:00', stop_sequence: 2 },
  ],
}

const WEEKDAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
const RANGE = { start_date: '20260105', end_date: '20260118' }

const stub: GtfsCalendarSource = {
  async getTrips() {
    return TRIPS
  },
  async getCalendarByServiceId(serviceId) {
    const weekdays = CALENDARS[serviceId as keyof typeof CALENDARS]
    return weekdays ? { service_id: serviceId, ...weekdays, ...RANGE } : null
  },
  async getCalendarDates(serviceId) {
    return CALENDAR_DATES.filter(e => e.service_id === serviceId)
  },
  async getActiveServiceIds(date) {
    const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
    const weekdayKey = WEEKDAY_KEYS[new Date(iso + 'T00:00:00Z').getUTCDay()]
    const active = new Set(
      Object.entries(CALENDARS)
        .filter(([, w]) => w[weekdayKey] === 1 && RANGE.start_date <= date && date <= RANGE.end_date)
        .map(([id]) => id),
    )
    for (const e of CALENDAR_DATES.filter(e => e.date === date)) {
      if (e.exception_type === 1) active.add(e.service_id)
      else active.delete(e.service_id)
    }
    return [...active]
  },
  async getStopTimes(filters) {
    const wanted = new Set(Array.isArray(filters?.tripId) ? filters.tripId : filters?.tripId ? [filters.tripId] : Object.keys(STOP_TIMES))
    return Object.entries(STOP_TIMES)
      .filter(([tripId]) => wanted.has(tripId))
      .flatMap(([tripId, stops]) => stops.map(s => ({ trip_id: tripId, ...s })))
  },
}

const HOLIDAYS_HINT = { name: 'Jours fériés', policy: 'match-all' as const, days: ['2026-01-07', '2026-01-14', '2026-06-01'] }

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
    const bad = { name: 'Mauvais hint', policy: 'match-all' as const, days: ['2026-01-05', '2026-01-10'] }
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
