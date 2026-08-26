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

// Calendrier scolaire officiel. Convention du jeu de données : start_date =
// dernier jour de classe (les vacances commencent le soir), end_date =
// dernier jour de vacances (reprise le lendemain matin).
const schoolCalendar = JSON.parse(readFileSync('data/school-calendar.json', 'utf8')) as {
  results: { description: string; population: string; start_date: string; end_date: string; location: string; annee_scolaire: string }[]
}

export function schoolVacationRanges(academy: string, firstDay: string, lastDay: string): { label: string; first: string; last: string }[] {
  const sundayAfter = (iso: string) => addDays(iso, (7 - weekdayOf(iso)) % 7)
  return schoolCalendar.results
    .filter(r => r.location === academy && (r.population === '-' || r.population === 'Élèves'))
    .map(r => {
      const start = r.start_date.slice(0, 10)
      const end = r.end_date.slice(0, 10)
      const label = `${r.description} ${r.annee_scolaire}`
      // « Début des Vacances … » : pas de fin publiée, on va jusqu'à la fin du feed
      if (r.description.startsWith('Début')) return { label, first: addDays(start, 1), last: lastDay }
      // « Pont de l'Ascension » : le jour férié lui-même ouvre le pont, jusqu'au dimanche
      if (r.description.startsWith('Pont')) return { label, first: start, last: end > sundayAfter(start) ? end : sundayAfter(start) }
      return { label, first: addDays(start, 1), last: end }
    })
    .filter(v => v.last >= firstDay && v.first <= lastDay)
    .sort((a, b) => a.first.localeCompare(b.first))
}

/** Jours de vacances scolaires, du lundi au vendredi uniquement. */
export function schoolVacationDays(academy: string, firstDay: string, lastDay: string): string[] {
  const isMonToFri = (d: string) => weekdayOf(d) >= 1 && weekdayOf(d) <= 5
  const ranges = schoolVacationRanges(academy, firstDay, lastDay)
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
