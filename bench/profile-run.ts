// Répartition du temps du runner run-gtfs-sqljs.ts sur astuce, phase par phase.
// npx tsx bench/profile-run.ts feeds/astuce.zip
import { readFileSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { GtfsSqlJs } from 'gtfs-sqljs'
import { createSqlJsAdapter } from 'gtfs-sqljs/adapters/sql-js'
import { findCalendarPeriods, type Hint, type SignatureMode } from '../src/calendar-hints'
import { publicHolidays, schoolVacationDays, schoolVacationRanges } from '../examples/hints-france'

// performance.timeOrigin = démarrage du process : tout ce qui précède cette
// ligne (node + tsx + résolution des imports, dont sql.js) est déjà écoulé.
const phases: [string, number][] = [['démarrage node + tsx + imports', performance.now()]]
let last = performance.now()
const mark = (name: string) => {
  const now = performance.now()
  phases.push([name, now - last])
  last = now
}

const zipPath = process.argv[2] ?? 'feeds/astuce.zip'
const zipData = readFileSync(zipPath)
mark('lecture du zip (disque)')

const adapter = await createSqlJsAdapter()
mark('init sql.js (WASM)')

const gtfs = await GtfsSqlJs.fromZipData(zipData.buffer as ArrayBuffer, {
  adapter,
  skipFiles: ['shapes.txt'],
})
mark('fromZipData : unzip + parse CSV + import DB + index')

try {
  const lines: string[] = []
  for (const mode of ['trip-ids', 'trip-content'] as SignatureMode[]) {
    const probe = await findCalendarPeriods(gtfs, [], { signatureMode: 'trip-ids' })
    mark(`[${mode}] probe findCalendarPeriods (trip-ids, sans hints)`)

    const holidays = publicHolidays(undefined, probe.firstDay, probe.lastDay)
    const vacationDays = schoolVacationDays('Normandie', probe.firstDay, probe.lastDay)
    schoolVacationRanges('Normandie', probe.firstDay, probe.lastDay)
    const hints: Hint[] = [
      { name: 'Jours fériés', policy: 'match-all', days: holidays.map(h => h.date) },
      { name: 'Vacances scolaires (lun-ven)', policy: 'match-all', days: vacationDays },
    ]
    mark(`[${mode}] génération des hints (fériés + vacances)`)

    const result = await findCalendarPeriods(gtfs, hints, { signatureMode: mode })
    mark(`[${mode}] findCalendarPeriods réel`)

    // Équivalent de printResult, capturé au lieu d'écrire sur stdout
    for (const r of [...result.hintResults, result.leftoverResult]) {
      lines.push(`${r.hint.name}: ${r.matched}`)
      for (const g of r.groups) lines.push(`${g.label} ${g.days.join(',')}`)
      for (const m of r.mismatches) lines.push(m.message)
    }
    for (const g of result.unclassified) lines.push(`${g.signature} ${g.days.length}`)
    for (const p of result.periods) lines.push(p.labels.join('+'))
    mark(`[${mode}] formatage du rapport`)
  }
  writeFileSync('/dev/null', lines.join('\n'))
} finally {
  await gtfs.close()
}
mark('fermeture DB')

const total = performance.now()
console.log(`TOTAL process : ${(total / 1000).toFixed(2)} s\n`)
for (const [name, ms] of phases) {
  const pct = (ms / total) * 100
  console.log(`${ms.toFixed(0).padStart(6)} ms  ${pct.toFixed(1).padStart(5)} %  ${name}`)
}
