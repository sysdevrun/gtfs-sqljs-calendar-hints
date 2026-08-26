// Calendrier scolaire officiel — dataset `fr-en-calendrier-scolaire` de
// data.education.gouv.fr :
// https://data.education.gouv.fr/explore/assets/fr-en-calendrier-scolaire/
//
// L'export JSON complet (~550 ko, 13 zones, 2017-2018 → 2026-2027) est servi
// avec `Access-Control-Allow-Origin: *` : téléchargeable directement depuis le
// navigateur, sans passer par le proxy. Ne poser aucun en-tête sur la requête —
// `Content-Type` n'est pas listé dans `Access-Control-Allow-Headers` et un
// simple `Content-Type: application/json` fait échouer le preflight.
import fallbackExtract from '../../data/school-calendar.json'

export const DATASET_URL =
  'https://data.education.gouv.fr/explore/assets/fr-en-calendrier-scolaire/'
export const EXPORT_URL =
  'https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/exports/json/'

export interface SchoolCalendarRecord {
  description: string
  population: string
  start_date: string
  end_date: string
  location: string
  zones: string
  annee_scolaire: string
}

/** Une zone du jeu de données et les académies (`location`) qu'elle couvre. */
export interface ZoneEntry {
  zone: string
  locations: string[]
}

export interface SchoolCalendar {
  records: SchoolCalendarRecord[]
  zones: ZoneEntry[]
  schoolYears: string[]
  /** `fallback` : extrait embarqué du dépôt, l'API étant injoignable. */
  source: 'api' | 'fallback'
  /** Raison du repli sur l'extrait embarqué, le cas échéant. */
  error?: string
}

const collator = new Intl.Collator('fr')
// Les trois zones métropolitaines d'abord, le reste par ordre alphabétique.
const zoneRank = (zone: string) => (zone.startsWith('Zone ') ? 0 : 1)

/**
 * Regroupe les enregistrements par zone. Les zones métropolitaines sont
 * dupliquées par académie (mêmes dates pour toutes les `location` d'une zone) ;
 * les zones ultramarines n'en ont qu'une, homonyme de la zone.
 */
export function indexZones(records: SchoolCalendarRecord[]): ZoneEntry[] {
  const byZone = new Map<string, Set<string>>()
  for (const r of records) {
    if (!r.zones || !r.location) continue
    let locations = byZone.get(r.zones)
    if (!locations) byZone.set(r.zones, (locations = new Set()))
    locations.add(r.location)
  }
  return [...byZone]
    .map(([zone, locations]) => ({ zone, locations: [...locations].sort(collator.compare) }))
    .sort((a, b) => zoneRank(a.zone) - zoneRank(b.zone) || collator.compare(a.zone, b.zone))
}

/** Enregistrements d'une académie, dans l'ordre chronologique. */
export function recordsForLocation(
  calendar: SchoolCalendar,
  location: string,
): SchoolCalendarRecord[] {
  return calendar.records
    .filter(r => r.location === location)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
}

/** Zone contenant une académie donnée, `undefined` si elle est inconnue. */
export function zoneOfLocation(calendar: SchoolCalendar, location: string): string | undefined {
  return calendar.zones.find(z => z.locations.includes(location))?.zone
}

// L'export est un tableau nu ; l'extrait embarqué garde l'enveloppe `/records`.
function toRecords(raw: unknown): SchoolCalendarRecord[] {
  const rows = Array.isArray(raw) ? raw : (raw as { results?: unknown } | null)?.results
  return Array.isArray(rows) ? (rows as SchoolCalendarRecord[]) : []
}

function build(
  records: SchoolCalendarRecord[],
  source: SchoolCalendar['source'],
  error?: string,
): SchoolCalendar {
  return {
    records,
    zones: indexZones(records),
    schoolYears: [...new Set(records.map(r => r.annee_scolaire))].sort(),
    source,
    ...(error ? { error } : {}),
  }
}

let cached: SchoolCalendar | null = null
let inflight: Promise<SchoolCalendar> | null = null

async function download(): Promise<SchoolCalendar> {
  try {
    const res = await fetch(EXPORT_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const records = toRecords(await res.json())
    if (records.length === 0) throw new Error('export vide')
    return (cached = build(records, 'api'))
  } catch (e) {
    // Hors-ligne ou API indisponible : extrait embarqué (Réunion + Normandie,
    // 2025-2027). Volontairement pas mis en cache, pour qu'un nouvel essai
    // puisse retomber sur l'API.
    return build(toRecords(fallbackExtract), 'fallback', e instanceof Error ? e.message : String(e))
  }
}

/** Télécharge l'export complet (une seule fois par session). */
export function loadSchoolCalendar(): Promise<SchoolCalendar> {
  if (cached) return Promise.resolve(cached)
  if (!inflight) inflight = download().finally(() => { inflight = null })
  return inflight
}
