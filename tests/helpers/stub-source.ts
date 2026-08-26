import type { GtfsCalendarSource } from '../../src/calendar-hints'

export interface StubTrip {
  service: string
  route?: string
  direction?: number | null
  /** [stop_id, arrival_time, departure_time?, stop_sequence?] — departure = arrival et sequence = position par défaut */
  stops?: [string, string | null, (string | null)?, number?][]
}

export interface StubSpec {
  /** service_id → masque de 7 caractères, lundi en premier ('1111100' = lun-ven), actif sur `range` */
  calendars?: Record<string, string>
  /** Plage commune des entrées calendar, dates GTFS (YYYYMMDD) */
  range?: { start: string; end: string }
  /** [service_id, date GTFS, exception_type] */
  calendarDates?: [string, string, 1 | 2][]
  /** trip_id → trip (route 'R1' et direction 0 par défaut) */
  trips: Record<string, StubTrip>
  /** Lignes feed_info — expose getFeedInfo() seulement si présent */
  feedInfo?: { feed_start_date?: string; feed_end_date?: string }[]
  /** [trip_id, start_time, end_time, headway_secs, exact_times?] — expose getFrequencies() seulement si présent */
  frequencies?: [string, string, string, number, number?][]
}

/** Construit un GtfsCalendarSource en mémoire à partir d'une description déclarative du feed. */
export function makeStubSource(spec: StubSpec): GtfsCalendarSource {
  const calendars = spec.calendars ?? {}
  const calendarDates = spec.calendarDates ?? []
  const range = spec.range

  return {
    async getTrips() {
      return Object.entries(spec.trips).map(([tripId, t]) => ({
        trip_id: tripId,
        service_id: t.service,
        route_id: t.route ?? 'R1',
        direction_id: t.direction === undefined ? 0 : t.direction,
      }))
    },

    async getCalendars() {
      if (!range) return []
      return Object.entries(calendars).map(([serviceId, mask]) => {
        const bit = (i: number) => (mask[i] === '1' ? 1 : 0)
        return {
          service_id: serviceId,
          monday: bit(0), tuesday: bit(1), wednesday: bit(2), thursday: bit(3),
          friday: bit(4), saturday: bit(5), sunday: bit(6),
          start_date: range.start, end_date: range.end,
        }
      })
    },

    async getCalendarDates() {
      return calendarDates.map(([service, date, type]) => ({ service_id: service, date, exception_type: type }))
    },

    ...(spec.feedInfo && {
      async getFeedInfo() {
        return spec.feedInfo!
      },
    }),

    ...(spec.frequencies && {
      async getFrequencies() {
        return spec.frequencies!.map(([trip, start, end, headway, exact]) => ({
          trip_id: trip, start_time: start, end_time: end, headway_secs: headway,
          ...(exact !== undefined && { exact_times: exact }),
        }))
      },
    }),

    async getStopTimes(filters) {
      const requested = filters?.tripId
      const wanted = requested === undefined ? null : new Set(Array.isArray(requested) ? requested : [requested])
      const rows: { trip_id: string; arrival_time: string | null; departure_time: string | null; stop_id: string; stop_sequence: number }[] = []
      for (const [tripId, t] of Object.entries(spec.trips)) {
        if (wanted && !wanted.has(tripId)) continue
        ;(t.stops ?? []).forEach(([stop, arrival, departure, sequence], i) => {
          rows.push({
            trip_id: tripId,
            stop_id: stop,
            arrival_time: arrival,
            departure_time: departure === undefined ? arrival : departure,
            stop_sequence: sequence ?? i + 1,
          })
        })
      }
      return rows
    },
  }
}

/** Liste des jours ISO de firstIso à lastIso inclus. */
export function eachDay(firstIso: string, lastIso: string): string[] {
  const days: string[] = []
  const d = new Date(firstIso + 'T00:00:00Z')
  for (;;) {
    const iso = d.toISOString().slice(0, 10)
    if (iso > lastIso) return days
    days.push(iso)
    d.setUTCDate(d.getUTCDate() + 1)
  }
}

/**
 * Feed de référence de 2 semaines (2026-01-05 → 2026-01-18), partagé par
 * plusieurs suites — retourne une copie fraîche que chaque test peut modifier.
 *
 * - WD  (lun-ven)  : trips T1, T2
 * - SAT (samedi)   : trip A1
 * - SUN (dimanche) : trip S1
 * - HOL (fériés)   : trip H1, actif uniquement par exceptions type 1 les
 *   mercredis 2026-01-07 et 2026-01-14 (où WD est retiré par type 2).
 *   H1 a exactement le même contenu horaire que S1 (ids différents).
 */
export function twoWeekSpec(): StubSpec {
  return {
    range: { start: '20260105', end: '20260118' },
    calendars: { WD: '1111100', SAT: '0000010', SUN: '0000001' },
    calendarDates: [
      ['WD', '20260107', 2],
      ['HOL', '20260107', 1],
      ['WD', '20260114', 2],
      ['HOL', '20260114', 1],
    ],
    trips: {
      T1: { service: 'WD', direction: 0, stops: [['X', '08:00:00'], ['Y', '08:30:00', '08:31:00']] },
      T2: { service: 'WD', direction: 1, stops: [['Y', '17:00:00'], ['X', '17:30:00']] },
      A1: { service: 'SAT', stops: [['X', '10:00:00'], ['Y', '10:30:00']] },
      S1: { service: 'SUN', stops: [['X', '09:00:00'], ['Y', '09:30:00']] },
      H1: { service: 'HOL', stops: [['X', '09:00:00'], ['Y', '09:30:00']] },
    },
  }
}
