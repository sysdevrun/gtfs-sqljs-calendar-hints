// Benchmark instrumenté : npx tsx bench/bench.ts feeds/astuce.zip [runs]
// Décompose findCalendarPeriods() par méthode gtfs-sqljs appelée + temps JS pur,
// avec et sans fast-path SQL, puis mesure la ré-analyse via createCalendarAnalyzer.
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { GtfsSqlJs } from 'gtfs-sqljs'
import { createSqlJsAdapter } from 'gtfs-sqljs/adapters/sql-js'
import {
  createCalendarAnalyzer, findCalendarPeriods,
  type CalendarHintsOptions, type Hint, type SignatureMode, type GtfsCalendarSource,
} from '../src/calendar-hints'
import { publicHolidays, schoolVacationDays } from '../examples/hints-france'

interface MethodStat { calls: number; ms: number; rows: number }
type RawStmt = { step(): Promise<boolean>; getAsObject(): Promise<Record<string, unknown>>; free(): Promise<void>; bind?(p: unknown[]): Promise<void> }
type RawDb = { prepare(sql: string): Promise<RawStmt> }

function instrument(gtfs: GtfsSqlJs): { source: GtfsCalendarSource; stats: Map<string, MethodStat>; reset: () => void } {
  const stats = new Map<string, MethodStat>()
  const add = (name: string, ms: number, rows: number) => {
    const s = stats.get(name) ?? { calls: 0, ms: 0, rows: 0 }
    s.calls++
    s.ms += ms
    s.rows += rows
    stats.set(name, s)
  }
  const wrap = <A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const t0 = performance.now()
      const res = await fn.apply(gtfs, args)
      add(name, performance.now() - t0, Array.isArray(res) ? res.length : (res ? 1 : 0))
      return res
    }
  // db instrumenté : le temps d'une requête brute = prepare + step/getAsObject cumulés
  const realDb = (gtfs as unknown as { db: RawDb }).db
  const instrumentedDb: RawDb = {
    prepare: async (sql: string) => {
      const t0 = performance.now()
      const stmt = await realDb.prepare(sql)
      let ms = performance.now() - t0
      let rows = 0
      const timed = <A2 extends unknown[], R2>(fn: (...a: A2) => Promise<R2>) => async (...a: A2) => {
        const t = performance.now()
        const r = await fn.apply(stmt, a)
        ms += performance.now() - t
        return r
      }
      return {
        step: timed(stmt.step),
        getAsObject: async () => {
          const t = performance.now()
          const r = await stmt.getAsObject()
          ms += performance.now() - t
          rows++
          return r
        },
        free: async () => {
          const t = performance.now()
          await stmt.free()
          ms += performance.now() - t
          add('SQL brut (fast-path)', ms, rows)
        },
      }
    },
  }
  return {
    stats,
    reset: () => stats.clear(),
    source: {
      getTrips: wrap('getTrips', gtfs.getTrips.bind(gtfs)),
      getCalendars: wrap('getCalendars', gtfs.getCalendars.bind(gtfs)),
      getCalendarDates: wrap('getCalendarDates', gtfs.getCalendarDates.bind(gtfs)),
      getStopTimes: wrap('getStopTimes', gtfs.getStopTimes.bind(gtfs)),
      getFeedInfo: wrap('getFeedInfo', gtfs.getFeedInfo.bind(gtfs)),
      getFrequencies: wrap('getFrequencies', gtfs.getFrequencies.bind(gtfs)),
      db: instrumentedDb,
    } as GtfsCalendarSource,
  }
}

function printStats(stats: Map<string, MethodStat>, totalMs: number) {
  let dbMs = 0
  for (const [name, s] of [...stats.entries()].sort((a, b) => b[1].ms - a[1].ms)) {
    console.log(`    ${name.padEnd(24)} ${String(s.calls).padStart(5)} appels  ${s.ms.toFixed(1).padStart(9)} ms  ${String(s.rows).padStart(8)} lignes`)
    dbMs += s.ms
  }
  console.log(`    ${'— total accès données'.padEnd(24)} ${''.padStart(5)}        ${dbMs.toFixed(1).padStart(9)} ms`)
  console.log(`    ${'— JS pur (lib)'.padEnd(24)} ${''.padStart(5)}        ${(totalMs - dbMs).toFixed(1).padStart(9)} ms`)
}

async function timeRuns(runs: number, fn: () => Promise<unknown> | unknown): Promise<{ median: number; last: number; all: number[] }> {
  await fn() // warmup
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    await fn()
    times.push(performance.now() - t)
  }
  const sorted = [...times].sort((a, b) => a - b)
  return { median: sorted[Math.floor(sorted.length / 2)], last: times[times.length - 1], all: times }
}

const zipPath = process.argv[2] ?? 'feeds/astuce.zip'
const runs = Number(process.argv[3] ?? 3)

const t0 = performance.now()
const gtfs = await GtfsSqlJs.fromZipData(readFileSync(zipPath).buffer as ArrayBuffer, {
  adapter: await createSqlJsAdapter(),
  skipFiles: ['shapes.txt'],
})
console.log(`Chargement zip + import sql.js : ${(performance.now() - t0).toFixed(0)} ms`)

try {
  const probe = await createCalendarAnalyzer(gtfs, { signatureMode: 'trip-ids' })
  const hints: Hint[] = [
    { name: 'Jours fériés', policy: 'match-all', days: publicHolidays(undefined, probe.firstDay, probe.lastDay).map(h => h.date) },
    { name: 'Vacances scolaires (lun-ven)', policy: 'match-all', days: schoolVacationDays('Normandie', probe.firstDay, probe.lastDay) },
  ]
  console.log(`Plage : ${probe.firstDay} → ${probe.lastDay} (${probe.days.length} jours)`)

  for (const mode of ['trip-ids', 'trip-content'] as SignatureMode[]) {
    for (const fastPath of [false, true]) {
      console.log(`\n=== mode ${mode} — fastPath: ${fastPath} ===`)
      const { source, stats, reset } = instrument(gtfs)
      const options: CalendarHintsOptions = { signatureMode: mode, fastPath }
      const { median, last, all } = await timeRuns(runs, async () => {
        reset()
        await findCalendarPeriods(source, hints, options)
      })
      console.log(`  findCalendarPeriods : médiane ${median.toFixed(1)} ms (runs: ${all.map(t => t.toFixed(0)).join(', ')})`)
      console.log(`  Détail du dernier run (${last.toFixed(1)} ms) :`)
      printStats(stats, last)
    }

    // Ré-analyse : analyzer chargé une fois, analyze() par jeu de hints
    const analyzer = await createCalendarAnalyzer(gtfs, { signatureMode: mode })
    const re = await timeRuns(Math.max(runs, 5), () => analyzer.analyze(hints))
    console.log(`  createCalendarAnalyzer réutilisé → analyze() : médiane ${re.median.toFixed(2)} ms`)
  }
} finally {
  await gtfs.close()
}
