// gtfs-calendar-hints — detect service periods in a GTFS calendar from
// user-provided hints, with strictly exact matching (no threshold).
//
// Works on top of a gtfs-sqljs instance, using ONLY its getXXXX methods
// (no raw SQL). The parameter is typed structurally, so anything that
// implements the five methods below works (including a test stub).

export interface GtfsCalendarSource {
  getTrips(filters?: object): Promise<{ trip_id: string; service_id: string; route_id: string; direction_id?: number | null }[]>
  getCalendarByServiceId(serviceId: string): Promise<{
    service_id: string
    monday: number; tuesday: number; wednesday: number; thursday: number
    friday: number; saturday: number; sunday: number
    start_date: string; end_date: string
  } | null>
  getCalendarDates(serviceId: string): Promise<{ service_id: string; date: string; exception_type: number }[]>
  getActiveServiceIds(date: string): Promise<string[]>
  getStopTimes(filters?: { tripId?: string | string[] }): Promise<{
    trip_id: string; arrival_time?: string | null; departure_time?: string | null
    stop_id: string; stop_sequence: number
  }[]>
}

export type Policy = 'match-all' | 'per-day-of-week'
export type SignatureMode = 'trip-ids' | 'trip-content'

/**
 * Days are ISO dates (YYYY-MM-DD).
 *
 * A hint may carry arbitrary extra attributes (extend this interface): the
 * results reference the original hint objects — never copies — so those
 * attributes come back in `HintResult.hint`, `MatchedGroup.hint` and
 * `Period.hints`, typed via the `H extends Hint` generic of
 * `findCalendarPeriods`. Do not mutate a hint after the call if you want a
 * stable result.
 */
export interface Hint {
  name: string
  policy: Policy
  days: string[]
}

export interface CalendarHintsOptions {
  /**
   * 'trip-ids' (default): two days are equal iff they run exactly the same
   * trip_ids. 'trip-content': trip_ids are replaced by a hash of the trip's
   * content (route, direction, stop and time sequence), so identical
   * schedules duplicated under different ids compare equal. Both modes are
   * exact — never approximate.
   */
  signatureMode?: SignatureMode
  /** Clip the analysed range (ISO dates), e.g. to ignore a hollow feed tail. */
  firstDay?: string
  lastDay?: string
  /**
   * When the source carries a gtfs-sqljs adapter database on `db` (as
   * GtfsSqlJs instances do), a few raw read-only SQL queries replace the
   * row-by-row getXXXX calls, with identical results. Any failure falls
   * back to the portable path. Set to false to force the portable path.
   * Default: true.
   */
  fastPath?: boolean
}

export interface DayInfo {
  date: string
  signature: string
  tripCount: number
  serviceIds: string[]
}

export interface MatchedGroup<H extends Hint = Hint> {
  label: string
  hintName: string
  /**
   * The originating hint, by reference (for groups of the final leftover
   * pass, the synthetic 'Remaining days' hint)
   */
  hint: H
  /** 0=Sunday … 6=Saturday for per-day-of-week groups, null for match-all */
  weekday: number | null
  days: string[]
  signature: string
  tripCount: number
  serviceIds: string[]
}

export interface Mismatch {
  /** null for match-all, else the weekday whose days disagree */
  weekday: number | null
  /** All distinct signatures found, largest first */
  signatureCounts: { signature: string; dayCount: number; exampleDay: string }[]
  /** Two concrete differing days, from the two largest groups */
  dayA: string
  dayB: string
  tripsOnlyInA: number
  tripsOnlyInB: number
  message: string
}

export interface HintResult<H extends Hint = Hint> {
  /** The original hint object, by reference (custom attributes included) */
  hint: H
  /** Hint days inside the feed range and not consumed by a previous hint */
  inScopeDays: string[]
  /** Hint days out of range or already consumed */
  ignoredDays: string[]
  matched: boolean
  groups: MatchedGroup<H>[]
  mismatches: Mismatch[]
}

export interface UnclassifiedGroup {
  signature: string
  days: string[]
  tripCount: number
  serviceIds: string[]
}

/** Matched groups sharing one signature, merged into a single period. */
export interface Period<H extends Hint = Hint> {
  labels: string[]
  /**
   * Distinct user hints contributing to this period, in hint order, by
   * reference. The synthetic leftover hint is excluded: a period made only
   * of leftover groups has an empty array.
   */
  hints: H[]
  days: string[]
  signature: string
  tripCount: number
  serviceIds: string[]
}

export interface CalendarHintsResult<H extends Hint = Hint> {
  firstDay: string
  lastDay: string
  /** Signature of every analysed day, for exploration and debugging */
  days: DayInfo[]
  hintResults: HintResult<H>[]
  /** Final implicit per-day-of-week pass over the remaining days */
  leftoverResult: HintResult
  unclassified: UnclassifiedGroup[]
  periods: Period<H>[]
}

// ---------------------------------------------------------------------------
// Dates (ISO YYYY-MM-DD, computed in UTC) and hashing
// ---------------------------------------------------------------------------
const WEEKDAY_NAMES =['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
const MONDAY_TO_SUNDAY = [1, 2, 3, 4, 5, 6, 0]

const gtfsDateToIso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
const isoToGtfsDate = (iso: string) => iso.replaceAll('-', '')
export const weekdayOf = (iso: string) => new Date(iso + 'T00:00:00Z').getUTCDay()

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function eachDay(firstIso: string, lastIso: string): string[] {
  const days: string[] = []
  for (let d = firstIso; d <= lastIso; d = addDays(d, 1)) days.push(d)
  return days
}

// 64-bit hash (two 32-bit mixes); keeps per-day signatures small
function hash64(s: string): string {
  let h1 = 5381
  let h2 = 52711
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = ((h1 * 33) ^ c) >>> 0
    h2 = (h2 * 31 + c) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

// ---------------------------------------------------------------------------
// Optional raw-SQL fast path. gtfs-sqljs instances expose their adapter
// database as `db` (prepare/step/getAsObject); when present, two read-only
// queries replace the row-by-row getXXXX calls with identical results.
// Sources without `db` (test stubs, other backends) use the portable path.
// ---------------------------------------------------------------------------
interface RawSqlStatement {
  step(): Promise<boolean>
  getAsObject(): Promise<Record<string, unknown>>
  free(): Promise<void>
}
interface RawSqlDatabase {
  prepare(sql: string): Promise<RawSqlStatement>
}

function rawDatabaseOf(gtfs: GtfsCalendarSource, options: CalendarHintsOptions): RawSqlDatabase | null {
  if (options.fastPath === false) return null
  const db = (gtfs as { db?: unknown }).db
  return db && typeof (db as RawSqlDatabase).prepare === 'function' ? (db as RawSqlDatabase) : null
}

async function rawAll(db: RawSqlDatabase, sql: string): Promise<Record<string, unknown>[]> {
  const stmt = await db.prepare(sql)
  const rows: Record<string, unknown>[] = []
  try {
    while (await stmt.step()) rows.push(await stmt.getAsObject())
  } finally {
    await stmt.free()
  }
  return rows
}

// ---------------------------------------------------------------------------
// Feed calendar built from getXXXX methods (or the raw fast path)
// ---------------------------------------------------------------------------
interface FeedCalendar {
  firstDay: string
  lastDay: string
  allDays: string[]
  serviceIdsOf(day: string): string[]
  signatureOf(day: string): string
  tripCountOf(day: string): number
  tripIdsOf(day: string): Set<string>
}

const STOP_TIMES_BATCH = 500

type TripRow = { trip_id: string; service_id: string; route_id: string; direction_id?: number | null }

async function loadTrips(gtfs: GtfsCalendarSource, db: RawSqlDatabase | null): Promise<TripRow[]> {
  if (db) {
    try {
      const rows = await rawAll(db, 'SELECT trip_id, service_id, route_id, direction_id FROM trips')
      return rows.map(r => ({
        trip_id: String(r.trip_id),
        service_id: String(r.service_id),
        route_id: String(r.route_id),
        direction_id: r.direction_id === null || r.direction_id === undefined ? null : Number(r.direction_id),
      }))
    } catch { /* portable fallback below */ }
  }
  return gtfs.getTrips()
}

async function loadContentKeys(gtfs: GtfsCalendarSource, db: RawSqlDatabase | null, trips: TripRow[]): Promise<Map<string, string>> {
  const routeOf = (t: TripRow) => `route ${t.route_id} dir ${t.direction_id ?? ''}`
  let contentByTrip: Map<string, string> | null = null

  if (db) {
    // One aggregated query: SQLite builds each trip's stop/time sequence
    // string itself (GROUP_CONCAT … ORDER BY needs SQLite ≥ 3.44); ~26×
    // fewer rows cross the JS boundary than with per-row stop_times reads.
    try {
      const rows = await rawAll(db,
        `SELECT trip_id, GROUP_CONCAT(stop_id || '@' || IFNULL(arrival_time, '') || '>' || IFNULL(departure_time, ''), ';' ORDER BY stop_sequence) AS content
         FROM stop_times GROUP BY trip_id`)
      contentByTrip = new Map(rows.map(r => [String(r.trip_id), r.content === null || r.content === undefined ? '' : String(r.content)]))
    } catch { contentByTrip = null }
  }

  if (contentByTrip === null) {
    // Portable path: batched getStopTimes({ tripId: [...] }) — filters
    // accept arrays. No ordering is assumed from the source; stops are
    // sorted by stop_sequence before building each trip's string.
    const stopsByTrip = new Map<string, { seq: number; stop: string }[]>()
    const tripIds = trips.map(t => t.trip_id)
    for (let i = 0; i < tripIds.length; i += STOP_TIMES_BATCH) {
      for (const st of await gtfs.getStopTimes({ tripId: tripIds.slice(i, i + STOP_TIMES_BATCH) })) {
        if (!stopsByTrip.has(st.trip_id)) stopsByTrip.set(st.trip_id, [])
        stopsByTrip.get(st.trip_id)!.push({ seq: st.stop_sequence, stop: `${st.stop_id}@${st.arrival_time ?? ''}>${st.departure_time ?? ''}` })
      }
    }
    contentByTrip = new Map()
    for (const [tripId, stops] of stopsByTrip) {
      contentByTrip.set(tripId, stops.sort((a, b) => a.seq - b.seq).map(x => x.stop).join(';'))
    }
  }

  const contentKeys = new Map<string, string>()
  for (const t of trips) contentKeys.set(t.trip_id, hash64(`${routeOf(t)} :: ${contentByTrip.get(t.trip_id) ?? ''}`))
  return contentKeys
}

async function loadFeedCalendar(
  gtfs: GtfsCalendarSource,
  options: CalendarHintsOptions,
): Promise<FeedCalendar> {
  const db = rawDatabaseOf(gtfs, options)

  // 1. One trips read: trips per service + route/direction per trip
  const trips = await loadTrips(gtfs, db)
  const tripsByService = new Map<string, string[]>()
  for (const t of trips) {
    if (!tripsByService.has(t.service_id)) tripsByService.set(t.service_id, [])
    tripsByService.get(t.service_id)!.push(t.trip_id)
  }

  // 2. Feed range: per-service calendar bounds + type-1 exception dates.
  // (There is no getFeedInfo()/list-services method; service ids come from
  // the trips. Services without trips are invisible — they would not change
  // any signature anyway.)
  const bounds: string[] = []
  for (const serviceId of tripsByService.keys()) {
    const calendar = await gtfs.getCalendarByServiceId(serviceId)
    if (calendar) bounds.push(gtfsDateToIso(calendar.start_date), gtfsDateToIso(calendar.end_date))
    for (const e of await gtfs.getCalendarDates(serviceId)) {
      if (e.exception_type === 1) bounds.push(gtfsDateToIso(e.date))
    }
  }
  if (bounds.length === 0) throw new Error('cannot determine the feed date range: no calendar and no type-1 calendar_dates')
  bounds.sort()
  let firstDay = bounds[0]
  let lastDay = bounds[bounds.length - 1]
  if (options.firstDay && options.firstDay > firstDay) firstDay = options.firstDay
  if (options.lastDay && options.lastDay < lastDay) lastDay = options.lastDay
  if (firstDay > lastDay) throw new Error(`empty analysed range: ${firstDay} > ${lastDay}`)
  const allDays = eachDay(firstDay, lastDay)

  // 3. Active services per day: getActiveServiceIds already implements the
  // calendar + calendar_dates logic — one call per day
  const servicesByDay = new Map<string, string[]>()
  for (const day of allDays) {
    servicesByDay.set(day, (await gtfs.getActiveServiceIds(isoToGtfsDate(day))).sort())
  }

  // 4. Equality key per trip: its trip_id, or the hash of its content
  const contentKeys = options.signatureMode === 'trip-content'
    ? await loadContentKeys(gtfs, db, trips)
    : null
  const keyOf = (tripId: string) => (contentKeys ? contentKeys.get(tripId)! : tripId)

  // Signatures memoized per service combination
  const signatureByCombo = new Map<string, string>()
  const signatureOf = (day: string) => {
    const combo = servicesByDay.get(day)!.join('|')
    let sig = signatureByCombo.get(combo)
    if (sig === undefined) {
      const keys = servicesByDay.get(day)!.flatMap(s => tripsByService.get(s) ?? []).map(keyOf).sort()
      sig = `${keys.length}t:${hash64(keys.join(','))}`
      signatureByCombo.set(combo, sig)
    }
    return sig
  }

  return {
    firstDay,
    lastDay,
    allDays,
    serviceIdsOf: day => servicesByDay.get(day)!,
    signatureOf,
    tripCountOf: day => servicesByDay.get(day)!.reduce((n, s) => n + (tripsByService.get(s)?.length ?? 0), 0),
    tripIdsOf: day => new Set(servicesByDay.get(day)!.flatMap(s => tripsByService.get(s) ?? [])),
  }
}

// ---------------------------------------------------------------------------
// The matching algorithm
// ---------------------------------------------------------------------------
function groupBySignature(days: string[], feed: FeedCalendar): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const d of days) {
    const sig = feed.signatureOf(d)
    if (!groups.has(sig)) groups.set(sig, [])
    groups.get(sig)!.push(d)
  }
  return groups
}

function buildMismatch(weekday: number | null, bySignature: Map<string, string[]>, feed: FeedCalendar): Mismatch {
  const entries = [...bySignature.entries()].sort((a, b) => b[1].length - a[1].length)
  const signatureCounts = entries.map(([signature, days]) => ({ signature, dayCount: days.length, exampleDay: days[0] }))
  const dayA = entries[0][1][0]
  const dayB = entries[1][1][0]
  const tripsA = feed.tripIdsOf(dayA)
  const tripsB = feed.tripIdsOf(dayB)
  const tripsOnlyInA = [...tripsA].filter(t => !tripsB.has(t)).length
  const tripsOnlyInB = [...tripsB].filter(t => !tripsA.has(t)).length
  const shape = signatureCounts.slice(0, 6).map(g => `${g.dayCount} days like ${g.exampleDay}`).join(', ')
    + (signatureCounts.length > 6 ? `, … ${signatureCounts.length - 6} more` : '')
  const prefix = weekday === null ? '' : `${WEEKDAY_NAMES[weekday]}: `
  return {
    weekday,
    signatureCounts,
    dayA,
    dayB,
    tripsOnlyInA,
    tripsOnlyInB,
    message:
      `${prefix}${entries.length} distinct signatures (${shape}) — ` +
      `e.g. ${dayA} (${tripsA.size} trips, services ${feed.serviceIdsOf(dayA).join('+') || 'none'}) ≠ ` +
      `${dayB} (${tripsB.size} trips, services ${feed.serviceIdsOf(dayB).join('+') || 'none'}): ` +
      `${tripsOnlyInA} trips only on ${dayA}, ${tripsOnlyInB} only on ${dayB}`,
  }
}

function makeGroup<H extends Hint>(label: string, hint: H, weekday: number | null, days: string[], feed: FeedCalendar): MatchedGroup<H> {
  return {
    label,
    hintName: hint.name,
    hint,
    weekday,
    days,
    signature: feed.signatureOf(days[0]),
    tripCount: feed.tripCountOf(days[0]),
    serviceIds: feed.serviceIdsOf(days[0]),
  }
}

function applyHint<H extends Hint>(hint: H, remainingDays: Set<string>, feed: FeedCalendar): HintResult<H> {
  const uniqueDays = [...new Set(hint.days)].sort()
  const inScopeDays = uniqueDays.filter(d => remainingDays.has(d))
  const result: HintResult<H> = {
    hint,
    inScopeDays,
    ignoredDays: uniqueDays.filter(d => !remainingDays.has(d)),
    matched: false,
    groups: [],
    mismatches: [],
  }
  if (inScopeDays.length === 0) return result

  if (hint.policy === 'match-all') {
    // Every day of the hint must run exactly the same trips
    const bySignature = groupBySignature(inScopeDays, feed)
    if (bySignature.size === 1) {
      result.matched = true
      result.groups.push(makeGroup(hint.name, hint, null, inScopeDays, feed))
      for (const d of inScopeDays) remainingDays.delete(d)
    } else {
      result.mismatches.push(buildMismatch(null, bySignature, feed))
    }
  } else {
    // Each weekday examined separately: all the hint's Mondays must be
    // identical to each other, all its Tuesdays, and so on
    for (const weekday of MONDAY_TO_SUNDAY) {
      const days = inScopeDays.filter(d => weekdayOf(d) === weekday)
      if (days.length === 0) continue
      const bySignature = groupBySignature(days, feed)
      if (bySignature.size === 1) {
        result.groups.push(makeGroup(`${hint.name} — ${WEEKDAY_NAMES[weekday]}`, hint, weekday, days, feed))
        for (const d of days) remainingDays.delete(d)
      } else {
        result.mismatches.push(buildMismatch(weekday, bySignature, feed))
      }
    }
    result.matched = result.groups.length > 0
  }
  return result
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Feed calendar loaded once; analyze() is pure in-memory computation (no
 * further gtfs calls), so trying several hint sets costs milliseconds
 * instead of re-reading trips and stop_times every time. The range and
 * signatureMode are fixed at creation.
 */
export interface CalendarAnalyzer {
  firstDay: string
  lastDay: string
  /** Signature of every analysed day, for exploration and debugging */
  days: DayInfo[]
  analyze<H extends Hint = Hint>(hints: H[]): CalendarHintsResult<H>
}

export async function createCalendarAnalyzer(
  gtfs: GtfsCalendarSource,
  options: CalendarHintsOptions = {},
): Promise<CalendarAnalyzer> {
  const feed = await loadFeedCalendar(gtfs, options)

  const days: DayInfo[] = feed.allDays.map(date => ({
    date,
    signature: feed.signatureOf(date),
    tripCount: feed.tripCountOf(date),
    serviceIds: feed.serviceIdsOf(date),
  }))

  return {
    firstDay: feed.firstDay,
    lastDay: feed.lastDay,
    days,
    analyze: hints => analyzeWithFeed(feed, days, hints),
  }
}

export async function findCalendarPeriods<H extends Hint = Hint>(
  gtfs: GtfsCalendarSource,
  hints: H[],
  options: CalendarHintsOptions = {},
): Promise<CalendarHintsResult<H>> {
  return (await createCalendarAnalyzer(gtfs, options)).analyze(hints)
}

function analyzeWithFeed<H extends Hint>(feed: FeedCalendar, days: DayInfo[], hints: H[]): CalendarHintsResult<H> {
  const remainingDays = new Set(feed.allDays)
  const hintResults = hints.map(h => applyHint(h, remainingDays, feed))

  // Final pass: per-day-of-week over whatever remains
  const leftoverHint: Hint = { name: 'Remaining days', policy: 'per-day-of-week', days: [...remainingDays] }
  const leftoverResult = applyHint(leftoverHint, remainingDays, feed)

  const unclassified: UnclassifiedGroup[] = [...groupBySignature([...remainingDays].sort(), feed).entries()]
    .map(([signature, groupDays]) => ({
      signature,
      days: groupDays,
      tripCount: feed.tripCountOf(groupDays[0]),
      serviceIds: feed.serviceIdsOf(groupDays[0]),
    }))
    .sort((a, b) => b.days.length - a.days.length)

  // Matched groups sharing a signature are one period
  const mergedBySignature = new Map<string, MatchedGroup[]>()
  for (const g of [...hintResults as HintResult[], leftoverResult].flatMap(r => r.groups)) {
    if (!mergedBySignature.has(g.signature)) mergedBySignature.set(g.signature, [])
    mergedBySignature.get(g.signature)!.push(g)
  }
  const periods: Period<H>[] = [...mergedBySignature.entries()]
    .map(([signature, groups]) => ({
      labels: groups.map(g => g.label),
      // Every hint but the synthetic leftover one comes from the H[] input
      hints: [...new Set(groups.map(g => g.hint))].filter(h => h !== leftoverHint) as H[],
      days: groups.flatMap(g => g.days).sort(),
      signature,
      tripCount: groups[0].tripCount,
      serviceIds: groups[0].serviceIds,
    }))
    .sort((a, b) => b.days.length - a.days.length)

  return { firstDay: feed.firstDay, lastDay: feed.lastDay, days: [...days], hintResults, leftoverResult, unclassified, periods }
}
