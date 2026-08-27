// Génération des hints côté navigateur : jours fériés français calculés
// localement (computus), vacances scolaires issues du calendrier officiel
// chargé par `school-calendar.ts`.
import type { Hint, Policy } from '../../src/calendar-hints'
import type { HolidayZone } from './presets'
import type { SchoolCalendarRecord } from './school-calendar'

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
// Vacances scolaires (dataset fr-en-calendrier-scolaire, cf. school-calendar.ts)
//
// L'API renvoie des timestamps « minuit heure de Paris » sérialisés en UTC
// (`2026-10-09T22:00:00+00:00`), y compris pour les zones ultramarines : la
// date calendaire officielle est la date *à Paris* de cet instant, jamais
// celle du fuseau local (aux Antilles, UTC−4, la conversion locale rendrait
// la veille). `officialDate` ajoute 12 h avant de tronquer en UTC — l'offset
// de Paris étant toujours dans ±12 h, cela rend la date parisienne quel que
// soit l'offset de sérialisation, sans table de fuseaux.
//
// Convention du jeu de données, en dates officielles :
// - start_date = jour du départ en vacances, après la dernière heure de cours ;
// - end_date   = jour de la rentrée, le matin.
// Le premier jour de vacances est donc le lendemain du départ — sauf départ un
// samedi ou un mercredi, jours sans cours pour la plupart des élèves (le
// départ réel a lieu la veille au soir), qui comptent alors comme vacances.
// Le dernier jour de vacances est la veille de la rentrée.
// ---------------------------------------------------------------------------
export interface VacationRange {
  label: string
  first: string
  last: string
}

export interface VacationOptions {
  /** Départ publié un mercredi ou un samedi : ce jour compte-t-il comme
   *  vacances ? `true` par défaut (pas de cours ce jour-là) ; `false` le
   *  traite comme les autres jours — vacances à partir du lendemain. */
  includeWedSatStart?: boolean
}

/** Date officielle (heure de Paris) d'un timestamp du dataset. */
export const officialDate = (timestamp: string) =>
  new Date(new Date(timestamp).getTime() + 12 * 3600 * 1000).toISOString().slice(0, 10)

// Les grandes vacances sont publiées en double, « Élèves » et « Enseignants »,
// à un jour d'écart : seule la version élèves nous intéresse. Le champ
// `population` sert aussi à distinguer des territoires (Guadeloupe :
// « Saint-Martin », « Saint-Barthélémy »…) ou des degrés (Polynésie) — ces
// valeurs-là sont conservées, d'où l'exclusion ciblée plutôt qu'une liste
// blanche `{-, Élèves}`.
const isTeachersOnly = (population: string) => /enseignants/i.test(population)

export function schoolVacationRanges(
  records: SchoolCalendarRecord[],
  firstDay: string,
  lastDay: string,
  { includeWedSatStart = true }: VacationOptions = {},
): VacationRange[] {
  const sundayAfter = (d: string) => addDays(d, (7 - weekdayOf(d)) % 7)
  const firstVacationDay = (departure: string) => {
    const wd = weekdayOf(departure)
    return includeWedSatStart && (wd === 3 || wd === 6) ? departure : addDays(departure, 1)
  }
  return records
    .filter(r => !isTeachersOnly(r.population))
    .map(r => {
      const start = officialDate(r.start_date)
      const end = officialDate(r.end_date)
      const label = `${r.description} ${r.annee_scolaire}`
      // « Début des Vacances … » : pas de rentrée publiée, on va jusqu'à la fin du feed
      if (r.description.startsWith('Début')) return { label, first: firstVacationDay(start), last: lastDay }
      // « Pont de l'Ascension » : le jour publié est déjà chômé (l'Ascension,
      // ou le vendredi qui la suit), et le pont court au moins jusqu'au dimanche
      if (r.description.startsWith('Pont')) {
        const beforeReturn = addDays(end, -1)
        return { label, first: start, last: beforeReturn > sundayAfter(start) ? beforeReturn : sundayAfter(start) }
      }
      return { label, first: firstVacationDay(start), last: addDays(end, -1) }
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

export function generateHints(
  zone: HolidayZone,
  schoolRecords: SchoolCalendarRecord[],
  firstDay: string,
  lastDay: string,
  configs: HintConfig[] = DEFAULT_HINT_CONFIGS,
  vacationOptions: VacationOptions = {},
): GeneratedHints {
  const holidays = publicHolidays(zone, firstDay, lastDay)
  const vacationRanges = schoolVacationRanges(schoolRecords, firstDay, lastDay, vacationOptions)
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
