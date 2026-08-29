// Contours officiels des académies — dataset `fr-en-contour-academies-2020`
// (DGESCO, Licence Ouverte 2.0) de data.education.gouv.fr :
// https://data.education.gouv.fr/explore/dataset/fr-en-contour-academies-2020/
//
// 30 académies (25 métropolitaines + Guadeloupe, Guyane, Martinique, Mayotte,
// La Réunion) en WGS84 — le même référentiel que `stop_lat`/`stop_lon` du
// GTFS. Comme pour le calendrier scolaire (school-calendar.ts), l'export est
// servi avec `Access-Control-Allow-Origin: *` : téléchargeable directement
// depuis le navigateur, sans proxy et sans en-tête sur la requête. Environ
// 545 ko gzippés sur le réseau (1,3 Mo décompressés), téléchargés à la
// première analyse seulement.
//
// Sert à détecter automatiquement la zone de vacances d'un feed : académie du
// premier arrêt localisé → zone (via le calendrier scolaire) → vérification
// que TOUS les arrêts sont dans l'union des académies de cette zone. Matching
// strictement exact, dans l'esprit de la librairie : un seul arrêt dehors
// (feed transfrontalier, arrêt côtier hors du contour simplifié…) et la
// détection est refusée — jamais de seuil.
import type { ZoneEntry } from './school-calendar'

export const DATASET_URL =
  'https://data.education.gouv.fr/explore/dataset/fr-en-contour-academies-2020/'
export const EXPORT_URL =
  'https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-contour-academies-2020/exports/geojson'

/** Anneau GeoJSON : liste de points `[lon, lat]`. */
type Ring = [number, number][]
/** Polygone GeoJSON : anneau extérieur puis trous éventuels. */
type PolygonRings = Ring[]

interface Bbox {
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
}

export interface AcademyContour {
  /** Nom aligné sur `location` du calendrier scolaire (« Réunion », jamais
   *  « La Réunion » comme dans le GeoJSON source). */
  name: string
  polygons: PolygonRings[]
  /** Englobant pré-calculé — évite le point-in-polygon complet dans 90 % des cas. */
  bbox: Bbox
}

export interface AcademyContours {
  academies: AcademyContour[]
  /** `fallback` : extrait embarqué du dépôt, l'API étant injoignable. */
  source: 'api' | 'fallback'
  /** Raison du repli sur l'extrait embarqué, le cas échéant. */
  error?: string
}

// Seule divergence de libellé entre les deux datasets. À noter aussi :
// le contour « Normandie » inclut Saint-Pierre-et-Miquelon (rattaché à cette
// académie), alors que l'archipel a son propre calendrier de vacances — un
// feed SPM serait détecté Zone B. Cas assez théorique pour être seulement
// documenté ici.
const CALENDAR_NAMES: Record<string, string> = { 'La Réunion': 'Réunion' }

// ---------------------------------------------------------------------------
// Géométrie : ray casting classique en pair-impair sur les coordonnées brutes
// (les contours ne croisent pas l'antiméridien). Sommer les traversées de
// tous les anneaux d'un polygone traite les trous naturellement : intérieur
// de l'anneau extérieur + intérieur d'un trou = nombre pair = dehors.
// ---------------------------------------------------------------------------
function ringCrossings(ring: Ring, lon: number, lat: number): number {
  let crossings = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) crossings++
  }
  return crossings
}

function polygonContains(polygon: PolygonRings, lon: number, lat: number): boolean {
  let crossings = 0
  for (const ring of polygon) crossings += ringCrossings(ring, lon, lat)
  return crossings % 2 === 1
}

export function academyContains(academy: AcademyContour, lon: number, lat: number): boolean {
  const { bbox } = academy
  if (lon < bbox.minLon || lon > bbox.maxLon || lat < bbox.minLat || lat > bbox.maxLat) return false
  return academy.polygons.some(p => polygonContains(p, lon, lat))
}

/** Première académie (ordre du dataset) contenant le point, sinon `undefined`. */
export function academyOf(
  academies: AcademyContour[],
  lon: number,
  lat: number,
): AcademyContour | undefined {
  return academies.find(a => academyContains(a, lon, lat))
}

// ---------------------------------------------------------------------------
// Chargement du dataset (même mécanique que school-calendar.ts).
// ---------------------------------------------------------------------------
interface GeoJsonFeature {
  properties?: { name?: unknown }
  geometry?: { type?: unknown; coordinates?: unknown }
}

/** Contour prêt pour `academyContains` (polygones + bbox) à partir d'une
 *  géométrie GeoJSON. Sert aussi aux territoires de fériés (holiday-zones.ts). */
export function contourOf(
  name: string,
  geometry: GeoJsonFeature['geometry'],
): AcademyContour | null {
  if (!geometry) return null
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates as PolygonRings]
      : geometry.type === 'MultiPolygon'
        ? (geometry.coordinates as PolygonRings[])
        : null
  if (!polygons) return null
  const bbox: Bbox = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity }
  for (const polygon of polygons) {
    for (const [lon, lat] of polygon[0] ?? []) {
      if (lon < bbox.minLon) bbox.minLon = lon
      if (lon > bbox.maxLon) bbox.maxLon = lon
      if (lat < bbox.minLat) bbox.minLat = lat
      if (lat > bbox.maxLat) bbox.maxLat = lat
    }
  }
  return { name, polygons, bbox }
}

function toContour(feature: GeoJsonFeature): AcademyContour | null {
  const name = feature.properties?.name
  if (typeof name !== 'string') return null
  return contourOf(CALENDAR_NAMES[name] ?? name, feature.geometry)
}

function toContours(raw: unknown, source: AcademyContours['source'], error?: string): AcademyContours {
  const features = (raw as { features?: unknown } | null)?.features
  const academies = (Array.isArray(features) ? (features as GeoJsonFeature[]) : [])
    .map(toContour)
    .filter((a): a is AcademyContour => a !== null)
  if (academies.length === 0) throw new Error('GeoJSON sans contour exploitable')
  return { academies, source, ...(error ? { error } : {}) }
}

let cached: AcademyContours | null = null
let inflight: Promise<AcademyContours> | null = null

async function download(): Promise<AcademyContours> {
  try {
    const res = await fetch(EXPORT_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (cached = toContours(await res.json(), 'api'))
  } catch (e) {
    // Hors-ligne ou API indisponible : extrait embarqué (Réunion + Normandie,
    // comme celui du calendrier scolaire), importé dynamiquement pour ne pas
    // alourdir le bundle de 69 ko. Volontairement pas mis en cache, pour
    // qu'un nouvel essai puisse retomber sur l'API.
    const fallback = (await import('../../data/academies.json')).default
    return toContours(fallback, 'fallback', e instanceof Error ? e.message : String(e))
  }
}

/** Télécharge les contours (une seule fois par session). */
export function loadAcademyContours(): Promise<AcademyContours> {
  if (cached) return Promise.resolve(cached)
  if (!inflight) inflight = download().finally(() => { inflight = null })
  return inflight
}

// ---------------------------------------------------------------------------
// Détection de la zone de vacances d'un feed.
// ---------------------------------------------------------------------------
export interface StopPoint {
  lon: number
  lat: number
}

/** Positions d'arrêt du feed : distinctes et aux coordonnées plausibles. */
export interface StopPointSummary {
  /** Nombre de lignes de stops.txt. */
  totalStops: number
  /** Coordonnées invalides (absentes, hors bornes, ou le placeholder 0,0). */
  ignoredStops: number
  points: StopPoint[]
}

export type AcademyDetection =
  /** Tous les arrêts sont dans les académies de la zone du premier arrêt localisé. */
  | {
      status: 'detected'
      zone: string
      /** Académie du premier arrêt localisé — celle à retenir comme `location`. */
      academy: string
      /** Répartition des positions par académie de la zone. */
      academies: { name: string; points: number }[]
      pointCount: number
    }
  /** Feed sans aucune position exploitable. */
  | { status: 'no-stops' }
  /** Aucune des positions sondées n'est dans une académie (feed hors de France ?). */
  | { status: 'outside-academies'; pointCount: number }
  /** Académie trouvée mais absente du calendrier scolaire chargé. */
  | { status: 'unknown-zone'; academy: string }
  /** Des arrêts sortent des académies de la zone candidate : détection refusée. */
  | {
      status: 'outside-zone'
      zone: string
      academy: string
      pointCount: number
      outsideCount: number
      /** Première position hors zone (pour situer le problème). */
      sample: StopPoint
      /** Académies d'autres zones contenant des positions sorties (échantillon). */
      otherAcademies: string[]
    }

// Le premier arrêt du feed peut avoir des coordonnées farfelues sans que le
// feed soit inanalysable : on sonde jusqu'à SEED_PROBE positions avant de
// conclure « hors académies ». Borne aussi le coût du cas « feed entièrement
// à l'étranger » (30 académies × ~2 000 sommets par position testée).
const SEED_PROBE = 50
// Localiser les positions sorties de la zone coûte un scan complet chacune :
// un échantillon suffit à nommer les académies voisines concernées.
const OUTSIDE_PROBE = 20

export function detectAcademyZone(
  summary: StopPointSummary,
  contours: AcademyContours,
  zones: ZoneEntry[],
): AcademyDetection {
  const { points } = summary
  if (points.length === 0) return { status: 'no-stops' }

  // 1. Académie du premier arrêt localisé.
  let seed: AcademyContour | undefined
  for (const p of points.slice(0, SEED_PROBE)) {
    seed = academyOf(contours.academies, p.lon, p.lat)
    if (seed) break
  }
  if (!seed) return { status: 'outside-academies', pointCount: points.length }

  // 2. Sa zone de vacances, via le calendrier scolaire. Les `locations` d'une
  //    zone peuvent contenir des académies sans contour (« Caen » et « Rouen »
  //    des années pré-fusion) : le contour « Normandie » couvre leur territoire.
  const zone = zones.find(z => z.locations.includes(seed.name))
  if (!zone) return { status: 'unknown-zone', academy: seed.name }
  const zoneAcademies = contours.academies.filter(a => zone.locations.includes(a.name))

  // 3. Tous les arrêts doivent être dans l'union des académies de la zone.
  const perAcademy = new Map<string, number>(zoneAcademies.map(a => [a.name, 0]))
  const outside: StopPoint[] = []
  for (const p of points) {
    const academy = academyOf(zoneAcademies, p.lon, p.lat)
    if (academy) perAcademy.set(academy.name, perAcademy.get(academy.name)! + 1)
    else outside.push(p)
  }
  if (outside.length > 0) {
    const otherAcademies = new Set<string>()
    for (const p of outside.slice(0, OUTSIDE_PROBE)) {
      const other = academyOf(contours.academies, p.lon, p.lat)
      if (other) otherAcademies.add(other.name)
    }
    return {
      status: 'outside-zone',
      zone: zone.zone,
      academy: seed.name,
      pointCount: points.length,
      outsideCount: outside.length,
      sample: outside[0],
      otherAcademies: [...otherAcademies].sort(),
    }
  }
  return {
    status: 'detected',
    zone: zone.zone,
    academy: seed.name,
    academies: [...perAcademy]
      .filter(([, n]) => n > 0)
      .map(([name, n]) => ({ name, points: n }))
      .sort((a, b) => b.points - a.points),
    pointCount: points.length,
  }
}
