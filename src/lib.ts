import { existsSync } from 'node:fs'
import { iterCsv, parseCsv } from './csv'

// ---------------------------------------------------------------------------
// Dates : ISO "YYYY-MM-DD" partout, calculs en UTC
// ---------------------------------------------------------------------------
export const WEEKDAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
export const MONDAY_TO_SUNDAY = [1, 2, 3, 4, 5, 6, 0]

export const gtfsDateToIso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
export const weekdayOf = (iso: string) => new Date(iso + 'T00:00:00Z').getUTCDay()

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function eachDay(firstIso: string, lastIso: string): string[] {
  const days: string[] = []
  for (let d = firstIso; d <= lastIso; d = addDays(d, 1)) days.push(d)
  return days
}

// Hash 64 bits (2 × 32 bits mélangés différemment) : évite de conserver des
// signatures de plusieurs centaines de Ko par jour sur les gros feeds
export function hash64(s: string): string {
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
// Calendrier du feed : pour chaque jour de la plage, la "signature" — clé
// d'égalité de l'ensemble exact des trips qui circulent ce jour
// ---------------------------------------------------------------------------
export type SignatureMode = 'trip-ids' | 'trip-content'

export interface FeedCalendar {
  firstDay: string
  lastDay: string
  allDays: string[]
  servicesOf(day: string): string[]
  signatureOf(day: string): string
  tripCountOf(day: string): number
  tripsOf(day: string): Set<string>
}

export function loadFeedCalendar(dir: string, mode: SignatureMode): FeedCalendar {
  const WEEKDAY_COLUMNS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  // calendar.txt est optionnel : certains feeds (ex. Astuce) n'utilisent que
  // calendar_dates.txt avec des exceptions de type 1
  const calendar = existsSync(`${dir}/calendar.txt`) ? parseCsv(`${dir}/calendar.txt`) : []

  const tripsByService = new Map<string, string[]>()
  const routeByTrip = mode === 'trip-content' ? new Map<string, string>() : null
  for (const t of iterCsv(`${dir}/trips.txt`)) {
    if (!tripsByService.has(t.service_id)) tripsByService.set(t.service_id, [])
    tripsByService.get(t.service_id)!.push(t.trip_id)
    routeByTrip?.set(t.trip_id, `route ${t.route_id} dir ${t.direction_id}`)
  }

  // Clé d'égalité d'un trip : son trip_id, ou (mode trip-content) le hash de
  // son contenu — route, direction, séquence d'arrêts et horaires. Deux trips
  // dupliqués sous des ids différents deviennent alors égaux. Toujours du
  // matching exact, jamais de seuil.
  let contentKeys: Map<string, string> | null = null
  if (mode === 'trip-content') {
    const stopsByTrip = new Map<string, { seq: number; stop: string }[]>()
    for (const st of iterCsv(`${dir}/stop_times.txt`)) {
      if (!stopsByTrip.has(st.trip_id)) stopsByTrip.set(st.trip_id, [])
      stopsByTrip.get(st.trip_id)!.push({ seq: Number(st.stop_sequence), stop: `${st.stop_id}@${st.arrival_time}>${st.departure_time}` })
    }
    contentKeys = new Map()
    for (const [tripId, route] of routeByTrip!) {
      const stops = (stopsByTrip.get(tripId) ?? []).sort((a, b) => a.seq - b.seq)
      contentKeys.set(tripId, hash64(`${route} :: ${stops.map(x => x.stop).join(';')}`))
    }
  }
  const keyOf = (tripId: string) => (contentKeys ? contentKeys.get(tripId)! : tripId)

  const addedByDay = new Map<string, string[]>()
  const removedByDay = new Map<string, Set<string>>()
  if (existsSync(`${dir}/calendar_dates.txt`)) {
    for (const e of iterCsv(`${dir}/calendar_dates.txt`)) {
      const date = gtfsDateToIso(e.date)
      if (e.exception_type === '1') {
        if (!addedByDay.has(date)) addedByDay.set(date, [])
        addedByDay.get(date)!.push(e.service_id)
      } else {
        if (!removedByDay.has(date)) removedByDay.set(date, new Set())
        removedByDay.get(date)!.add(e.service_id)
      }
    }
  }

  // Plage du feed : bornes de calendar.txt + jours ajoutés par calendar_dates
  // (une suppression de type 2 hors de ces bornes n'étend pas la plage)
  const bounds = [
    ...calendar.flatMap(c => [gtfsDateToIso(c.start_date), gtfsDateToIso(c.end_date)]),
    ...addedByDay.keys(),
  ].sort()
  if (bounds.length === 0) throw new Error(`${dir} : ni calendar.txt ni exception de type 1 — plage indéterminable`)
  const firstDay = bounds[0]
  const lastDay = bounds[bounds.length - 1]
  const allDays = eachDay(firstDay, lastDay)

  const servicesByDay = new Map<string, string[]>()
  for (const day of allDays) {
    const weekdayColumn = WEEKDAY_COLUMNS[weekdayOf(day)]
    const removed = removedByDay.get(day) ?? new Set()
    const services = calendar
      .filter(c => c[weekdayColumn] === '1' && gtfsDateToIso(c.start_date) <= day && day <= gtfsDateToIso(c.end_date))
      .map(c => c.service_id)
      .concat(addedByDay.get(day) ?? [])
      .filter(s => !removed.has(s))
      .sort()
    servicesByDay.set(day, services)
  }

  // Signatures mémoïsées par combinaison de services : les jours qui activent
  // les mêmes services partagent la même signature sans recalcul
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
    servicesOf: day => servicesByDay.get(day)!,
    signatureOf,
    tripCountOf: day => servicesByDay.get(day)!.reduce((n, s) => n + (tripsByService.get(s)?.length ?? 0), 0),
    tripsOf: day => new Set(servicesByDay.get(day)!.flatMap(s => tripsByService.get(s) ?? [])),
  }
}

// ---------------------------------------------------------------------------
// L'algorithme de matching des hints
// ---------------------------------------------------------------------------
export type Policy = 'match-all' | 'per-day-of-week'

export interface Hint {
  name: string
  policy: Policy
  days: string[]
}

export interface MatchedGroup {
  label: string
  days: string[]
  signature: string
}

export interface HintReport {
  hint: Hint
  inScope: string[] // jours du hint dans la plage du feed et pas encore consommés
  matched: boolean
  groups: MatchedGroup[]
  errors: string[]
}

export function applyHint(hint: Hint, remainingDays: Set<string>, feed: FeedCalendar): HintReport {
  const inScope = [...new Set(hint.days)].filter(d => remainingDays.has(d)).sort()
  const report: HintReport = { hint, inScope, matched: false, groups: [], errors: [] }
  if (inScope.length === 0) {
    report.errors.push('aucun jour du hint dans la plage du feed (ou tous déjà consommés par un hint précédent)')
    return report
  }

  if (hint.policy === 'match-all') {
    // Tous les jours du hint doivent avoir exactement les mêmes trips.
    const bySignature = groupBySignature(inScope, feed)
    if (bySignature.size === 1) {
      report.matched = true
      report.groups.push({ label: hint.name, days: inScope, signature: feed.signatureOf(inScope[0]) })
      for (const d of inScope) remainingDays.delete(d)
    } else {
      report.errors.push(mismatchMessage(bySignature, feed))
    }
  } else {
    // Chaque jour de la semaine est examiné séparément : tous les lundis du
    // hint doivent être identiques entre eux, tous les mardis, etc.
    for (const weekday of MONDAY_TO_SUNDAY) {
      const days = inScope.filter(d => weekdayOf(d) === weekday)
      if (days.length === 0) continue
      const bySignature = groupBySignature(days, feed)
      if (bySignature.size === 1) {
        report.groups.push({ label: `${hint.name} — ${WEEKDAY_NAMES[weekday]}s`, days, signature: feed.signatureOf(days[0]) })
        for (const d of days) remainingDays.delete(d)
      } else {
        report.errors.push(`${WEEKDAY_NAMES[weekday]}s : ${mismatchMessage(bySignature, feed)}`)
      }
    }
    report.matched = report.groups.length > 0
    if (!report.matched) report.errors.unshift("aucun jour de la semaine n'est homogène pour ce hint")
  }
  return report
}

export function groupBySignature(days: string[], feed: FeedCalendar): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const d of days) {
    const sig = feed.signatureOf(d)
    if (!groups.has(sig)) groups.set(sig, [])
    groups.get(sig)!.push(d)
  }
  return groups
}

// Message d'erreur : au moins 2 jours concrets qui diffèrent, avec le détail
function mismatchMessage(bySignature: Map<string, string[]>, feed: FeedCalendar): string {
  const groups = [...bySignature.values()].sort((a, b) => b.length - a.length)
  const dayA = groups[0][0]
  const dayB = groups[1][0]
  const tripsA = feed.tripsOf(dayA)
  const tripsB = feed.tripsOf(dayB)
  const onlyInA = [...tripsA].filter(t => !tripsB.has(t)).length
  const onlyInB = [...tripsB].filter(t => !tripsA.has(t)).length
  const shape = groups.slice(0, 6).map(g => `${g.length} j. comme ${g[0]}`).join(', ')
    + (groups.length > 6 ? `, … ${groups.length - 6} autres` : '')
  return (
    `${bySignature.size} signatures distinctes (${shape}) — ` +
    `ex: ${dayA} (${tripsA.size} trips, services ${servicesLabel(feed.servicesOf(dayA))}) ≠ ` +
    `${dayB} (${tripsB.size} trips, services ${servicesLabel(feed.servicesOf(dayB))}) : ` +
    `${onlyInA} trips uniquement le ${dayA}, ${onlyInB} uniquement le ${dayB}`
  )
}

// ---------------------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------------------
function servicesLabel(services: string[]): string {
  if (services.length === 0) return 'aucun'
  if (services.length <= 4) return services.join('+')
  return `${services.slice(0, 4).join('+')} +${services.length - 4} autres`
}

function formatDays(days: string[]): string {
  if (days.length <= 14) return days.join(', ')
  return `${days.length} jours (${days[0]} → ${days[days.length - 1]})`
}

export function printReport(report: HintReport, feed: FeedCalendar) {
  const { hint } = report
  console.log(`\n--- Hint « ${hint.name} » (${hint.policy}, ${hint.days.length} jours fournis, ${report.inScope.length} à examiner) ---`)
  console.log(report.matched ? '✔ MATCHÉ' : '✘ NON MATCHÉ')
  for (const g of report.groups) {
    const day0 = g.days[0]
    console.log(`  ✔ ${g.label} : ${g.days.length} j., ${feed.tripCountOf(day0)} trips [${g.signature}], services ${servicesLabel(feed.servicesOf(day0))}`)
    console.log(`      ${formatDays(g.days)}`)
  }
  for (const e of report.errors) console.log(`  ✘ ${e}`)
}

export function printUnclassified(remaining: Set<string>, feed: FeedCalendar) {
  console.log(`\n=== Jours non classés : ${remaining.size} ===`)
  const groups = [...groupBySignature([...remaining].sort(), feed).entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [sig, days] of groups.slice(0, 8)) {
    const weekdays = [...new Set(days.map(d => WEEKDAY_NAMES[weekdayOf(d)]))].join(', ')
    console.log(`  [${sig}] ${days.length} j. (${weekdays}), ${feed.tripCountOf(days[0])} trips, services ${servicesLabel(feed.servicesOf(days[0]))}`)
    const shown = days.slice(0, 21)
    for (let i = 0; i < shown.length; i += 7) console.log(`      ${shown.slice(i, i + 7).join(', ')}`)
    if (days.length > 21) console.log(`      … +${days.length - 21} autres jours`)
  }
  if (groups.length > 8) console.log(`  … +${groups.length - 8} autres signatures`)
}

// Les groupes matchés qui partagent la même signature sont une seule "période"
export function printSynthesis(reports: HintReport[], feed: FeedCalendar) {
  console.log(`\n=== Synthèse des périodes (groupes aux trips identiques fusionnés) ===`)
  const merged = new Map<string, MatchedGroup[]>()
  for (const g of reports.flatMap(r => r.groups)) {
    if (!merged.has(g.signature)) merged.set(g.signature, [])
    merged.get(g.signature)!.push(g)
  }
  for (const [signature, groups] of [...merged.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const dayCount = groups.reduce((n, g) => n + g.days.length, 0)
    const day0 = groups[0].days[0]
    console.log(`  ${groups.map(g => g.label).join(' + ')}`)
    console.log(`      ${dayCount} j., ${feed.tripCountOf(day0)} trips [${signature}], services ${servicesLabel(feed.servicesOf(day0))}`)
  }
}
