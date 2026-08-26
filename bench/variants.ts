// Compare des stratégies de construction des clés « trip-content »
// (la phase qui pèse ~90 % du temps en mode trip-content).
// npx tsx bench/variants.ts feeds/astuce.zip
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { GtfsSqlJs } from 'gtfs-sqljs'
import { createSqlJsAdapter } from 'gtfs-sqljs/adapters/sql-js'

function hash64(s: string): string {
  let h1 = 5381
  let h2 = 52711
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = ((h1 * 33) ^ c) >>> 0
    h2 = (h2 * 31 + c) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

interface Trip { trip_id: string; route_id: string; direction_id?: number | null }
type Strategy = (gtfs: GtfsSqlJs, trips: Trip[]) => Promise<Map<string, string>>

const routeOf = (t: Trip) => `route ${t.route_id} dir ${t.direction_id ?? ''}`

// --- V0 : code actuel (batch de 500, objets {seq, stop}, tri par seq) -------
function makeBatchCurrent(batch: number): Strategy {
  return async (gtfs, trips) => {
    const routeByTrip = new Map(trips.map(t => [t.trip_id, routeOf(t)]))
    const stopsByTrip = new Map<string, { seq: number; stop: string }[]>()
    const tripIds = trips.map(t => t.trip_id)
    for (let i = 0; i < tripIds.length; i += batch) {
      for (const st of await gtfs.getStopTimes({ tripId: tripIds.slice(i, i + batch) })) {
        if (!stopsByTrip.has(st.trip_id)) stopsByTrip.set(st.trip_id, [])
        stopsByTrip.get(st.trip_id)!.push({ seq: st.stop_sequence, stop: `${st.stop_id}@${st.arrival_time ?? ''}>${st.departure_time ?? ''}` })
      }
    }
    const contentKeys = new Map<string, string>()
    for (const [tripId, route] of routeByTrip) {
      const stops = (stopsByTrip.get(tripId) ?? []).sort((a, b) => a.seq - b.seq)
      contentKeys.set(tripId, hash64(`${route} :: ${stops.map(x => x.stop).join(';')}`))
    }
    return contentKeys
  }
}

// --- V2 : un seul getStopTimes() sans filtre (ORDER BY arrival_time) --------
const singleUnfiltered: Strategy = async (gtfs, trips) => {
  const routeByTrip = new Map(trips.map(t => [t.trip_id, routeOf(t)]))
  const stopsByTrip = new Map<string, { seq: number; stop: string }[]>()
  for (const st of await gtfs.getStopTimes()) {
    if (!stopsByTrip.has(st.trip_id)) stopsByTrip.set(st.trip_id, [])
    stopsByTrip.get(st.trip_id)!.push({ seq: st.stop_sequence, stop: `${st.stop_id}@${st.arrival_time ?? ''}>${st.departure_time ?? ''}` })
  }
  const contentKeys = new Map<string, string>()
  for (const [tripId, route] of routeByTrip) {
    const stops = (stopsByTrip.get(tripId) ?? []).sort((a, b) => a.seq - b.seq)
    contentKeys.set(tripId, hash64(`${route} :: ${stops.map(x => x.stop).join(';')}`))
  }
  return contentKeys
}

// --- V3 : batch large + accumulation directe de chaînes (pas d'objets, pas de tri :
//     ORDER BY stop_sequence garantit l'ordre par trip à l'intérieur d'un batch) ---
function makeBatchStreaming(batch: number): Strategy {
  return async (gtfs, trips) => {
    const contentByTrip = new Map<string, string>()
    const tripIds = trips.map(t => t.trip_id)
    for (let i = 0; i < tripIds.length; i += batch) {
      for (const st of await gtfs.getStopTimes({ tripId: tripIds.slice(i, i + batch) })) {
        const part = `${st.stop_id}@${st.arrival_time ?? ''}>${st.departure_time ?? ''}`
        const prev = contentByTrip.get(st.trip_id)
        contentByTrip.set(st.trip_id, prev === undefined ? part : `${prev};${part}`)
      }
    }
    const contentKeys = new Map<string, string>()
    for (const t of trips) {
      contentKeys.set(t.trip_id, hash64(`${routeOf(t)} :: ${contentByTrip.get(t.trip_id) ?? ''}`))
    }
    return contentKeys
  }
}

// --- V4 : SQL brut via gtfs.db — 5 colonnes, ORDER BY trip_id, stop_sequence
//     (index couvrant, pas de tri temporaire, pas de rowToStopTime) ----------
const rawSql: Strategy = async (gtfs, trips) => {
  const db = (gtfs as unknown as { db: { prepare(sql: string): Promise<{ step(): Promise<boolean>; getAsObject(): Promise<Record<string, unknown>>; free(): Promise<void> }> } }).db
  const stmt = await db.prepare(
    'SELECT trip_id, stop_id, arrival_time, departure_time FROM stop_times ORDER BY trip_id, stop_sequence',
  )
  const contentByTrip = new Map<string, string>()
  let currentTrip = ''
  let acc = ''
  while (await stmt.step()) {
    const r = await stmt.getAsObject()
    const tripId = r.trip_id as string
    const part = `${r.stop_id}@${r.arrival_time ?? ''}>${r.departure_time ?? ''}`
    if (tripId === currentTrip) {
      acc += ';' + part
    } else {
      if (currentTrip !== '') contentByTrip.set(currentTrip, acc)
      currentTrip = tripId
      acc = part
    }
  }
  if (currentTrip !== '') contentByTrip.set(currentTrip, acc)
  await stmt.free()
  const contentKeys = new Map<string, string>()
  for (const t of trips) {
    contentKeys.set(t.trip_id, hash64(`${routeOf(t)} :: ${contentByTrip.get(t.trip_id) ?? ''}`))
  }
  return contentKeys
}

// --- V5 : agrégation GROUP_CONCAT côté SQLite (24 873 lignes au lieu de 650 526)
const rawGroupConcat: Strategy = async (gtfs, trips) => {
  const db = (gtfs as unknown as { db: { prepare(sql: string): Promise<{ step(): Promise<boolean>; getAsObject(): Promise<Record<string, unknown>>; free(): Promise<void> }> } }).db
  const stmt = await db.prepare(
    `SELECT trip_id, GROUP_CONCAT(stop_id || '@' || IFNULL(arrival_time,'') || '>' || IFNULL(departure_time,''), ';' ORDER BY stop_sequence) AS content
     FROM stop_times GROUP BY trip_id`,
  )
  const contentByTrip = new Map<string, string>()
  while (await stmt.step()) {
    const r = await stmt.getAsObject()
    contentByTrip.set(r.trip_id as string, (r.content as string) ?? '')
  }
  await stmt.free()
  const contentKeys = new Map<string, string>()
  for (const t of trips) {
    contentKeys.set(t.trip_id, hash64(`${routeOf(t)} :: ${contentByTrip.get(t.trip_id) ?? ''}`))
  }
  return contentKeys
}

const strategies: [string, Strategy][] = [
  ['V0  batch=500 (actuel)', makeBatchCurrent(500)],
  ['V1a batch=5000', makeBatchCurrent(5000)],
  ['V1b batch=20000', makeBatchCurrent(20000)],
  ['V2  1 appel sans filtre', singleUnfiltered],
  ['V3  batch=20000 + streaming', makeBatchStreaming(20000)],
  ['V4  SQL brut 4 colonnes', rawSql],
  ['V5  SQL brut GROUP_CONCAT', rawGroupConcat],
]

const zipPath = process.argv[2] ?? 'feeds/astuce.zip'
const gtfs = await GtfsSqlJs.fromZipData(readFileSync(zipPath).buffer as ArrayBuffer, {
  adapter: await createSqlJsAdapter(),
  skipFiles: ['shapes.txt'],
})

try {
  const dbAny = (gtfs as unknown as { db: { prepare(sql: string): Promise<{ step(): Promise<boolean>; getAsObject(): Promise<Record<string, unknown>>; free(): Promise<void> }> } }).db
  const vstmt = await dbAny.prepare('SELECT sqlite_version() AS v')
  await vstmt.step()
  console.log(`SQLite ${(await vstmt.getAsObject()).v}`)
  await vstmt.free()

  const trips = (await gtfs.getTrips()) as unknown as Trip[]
  console.log(`${trips.length} trips\n`)

  let reference: Map<string, string> | null = null
  for (const [name, strategy] of strategies) {
    try {
      const times: number[] = []
      let keys: Map<string, string> = new Map()
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now()
        keys = await strategy(gtfs, trips)
        times.push(performance.now() - t0)
      }
      times.sort((a, b) => a - b)
      let check = 'référence'
      if (reference === null) {
        reference = keys
      } else {
        const same = keys.size === reference.size && [...reference].every(([k, v]) => keys.get(k) === v)
        check = same ? 'clés identiques ✔' : 'CLÉS DIFFÉRENTES ✘'
      }
      console.log(`${name.padEnd(30)} médiane ${times[1].toFixed(0).padStart(5)} ms  (min ${times[0].toFixed(0)}, max ${times[2].toFixed(0)})  ${check}`)
    } catch (e) {
      console.log(`${name.padEnd(30)} ÉCHEC : ${(e as Error).message.slice(0, 100)}`)
    }
  }
} finally {
  await gtfs.close()
}
