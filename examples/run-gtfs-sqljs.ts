// Runner de validation via gtfs-sqljs (aucune requête SQL brute — uniquement
// les méthodes getXXXX) : npx tsx src/run-gtfs-sqljs.ts car-jaune estival …
import { readFileSync } from 'node:fs'
import { GtfsSqlJs } from 'gtfs-sqljs'
import { createSqlJsAdapter } from 'gtfs-sqljs/adapters/sql-js'
import { findCalendarPeriods, weekdayOf, type CalendarHintsResult, type Hint, type SignatureMode } from '../src/calendar-hints'
import { NETWORKS, publicHolidays, schoolVacationDays, schoolVacationRanges } from './hints-france'

const WEEKDAY_NAMES_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

function formatDays(days: string[]): string {
  if (days.length <= 14) return days.join(', ')
  return `${days.length} jours (${days[0]} → ${days[days.length - 1]})`
}

function servicesLabel(services: string[]): string {
  if (services.length === 0) return 'aucun'
  if (services.length <= 4) return services.join('+')
  return `${services.slice(0, 4).join('+')} +${services.length - 4} autres`
}

function printResult(result: CalendarHintsResult) {
  for (const r of [...result.hintResults, result.leftoverResult]) {
    console.log(`\n--- Hint « ${r.hint.name} » (${r.hint.policy}, ${r.hint.days.length} jours fournis, ${r.inScopeDays.length} à examiner) ---`)
    console.log(r.matched ? '✔ MATCHÉ' : '✘ NON MATCHÉ')
    for (const g of r.groups) {
      console.log(`  ✔ ${g.label} : ${g.days.length} j., ${g.tripCount} trips [${g.signature}], services ${servicesLabel(g.serviceIds)}`)
      console.log(`      ${formatDays(g.days)}`)
    }
    for (const m of r.mismatches) console.log(`  ✘ ${m.message}`)
  }
  console.log(`\n=== Jours non classés : ${result.unclassified.reduce((n, g) => n + g.days.length, 0)} ===`)
  for (const g of result.unclassified.slice(0, 8)) {
    const weekdays = [...new Set(g.days.map(d => WEEKDAY_NAMES_FR[weekdayOf(d)]))].join(', ')
    console.log(`  [${g.signature}] ${g.days.length} j. (${weekdays}), ${g.tripCount} trips, services ${servicesLabel(g.serviceIds)}`)
  }
  if (result.unclassified.length > 8) console.log(`  … +${result.unclassified.length - 8} autres signatures`)
  console.log(`\n=== Synthèse des périodes ===`)
  for (const p of result.periods) {
    console.log(`  ${p.labels.join(' + ')}`)
    console.log(`      ${p.days.length} j., ${p.tripCount} trips [${p.signature}], services ${servicesLabel(p.serviceIds)}`)
  }
}

const names = process.argv.slice(2)
if (names.length === 0) {
  console.error(`usage: npx tsx src/run-gtfs-sqljs.ts <réseau…>  (réseaux connus : ${Object.keys(NETWORKS).join(', ')})`)
  process.exit(1)
}

for (const name of names) {
  const cfg = NETWORKS[name]
  if (!cfg) throw new Error(`réseau inconnu : ${name}`)
  console.log(`\n${'━'.repeat(78)}\n━━ RÉSEAU ${name.toUpperCase()} (via gtfs-sqljs)\n${'━'.repeat(78)}`)

  const gtfs = await GtfsSqlJs.fromZipData(readFileSync(cfg.zip).buffer as ArrayBuffer, {
    adapter: await createSqlJsAdapter(),
    skipFiles: ['shapes.txt'],
  })
  try {
    for (const mode of ['trip-ids', 'trip-content'] as SignatureMode[]) {
      const started = Date.now()
      // Première passe légère pour connaître la plage, afin de générer les hints
      const probe = await findCalendarPeriods(gtfs, [], { signatureMode: 'trip-ids' })
      const holidays = publicHolidays(cfg.holidayState, probe.firstDay, probe.lastDay)
      const vacationDays = schoolVacationDays(cfg.academy, probe.firstDay, probe.lastDay)
      if (mode === 'trip-ids') {
        console.log(`\nFériés (${cfg.holidayState ? 'FR/' + cfg.holidayState : 'FR métropole'}) : ${holidays.map(h => h.date).join(', ')}`)
        for (const v of schoolVacationRanges(cfg.academy, probe.firstDay, probe.lastDay)) {
          console.log(`Vacances « ${v.label} » : ${v.first} → ${v.last}`)
        }
      }
      const hints: Hint[] = [
        { name: 'Jours fériés', policy: 'match-all', days: holidays.map(h => h.date) },
        { name: 'Vacances scolaires (lun-ven)', policy: 'match-all', days: vacationDays },
      ]
      const result = await findCalendarPeriods(gtfs, hints, { signatureMode: mode })
      console.log(`\n=== ${name} — ${result.firstDay} → ${result.lastDay} (${result.days.length} j.) — égalité par ${mode} — ${Date.now() - started} ms ===`)
      console.log(`${new Set(result.days.map(d => d.signature)).size} signatures distinctes sur la plage`)
      printResult(result)
    }
  } finally {
    await gtfs.close()
  }
}
