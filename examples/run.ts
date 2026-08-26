// Runner multi-réseaux (lecture CSV directe) : npx tsx src/run.ts astuce kar-ouest …
import {
  applyHint, loadFeedCalendar, printReport, printSynthesis, printUnclassified,
  type Hint, type SignatureMode,
} from './lib'
import { NETWORKS, publicHolidays, schoolVacationDays, schoolVacationRanges, type NetworkConfig } from './hints-france'

function runNetwork(name: string, cfg: NetworkConfig, mode: SignatureMode, printInputs: boolean) {
  const feed = loadFeedCalendar(cfg.dir, mode)
  const holidays = publicHolidays(cfg.holidayState, feed.firstDay, feed.lastDay)
  const vacationDays = schoolVacationDays(cfg.academy, feed.firstDay, feed.lastDay)

  if (printInputs) {
    console.log(`\nFériés (${cfg.holidayState ? 'FR/' + cfg.holidayState : 'FR métropole'}, dans la plage) : ${holidays.map(h => h.date).join(', ')}`)
    for (const v of schoolVacationRanges(cfg.academy, feed.firstDay, feed.lastDay)) {
      console.log(`Vacances « ${v.label} » : ${v.first} → ${v.last}`)
    }
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
