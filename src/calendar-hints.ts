// gtfs-calendar-hints — detect service periods in a GTFS calendar from
// user-provided hints, with strictly exact matching (no threshold).
//
// Works on top of a gtfs-sqljs (≥ 0.9.0) instance through its bulk getXXXX
// methods. The parameter is typed structurally, so anything that implements
// the four required methods below works (including a test stub); the two
// optional ones unlock feed_info clipping and frequency-aware signatures.

export interface GtfsCalendarSource {
  getTrips(filters?: object): Promise<{ trip_id: string; service_id: string; route_id: string; direction_id?: number | null }[]>
  /** Whole calendar table (gtfs-sqljs ≥ 0.9.0) */
  getCalendars(): Promise<{
    service_id: string
    monday: number; tuesday: number; wednesday: number; thursday: number
    friday: number; saturday: number; sunday: number
    start_date: string; end_date: string
  }[]>
  /** Whole calendar_dates table (gtfs-sqljs ≥ 0.9.0 accepts the no-arg call) */
  getCalendarDates(): Promise<{ service_id: string; date: string; exception_type: number }[]>
  getStopTimes(filters?: { tripId?: string | string[] }): Promise<{
    trip_id: string; arrival_time?: string | null; departure_time?: string | null
    stop_id: string; stop_sequence: number
  }[]>
  /**
   * Optional: feed validity window (feed_info). When present, the analysed
   * range is clipped to [feed_start_date, feed_end_date] unless
   * `useFeedInfo: false`.
   */
  getFeedInfo?(): Promise<{ feed_start_date?: string | null; feed_end_date?: string | null }[]>
  /**
   * Optional: frequency-based trips (frequencies). When present, in
   * 'trip-content' mode a trip's frequency rows are part of its content, so
   * two trips serving the same stops on different headways stay distinct.
   */
  getFrequencies?(): Promise<{
    trip_id: string; start_time: string; end_time: string
    headway_secs: number; exact_times?: number | null
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
   * When the source exposes getFeedInfo() and feed_info carries
   * feed_start_date/feed_end_date, clip the analysed range to that validity
   * window (the spec says data outside it is not reliable). Set to false to
   * analyse the full calendar range regardless. Default: true.
   */
  useFeedInfo?: boolean
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
// calendar.txt weekday columns, indexed by weekdayOf (0=Sunday … 6=Saturday)
const DAY_FIELDS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

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

  // Frequency-based trips: the frequency rows are part of the content, so
  // trips serving the same stops on different headways stay distinct. Trips
  // without frequencies get no suffix — their keys are unchanged.
  const freqByTrip = new Map<string, string[]>()
  if (gtfs.getFrequencies) {
    for (const f of await gtfs.getFrequencies()) {
      if (!freqByTrip.has(f.trip_id)) freqByTrip.set(f.trip_id, [])
      freqByTrip.get(f.trip_id)!.push(`${f.start_time}>${f.end_time}@${f.headway_secs}x${f.exact_times ?? 0}`)
    }
  }

  const contentKeys = new Map<string, string>()
  for (const t of trips) {
    const freq = freqByTrip.get(t.trip_id)
    const freqPart = freq ? ` :: freq ${freq.sort().join(';')}` : ''
    contentKeys.set(t.trip_id, hash64(`${routeOf(t)} :: ${contentByTrip.get(t.trip_id) ?? ''}${freqPart}`))
  }
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

  // 2. Two bulk reads: whole calendar and calendar_dates tables
  const calendars = await gtfs.getCalendars()
  const calendarDates = await gtfs.getCalendarDates()

  // Feed range: calendar bounds + type-1 exception dates, restricted to
  // services that have trips (a tripless service cannot change a signature,
  // so it must not extend the range either)
  const bounds: string[] = []
  for (const c of calendars) {
    if (tripsByService.has(c.service_id)) bounds.push(gtfsDateToIso(c.start_date), gtfsDateToIso(c.end_date))
  }
  for (const e of calendarDates) {
    if (e.exception_type === 1 && tripsByService.has(e.service_id)) bounds.push(gtfsDateToIso(e.date))
  }
  if (bounds.length === 0) throw new Error('cannot determine the feed date range: no calendar and no type-1 calendar_dates')
  bounds.sort()
  let firstDay = bounds[0]
  let lastDay = bounds[bounds.length - 1]
  if (options.useFeedInfo !== false && gtfs.getFeedInfo) {
    for (const info of await gtfs.getFeedInfo()) {
      const start = info.feed_start_date ? gtfsDateToIso(info.feed_start_date) : null
      const end = info.feed_end_date ? gtfsDateToIso(info.feed_end_date) : null
      if (start && start > firstDay) firstDay = start
      if (end && end < lastDay) lastDay = end
    }
  }
  if (options.firstDay && options.firstDay > firstDay) firstDay = options.firstDay
  if (options.lastDay && options.lastDay < lastDay) lastDay = options.lastDay
  if (firstDay > lastDay) throw new Error(`empty analysed range: ${firstDay} > ${lastDay}`)
  const allDays = eachDay(firstDay, lastDay)

  // 3. Active services per day, computed in memory from the two tables
  // (same semantics as gtfs-sqljs getActiveServiceIds: weekday bit within
  // [start_date, end_date], then type 1 adds / type 2 removes — all
  // services included, even tripless ones)
  const exceptionsByDay = new Map<string, { service_id: string; exception_type: number }[]>()
  for (const e of calendarDates) {
    const day = gtfsDateToIso(e.date)
    if (!exceptionsByDay.has(day)) exceptionsByDay.set(day, [])
    exceptionsByDay.get(day)!.push(e)
  }
  const servicesByDay = new Map<string, string[]>()
  for (const day of allDays) {
    const gtfsDate = isoToGtfsDate(day)
    const dayField = DAY_FIELDS[weekdayOf(day)]
    const active = new Set<string>()
    for (const c of calendars) {
      if (c[dayField] === 1 && c.start_date <= gtfsDate && c.end_date >= gtfsDate) active.add(c.service_id)
    }
    for (const e of exceptionsByDay.get(day) ?? []) {
      if (e.exception_type === 1) active.add(e.service_id)
      else if (e.exception_type === 2) active.delete(e.service_id)
    }
    servicesByDay.set(day, [...active].sort())
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

// ---------------------------------------------------------------------------
// Hint-free pattern detection
// ---------------------------------------------------------------------------

export type DayPatternKind = 'full-range' | 'span' | 'span-with-exceptions'

export interface DayRange {
  firstDay: string
  lastDay: string
}

/**
 * One signature group of days, described by the exact calendar pattern it
 * forms:
 *
 * - 'full-range': the group is every day of its weekday set over the whole
 *   analysed range (e.g. "Sundays", "Every day");
 * - 'span': every day of its weekday set within [firstDay, lastDay], a strict
 *   sub-range of the analysed range (e.g. a seasonal weekday service);
 * - 'span-with-exceptions': like 'span' but with gaps — `missingDays` lists
 *   them, `missingRanges` collapses consecutive ones (consecutive within the
 *   weekday set, so a skipped week of a Mon–Fri group is one range).
 */
export interface DayPattern {
  signature: string
  days: string[]
  tripCount: number
  serviceIds: string[]
  /** Distinct weekdays present (0=Sunday … 6=Saturday), Monday first */
  weekdays: number[]
  firstDay: string
  lastDay: string
  kind: DayPatternKind
  /** Days of the weekday set within [firstDay, lastDay] absent from the group */
  missingDays: string[]
  /** missingDays collapsed into runs of consecutive weekday-set days */
  missingRanges: DayRange[]
  /** Human-readable summary; a single-day group is labeled by its date */
  label: string
}

// 'Mondays to Fridays', 'Saturdays and Sundays', 'Mondays, Wednesdays'…
// consecutive weekdays (Monday first, no wrap-around) collapse into a run.
function weekdaysLabel(weekdays: number[]): string {
  if (weekdays.length === 7) return 'Every day'
  const positions = weekdays.map(w => MONDAY_TO_SUNDAY.indexOf(w)).sort((a, b) => a - b)
  const runs: string[] = []
  for (let i = 0; i < positions.length; i++) {
    const start = i
    while (i + 1 < positions.length && positions[i + 1] === positions[i] + 1) i++
    const first = WEEKDAY_NAMES[MONDAY_TO_SUNDAY[positions[start]]]
    runs.push(i === start ? first : `${first} to ${WEEKDAY_NAMES[MONDAY_TO_SUNDAY[positions[i]]]}`)
  }
  return runs.join(', ')
}

/**
 * Group every analysed day by signature and describe each group by the exact
 * calendar pattern it forms — no hints, no thresholds, purely deductive.
 * Groups come back largest first. Pass the `days` of a CalendarAnalyzer or
 * CalendarHintsResult (contiguous, sorted — as produced there); combine with
 * `signatureMode: 'trip-content'` to merge identical schedules published
 * under different trip_ids before looking for patterns.
 *
 * The patterns are structural: they say *when* each distinct service level
 * runs, never *why* (naming a group "school vacations" or "public holidays"
 * still requires hints).
 */
export function detectDayPatterns(days: DayInfo[]): DayPattern[] {
  const allDays = days.map(d => d.date)

  const bySignature = new Map<string, DayInfo[]>()
  for (const d of days) {
    if (!bySignature.has(d.signature)) bySignature.set(d.signature, [])
    bySignature.get(d.signature)!.push(d)
  }

  const patterns: DayPattern[] = [...bySignature.values()].map(group => {
    const groupDays = group.map(d => d.date)
    const daySet = new Set(groupDays)
    const weekdaySet = new Set(groupDays.map(weekdayOf))
    const weekdays = MONDAY_TO_SUNDAY.filter(w => weekdaySet.has(w))
    const firstDay = groupDays[0]
    const lastDay = groupDays[groupDays.length - 1]

    // The group is always a subset of "all weekday-set days" (over the full
    // range or its own span), so set equality reduces to "nothing missing"
    const expectedFull = allDays.filter(d => weekdaySet.has(weekdayOf(d)))
    const expectedSpan = expectedFull.filter(d => d >= firstDay && d <= lastDay)
    const missingDays = expectedSpan.filter(d => !daySet.has(d))
    const kind: DayPatternKind =
      expectedFull.length === groupDays.length ? 'full-range'
      : missingDays.length === 0 ? 'span'
      : 'span-with-exceptions'

    const missingSet = new Set(missingDays)
    const missingRanges: DayRange[] = []
    for (let i = 0; i < expectedSpan.length; i++) {
      if (!missingSet.has(expectedSpan[i])) continue
      const start = expectedSpan[i]
      while (i + 1 < expectedSpan.length && missingSet.has(expectedSpan[i + 1])) i++
      missingRanges.push({ firstDay: start, lastDay: expectedSpan[i] })
    }

    let label: string
    if (groupDays.length === 1) {
      label = firstDay
    } else if (kind === 'full-range') {
      label = weekdaysLabel(weekdays)
    } else {
      label = `${weekdaysLabel(weekdays)} from ${firstDay} to ${lastDay}`
      if (missingDays.length > 0) label += ` except ${missingDays.length} day${missingDays.length === 1 ? '' : 's'}`
    }

    return {
      signature: group[0].signature,
      days: groupDays,
      tripCount: group[0].tripCount,
      serviceIds: group[0].serviceIds,
      weekdays,
      firstDay,
      lastDay,
      kind,
      missingDays,
      missingRanges,
      label,
    }
  })

  return patterns.sort((a, b) => b.days.length - a.days.length || a.firstDay.localeCompare(b.firstDay))
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
