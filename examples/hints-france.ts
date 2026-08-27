// Construction des hints français : jours fériés (date-holidays) et vacances
// scolaires (API data.education.gouv.fr, extrait dans data/school-calendar.json)
import { readFileSync } from 'node:fs'
import Holidays from 'date-holidays'
import { addDays, eachDay, weekdayOf } from './lib'

export interface NetworkConfig {
  dir: string // GTFS dézippé (runner CSV)
  zip: string // GTFS zippé (runner gtfs-sqljs)
  holidayState?: string // région date-holidays ('RE' pour La Réunion) ; absent = France métropole
  academy: 'Réunion' | 'Normandie'
}

export const NETWORKS: Record<string, NetworkConfig> = {
  'car-jaune': { dir: 'gtfs', zip: 'gtfs-car-jaune.zip', holidayState: 'RE', academy: 'Réunion' },
  'kar-ouest': { dir: 'feeds/kar-ouest', zip: 'feeds/kar-ouest.zip', holidayState: 'RE', academy: 'Réunion' },
  'carsud': { dir: 'feeds/carsud', zip: 'feeds/carsud.zip', holidayState: 'RE', academy: 'Réunion' },
  'estival': { dir: 'feeds/estival', zip: 'feeds/estival.zip', holidayState: 'RE', academy: 'Réunion' },
  'astuce': { dir: 'feeds/astuce', zip: 'feeds/astuce.zip', academy: 'Normandie' },
}

// Calendrier scolaire officiel. L'API renvoie des timestamps « minuit heure
// de Paris » sérialisés en UTC (`2026-10-09T22:00:00+00:00`), y compris pour
// l'outre-mer : la date officielle est la date à Paris de cet instant (+12 h
// puis troncature UTC, robuste quel que soit l'offset de sérialisation).
// Convention du jeu de données, en dates officielles : start_date = jour du
// départ en vacances (après la dernière heure de cours), end_date = jour de
// la rentrée (le matin).
const schoolCalendar = JSON.parse(readFileSync('data/school-calendar.json', 'utf8')) as {
  results: { description: string; population: string; start_date: string; end_date: string; location: string; annee_scolaire: string }[]
}

const officialDate = (timestamp: string) =>
  new Date(new Date(timestamp).getTime() + 12 * 3600 * 1000).toISOString().slice(0, 10)

export interface VacationOptions {
  /** Départ publié un mercredi ou un samedi : jour de vacances ? `true` par
   *  défaut (pas de cours ce jour-là) ; `false` = vacances le lendemain. */
  includeWedSatStart?: boolean
}

export function schoolVacationRanges(
  academy: string,
  firstDay: string,
  lastDay: string,
  { includeWedSatStart = true }: VacationOptions = {},
): { label: string; first: string; last: string }[] {
  const sundayAfter = (iso: string) => addDays(iso, (7 - weekdayOf(iso)) % 7)
  const firstVacationDay = (departure: string) => {
    const wd = weekdayOf(departure)
    return includeWedSatStart && (wd === 3 || wd === 6) ? departure : addDays(departure, 1)
  }
  return schoolCalendar.results
    .filter(r => r.location === academy && (r.population === '-' || r.population === 'Élèves'))
    .map(r => {
      const start = officialDate(r.start_date)
      const end = officialDate(r.end_date)
      const label = `${r.description} ${r.annee_scolaire}`
      // « Début des Vacances … » : pas de rentrée publiée, on va jusqu'à la fin du feed
      if (r.description.startsWith('Début')) return { label, first: firstVacationDay(start), last: lastDay }
      // « Pont de l'Ascension » : le jour publié est déjà chômé, jusqu'au dimanche au moins
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
export function schoolVacationDays(academy: string, firstDay: string, lastDay: string, options: VacationOptions = {}): string[] {
  const isMonToFri = (d: string) => weekdayOf(d) >= 1 && weekdayOf(d) <= 5
  const ranges = schoolVacationRanges(academy, firstDay, lastDay, options)
  return [...new Set(ranges.flatMap(v => eachDay(v.first, v.last)))].filter(isMonToFri).sort()
}

export function publicHolidays(state: string | undefined, firstDay: string, lastDay: string): { date: string; name: string }[] {
  const hd = state ? new Holidays('FR', state) : new Holidays('FR')
  const years: number[] = []
  for (let y = Number(firstDay.slice(0, 4)); y <= Number(lastDay.slice(0, 4)); y++) years.push(y)
  return years
    .flatMap(y => hd.getHolidays(y))
    .filter(h => h.type === 'public')
    .map(h => ({ date: h.date.slice(0, 10), name: h.name }))
    .filter(h => h.date >= firstDay && h.date <= lastDay)
}
