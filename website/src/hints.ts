// Génération des hints côté navigateur : jours fériés français calculés
// localement (computus), vacances scolaires depuis l'API
// data.education.gouv.fr avec repli sur l'extrait embarqué du dépôt.
import type { Hint, Policy } from '../../src/calendar-hints'
import type { Academy, HolidayZone } from './presets'
import schoolCalendarFallback from '../../data/school-calendar.json'

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

// ---------------------------------------------------------------------------
// Jours fériés français (type « public » uniquement)
// ---------------------------------------------------------------------------
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** Dimanche de Pâques (algorithme grégorien anonyme). */
function easterSunday(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return iso(year, month, day)
}

export interface PublicHoliday {
  date: string
  name: string
}

export function publicHolidays(zone: HolidayZone, firstDay: string, lastDay: string): PublicHoliday[] {
  const holidays: PublicHoliday[] = []
  for (let y = Number(firstDay.slice(0, 4)); y <= Number(lastDay.slice(0, 4)); y++) {
    const easter = easterSunday(y)
    holidays.push(
      { date: iso(y, 1, 1), name: 'Jour de l’an' },
      { date: addDays(easter, 1), name: 'Lundi de Pâques' },
      { date: iso(y, 5, 1), name: 'Fête du travail' },
      { date: iso(y, 5, 8), name: 'Victoire 1945' },
      { date: addDays(easter, 39), name: 'Ascension' },
      { date: addDays(easter, 50), name: 'Lundi de Pentecôte' },
      { date: iso(y, 7, 14), name: 'Fête nationale' },
      { date: iso(y, 8, 15), name: 'Assomption' },
      { date: iso(y, 11, 1), name: 'Toussaint' },
      { date: iso(y, 11, 11), name: 'Armistice 1918' },
      { date: iso(y, 12, 25), name: 'Noël' },
    )
    if (zone === 'reunion') {
      holidays.push({ date: iso(y, 12, 20), name: 'Abolition de l’esclavage' })
    }
  }
  return holidays.filter(h => h.date >= firstDay && h.date <= lastDay).sort((a, b) => a.date.localeCompare(b.date))
}

// ---------------------------------------------------------------------------
// Vacances scolaires : API data.education.gouv.fr (fr-en-calendrier-scolaire)
// Convention du jeu de données : start_date = dernier jour de classe,
// end_date = dernier jour de vacances (reprise le lendemain matin).
// ---------------------------------------------------------------------------
interface SchoolCalendarRecord {
  description: string
  population: string
  start_date: string
  end_date: string
  location: string
  annee_scolaire: string
}

const API_URL = 'https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records'

const recordsCache = new Map<string, SchoolCalendarRecord[]>()

async function fetchSchoolCalendar(academy: Academy): Promise<SchoolCalendarRecord[]> {
  const cached = recordsCache.get(academy)
  if (cached) return cached
  let records: SchoolCalendarRecord[]
  try {
    const params = new URLSearchParams({
      select: 'description,population,start_date,end_date,location,annee_scolaire',
      where: `location="${academy}"`,
      limit: '100',
    })
    const res = await fetch(`${API_URL}?${params}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { results: SchoolCalendarRecord[] }
    records = data.results
  } catch {
    // Hors-ligne ou API indisponible : extrait embarqué (2025-2027)
    records = (schoolCalendarFallback as { results: SchoolCalendarRecord[] }).results
  }
  const filtered = records.filter(r => r.location === academy)
  recordsCache.set(academy, filtered)
  return filtered
}

export interface VacationRange {
  label: string
  first: string
  last: string
}

export async function schoolVacationRanges(academy: Academy, firstDay: string, lastDay: string): Promise<VacationRange[]> {
  const sundayAfter = (d: string) => addDays(d, (7 - weekdayOf(d)) % 7)
  const records = await fetchSchoolCalendar(academy)
  return records
    .filter(r => r.population === '-' || r.population === 'Élèves')
    .map(r => {
      const start = r.start_date.slice(0, 10)
      const end = r.end_date.slice(0, 10)
      const label = `${r.description} ${r.annee_scolaire}`
      // « Début des Vacances … » : pas de fin publiée, on va jusqu'à la fin du feed
      if (r.description.startsWith('Début')) return { label, first: addDays(start, 1), last: lastDay }
      // « Pont de l'Ascension » : le férié lui-même ouvre le pont, jusqu'au dimanche
      if (r.description.startsWith('Pont')) return { label, first: start, last: end > sundayAfter(start) ? end : sundayAfter(start) }
      return { label, first: addDays(start, 1), last: end }
    })
    .filter(v => v.last >= firstDay && v.first <= lastDay)
    .sort((a, b) => a.first.localeCompare(b.first))
}

/** Jours de vacances scolaires, du lundi au vendredi uniquement. */
export function vacationDaysOf(ranges: VacationRange[]): string[] {
  const isMonToFri = (d: string) => weekdayOf(d) >= 1 && weekdayOf(d) <= 5
  return [...new Set(ranges.flatMap(v => eachDay(v.first, v.last)))].filter(isMonToFri).sort()
}

// ---------------------------------------------------------------------------
// Configuration des hints : liste ordonnée, réordonnable, extensible.
// Les sources « auto » (fériés, vacances scolaires) sont résolues à l'analyse
// sur la plage du feed ; les hints personnalisés listent leurs dates.
// ---------------------------------------------------------------------------
export type HintSource = 'holidays' | 'school-vacations' | 'custom'

export interface HintConfig {
  id: string
  source: HintSource
  name: string
  policy: Policy
  enabled: boolean
  /** Source « custom » uniquement : dates ou plages `AAAA-MM-JJ..AAAA-MM-JJ`,
   *  séparées par espaces, virgules ou retours à la ligne. */
  daysText: string
}

export const DEFAULT_HINT_CONFIGS: HintConfig[] = [
  { id: 'holidays', source: 'holidays', name: 'Jours fériés', policy: 'match-all', enabled: true, daysText: '' },
  { id: 'school-vacations', source: 'school-vacations', name: 'Vacances scolaires (lun-ven)', policy: 'match-all', enabled: true, daysText: '' },
]

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const isValidDate = (s: string) => {
  if (!DATE_RE.test(s)) return false
  const t = Date.parse(s + 'T00:00:00Z')
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s
}
const MAX_RANGE_DAYS = 3700 // garde-fou contre les fautes de frappe sur l'année

export function parseDaysText(text: string): { days: string[]; invalid: string[] } {
  const days = new Set<string>()
  const invalid: string[] = []
  for (const token of text.split(/[\s,;]+/).filter(Boolean)) {
    const parts = token.split(/\.\.+|->|→/)
    if (parts.length === 1 && isValidDate(parts[0])) {
      days.add(parts[0])
    } else if (
      parts.length === 2 && isValidDate(parts[0]) && isValidDate(parts[1]) &&
      parts[0] <= parts[1] && eachDay(parts[0], parts[1]).length <= MAX_RANGE_DAYS
    ) {
      for (const d of eachDay(parts[0], parts[1])) days.add(d)
    } else {
      invalid.push(token)
    }
  }
  return { days: [...days].sort(), invalid }
}

export interface GeneratedHints {
  holidays: PublicHoliday[]
  vacationRanges: VacationRange[]
  hints: Hint[]
}

export async function generateHints(
  zone: HolidayZone,
  academy: Academy,
  firstDay: string,
  lastDay: string,
  configs: HintConfig[] = DEFAULT_HINT_CONFIGS,
): Promise<GeneratedHints> {
  const holidays = publicHolidays(zone, firstDay, lastDay)
  const vacationRanges = await schoolVacationRanges(academy, firstDay, lastDay)
  const daysOf = (c: HintConfig): string[] => {
    if (c.source === 'holidays') return holidays.map(h => h.date)
    if (c.source === 'school-vacations') return vacationDaysOf(vacationRanges)
    return parseDaysText(c.daysText).days
  }
  const hints: Hint[] = configs
    .filter(c => c.enabled)
    .map(c => ({ name: c.name, policy: c.policy, days: daysOf(c) }))
  return { holidays, vacationRanges, hints }
}
