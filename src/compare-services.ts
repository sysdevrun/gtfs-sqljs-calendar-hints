// Compare le CONTENU des courses entre services : deux services qui ont
// exactement les mêmes (route, direction, séquence d'arrêts + horaires)
// sont le même horaire dupliqué sous d'autres trip_id.
import { parseCsv } from './csv'

const dir = process.argv[2] ?? 'gtfs'
const trips = parseCsv(`${dir}/trips.txt`)
const stopTimes = parseCsv(`${dir}/stop_times.txt`)

const serviceByTrip = new Map(trips.map(t => [t.trip_id, t.service_id]))
const routeByTrip = new Map(trips.map(t => [t.trip_id, `route ${t.route_id} dir ${t.direction_id}`]))

const stopsByTrip = new Map<string, { seq: number; stop: string }[]>()
for (const st of stopTimes) {
  if (!stopsByTrip.has(st.trip_id)) stopsByTrip.set(st.trip_id, [])
  stopsByTrip.get(st.trip_id)!.push({ seq: Number(st.stop_sequence), stop: `${st.stop_id}@${st.arrival_time}>${st.departure_time}` })
}

// Multiset des contenus de trips par service
const contentsByService = new Map<string, Map<string, number>>()
for (const [tripId, stops] of stopsByTrip) {
  stops.sort((a, b) => a.seq - b.seq)
  const content = `${routeByTrip.get(tripId)} :: ${stops.map(x => x.stop).join(';')}`
  const service = serviceByTrip.get(tripId)!
  if (!contentsByService.has(service)) contentsByService.set(service, new Map())
  const counts = contentsByService.get(service)!
  counts.set(content, (counts.get(content) ?? 0) + 1)
}

const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)

const services = [...contentsByService.keys()].sort((a, b) => Number(a) - Number(b))
console.log('Trips par service :')
for (const s of services) console.log(`  service ${s} : ${total(contentsByService.get(s)!)} trips`)

console.log('\nComparaison du contenu horaire (paires de services) :')
for (let i = 0; i < services.length; i++) {
  for (let j = i + 1; j < services.length; j++) {
    const a = contentsByService.get(services[i])!
    const b = contentsByService.get(services[j])!
    let common = 0
    for (const [content, countA] of a) common += Math.min(countA, b.get(content) ?? 0)
    const onlyA = total(a) - common
    const onlyB = total(b) - common
    const verdict = onlyA === 0 && onlyB === 0 ? 'IDENTIQUES' : `≠ (${onlyA} seulement dans ${services[i]}, ${onlyB} seulement dans ${services[j]})`
    console.log(`  service ${services[i]} vs ${services[j]} : ${common} trips au contenu commun — ${verdict}`)
  }
}
