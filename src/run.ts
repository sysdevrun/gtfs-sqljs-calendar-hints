// Runner multi-réseaux : npx tsx src/run.ts astuce kar-ouest carsud estival
import { readFileSync } from 'node:fs'
import Holidays from 'date-holidays'
import {
  addDays, applyHint, eachDay, weekdayOf,
  loadFeedCalendar, printReport, printSynthesis, printUnclassified,
  type FeedCalendar, type Hint, type SignatureMode,
} from './lib'

interface NetworkConfig {
  dir: string
  holidayState?: string // région date-holidays ('RE' pour La Réunion) ; absent = France métropole
  academy: 'Réunion' | 'Normandie'
}

const NETWORKS: Record<string, NetworkConfig> = {
  'car-jaune': { dir: 'gtfs', holidayState: 'RE', academy: 'Réunion' },
  'kar-ouest': { dir: 'feeds/kar-ouest', holidayState: 'RE', academy: 'Réunion' },
  'carsud': { dir: 'feeds/carsud', holidayState: 'RE', academy: 'Réunion' },
  'estival': { dir: 'feeds/estival', holidayState: 'RE', academy: 'Réunion' },
  'astuce': { dir: 'feeds/astuce', academy: 'Normandie' },
}

// Calendrier scolaire officiel (data.education.gouv.fr, fr-en-calendrier-scolaire).
// Convention du jeu de données : start_date = dernier jour de classe (les
// vacances commencent le soir), end_date = dernier jour de vacances (reprise
// le lendemain matin).
const schoolCalendar = JSON.parse(readFileSync('data/school-calendar.json', 'utf8')) as {
  results: { description: string; population: string; start_date: string; end_date: string; location: string; annee_scolaire: string }[]
}

function schoolVacationRanges(academy: string, feed: FeedCalendar): { label: string; first: string; last: string }[] {
  const sundayAfter = (iso: string) => addDays(iso, (7 - weekdayOf(iso)) % 7)
  return schoolCalendar.results
    .filter(r => r.location === academy && (r.population === '-' || r.population === 'Élèves'))
    .map(r => {
      const start = r.start_date.slice(0, 10)
      const end = r.end_date.slice(0, 10)
      const label = `${r.description} ${r.annee_scolaire}`
      // « Début des Vacances … » : pas de fin publiée, on va jusqu'à la fin du feed
      if (r.description.startsWith('Début')) return { label, first: addDays(start, 1), last: feed.lastDay }
      // « Pont de l'Ascension » : le jour férié lui-même ouvre le pont, jusqu'au dimanche
      if (r.description.startsWith('Pont')) return { label, first: start, last: end > sundayAfter(start) ? end : sundayAfter(start) }
      return { label, first: addDays(start, 1), last: end }
    })
    .filter(v => v.last >= feed.firstDay && v.first <= feed.lastDay)
    .sort((a, b) => a.first.localeCompare(b.first))
}

function publicHolidays(state: string | undefined, feed: FeedCalendar): { date: string; name: string }[] {
  const hd = state ? new Holidays('FR', state) : new Holidays('FR')
  const years: number[] = []
  for (let y = Number(feed.firstDay.slice(0, 4)); y <= Number(feed.lastDay.slice(0, 4)); y++) years.push(y)
  return years
    .flatMap(y => hd.getHolidays(y))
    .filter(h => h.type === 'public')
    .map(h => ({ date: h.date.slice(0, 10), name: h.name }))
    .filter(h => h.date >= feed.firstDay && h.date <= feed.lastDay)
}

function runNetwork(name: string, cfg: NetworkConfig, mode: SignatureMode, printInputs: boolean) {
  const feed = loadFeedCalendar(cfg.dir, mode)
  const holidays = publicHolidays(cfg.holidayState, feed)
  const vacations = schoolVacationRanges(cfg.academy, feed)
  const isMonToFri = (d: string) => weekdayOf(d) >= 1 && weekdayOf(d) <= 5
  const vacationDays = [...new Set(vacations.flatMap(v => eachDay(v.first, v.last)))].filter(isMonToFri).sort()

  if (printInputs) {
    console.log(`\nFériés (${cfg.holidayState ? 'FR/' + cfg.holidayState : 'FR métropole'}, dans la plage) : ${holidays.map(h => h.date).join(', ')}`)
    for (const v of vacations) console.log(`Vacances « ${v.label} » : ${v.first} → ${v.last}`)
  }

  console.log(`\n=== ${name} — ${feed.firstDay} → ${feed.lastDay} (${feed.allDays.length} j.) — égalité par ${mode} ===`)
  console.log(`${new Set(feed.allDays.map(d => feed.signatureOf(d))).size} signatures distinctes sur la plage`)

  const hints: Hint[] = [
    { name: 'Jours fériés', policy: 'match-all', days: holidays.map(h => h.date) },
    { name: 'Vacances scolaires (lun-ven)', policy: 'match-all', days: vacationDays },
  ]
  const remaining = new Set(feed.allDays)
  const reports = hints.map(h => applyHint(h, remaining, feed))
  reports.forEach(r => printReport(r, feed))

  // Étape finale : per-day-of-week sur les jours restants
  const leftover = applyHint({ name: 'Jours restants', policy: 'per-day-of-week', days: [...remaining] }, remaining, feed)
  printReport(leftover, feed)
  printUnclassified(remaining, feed)
  printSynthesis([...reports, leftover], feed)
}

const names = process.argv.slice(2)
if (names.length === 0) {
  console.error(`usage: npx tsx src/run.ts <réseau…>  (réseaux connus : ${Object.keys(NETWORKS).join(', ')})`)
  process.exit(1)
}
for (const name of names) {
  const cfg = NETWORKS[name]
  if (!cfg) throw new Error(`réseau inconnu : ${name}`)
  console.log(`\n${'━'.repeat(78)}\n━━ RÉSEAU ${name.toUpperCase()}\n${'━'.repeat(78)}`)
  runNetwork(name, cfg, 'trip-ids', true)
  runNetwork(name, cfg, 'trip-content', false)
}
