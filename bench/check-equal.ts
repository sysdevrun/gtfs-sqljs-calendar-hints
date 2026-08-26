// Vérifie que fastPath:true et fastPath:false donnent des résultats
// strictement identiques : npx tsx bench/check-equal.ts feeds/astuce.zip
import { readFileSync } from 'node:fs'
import { GtfsSqlJs } from 'gtfs-sqljs'
import { createSqlJsAdapter } from 'gtfs-sqljs/adapters/sql-js'
import { findCalendarPeriods, type Hint, type SignatureMode } from '../src/calendar-hints'
import { publicHolidays, schoolVacationDays } from '../src/hints-france'

const zipPath = process.argv[2] ?? 'feeds/astuce.zip'
const gtfs = await GtfsSqlJs.fromZipData(readFileSync(zipPath).buffer as ArrayBuffer, {
  adapter: await createSqlJsAdapter(),
  skipFiles: ['shapes.txt'],
})
try {
  const probe = await findCalendarPeriods(gtfs, [], { signatureMode: 'trip-ids' })
  const hints: Hint[] = [
    { name: 'Jours fériés', policy: 'match-all', days: publicHolidays(undefined, probe.firstDay, probe.lastDay).map(h => h.date) },
    { name: 'Vacances scolaires (lun-ven)', policy: 'match-all', days: schoolVacationDays('Normandie', probe.firstDay, probe.lastDay) },
  ]
  let ok = true
  for (const mode of ['trip-ids', 'trip-content'] as SignatureMode[]) {
    const fast = await findCalendarPeriods(gtfs, hints, { signatureMode: mode, fastPath: true })
    const slow = await findCalendarPeriods(gtfs, hints, { signatureMode: mode, fastPath: false })
    const same = JSON.stringify(fast) === JSON.stringify(slow)
    console.log(`${mode.padEnd(14)} fastPath true vs false : ${same ? 'IDENTIQUES ✔' : 'DIFFÉRENTS ✘'}`)
    ok &&= same
  }
  process.exit(ok ? 0 : 1)
} finally {
  await gtfs.close()
}
