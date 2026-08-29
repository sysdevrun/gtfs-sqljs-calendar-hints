// Détection de la zone de jours fériés d'un feed par la position de ses
// arrêts. Le régime des fériés est défini par départements (57/67/68 pour
// l'Alsace-Moselle) et territoires ultramarins — les académies sont trop
// grossières : Nancy-Metz mélange la Moselle (régime local) et la
// Meurthe-et-Moselle (régime général).
//
// Contours : extrait embarqué `data/holiday-territories.json` (38 ko) des
// contours administratifs Etalab (dérivés d'Admin Express IGN, Licence
// Ouverte), simplifiés à 1000 m :
// https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2024/geojson/departements-1000m.geojson
// Seuls les 14 territoires à fériés spécifiques sont conservés — la métropole
// au régime général est le cas par défaut, aucun polygone nécessaire. Le
// fichier inclut la partie française de Saint-Martin (978) et les
// collectivités du Pacifique, absentes des contours d'académies.
//
// Règle, dans l'esprit strict de la librairie : tous les arrêts localisés en
// France dans un même régime, sinon détection refusée. Les arrêts hors de
// France sont ignorés — un tram vers Kehl ou Bâle ne porte pas de fériés
// français, et sans cette règle tous les réseaux frontaliers (précisément
// ceux d'Alsace-Moselle) échoueraient.
import {
  academyOf,
  contourOf,
  type AcademyContour,
  type AcademyContours,
  type StopPointSummary,
} from './academies'
import type { HolidayZone } from './presets'

/** Territoire à fériés spécifiques : `name` porte l'id de zone date-holidays
 *  (les trois départements d'Alsace-Moselle partagent le même). */
export type TerritoryContour = AcademyContour & { name: HolidayZone }

const ZONE_BY_CODE: Record<string, HolidayZone> = {
  '57': 'alsace-moselle',
  '67': 'alsace-moselle',
  '68': 'alsace-moselle',
  '971': 'guadeloupe',
  '972': 'martinique',
  '973': 'guyane',
  '974': 'reunion',
  '975': 'saint-pierre-et-miquelon',
  '976': 'mayotte',
  '977': 'saint-barthelemy',
  '978': 'saint-martin',
  '986': 'wallis-et-futuna',
  '987': 'polynesie',
  '988': 'nouvelle-caledonie',
}

// Les contours départementaux (1000 m) et les contours d'académies sont des
// simplifications différentes : près des côtes ou de la frontière, un point
// peut sortir du département tout en restant dans son académie. Quand
// l'académie implique sans ambiguïté un régime de fériés (DOM, Strasbourg =
// 67+68), on la laisse trancher plutôt que de compter à tort un point
// « régime général » et de déclarer le réseau mixte. Nancy-Metz reste
// ambiguë (57 vs 54/55/88) : régime général par défaut.
const ZONE_BY_ACADEMY: Record<string, HolidayZone> = {
  Guadeloupe: 'guadeloupe',
  Martinique: 'martinique',
  Guyane: 'guyane',
  'Réunion': 'reunion',
  Mayotte: 'mayotte',
  Strasbourg: 'alsace-moselle',
}

interface GeoJsonFeature {
  properties?: { code?: unknown }
  geometry?: { type?: unknown; coordinates?: unknown }
}

let cached: TerritoryContour[] | null = null

/** Charge l'extrait embarqué (import dynamique, une seule fois par session). */
export async function loadHolidayTerritories(): Promise<TerritoryContour[]> {
  if (cached) return cached
  const raw = (await import('../../data/holiday-territories.json')).default as {
    features?: GeoJsonFeature[]
  }
  const territories = (raw.features ?? [])
    .map(f => {
      const zone = ZONE_BY_CODE[String(f.properties?.code)]
      return zone ? (contourOf(zone, f.geometry) as TerritoryContour | null) : null
    })
    .filter((t): t is TerritoryContour => t !== null)
  if (territories.length === 0) throw new Error('holiday-territories.json sans contour exploitable')
  return (cached = territories)
}

export type HolidayDetection =
  /** Tous les arrêts localisés en France relèvent du même régime de fériés
   *  (`metropole` = aucun arrêt dans un territoire à fériés spécifiques). */
  | {
      status: 'detected'
      zone: HolidayZone
      /** Positions localisées en France (base de la décision). */
      locatedCount: number
      /** Positions hors de France, ignorées. */
      foreignCount: number
      pointCount: number
    }
  /** Le réseau chevauche plusieurs régimes : détection refusée. */
  | {
      status: 'mixed'
      counts: { zone: HolidayZone; points: number }[]
      foreignCount: number
      pointCount: number
    }
  /** Aucune position localisée en France (ou feed sans positions). */
  | { status: 'undetected'; foreignCount: number; pointCount: number }

export function detectHolidayZone(
  summary: StopPointSummary,
  territories: TerritoryContour[],
  academies: AcademyContours,
): HolidayDetection {
  const counts = new Map<HolidayZone, number>()
  let foreignCount = 0
  for (const p of summary.points) {
    const territory = academyOf(territories, p.lon, p.lat)
    let zone: HolidayZone | undefined = territory?.name as HolidayZone | undefined
    if (!zone) {
      const academy = academyOf(academies.academies, p.lon, p.lat)
      zone = academy ? (ZONE_BY_ACADEMY[academy.name] ?? 'metropole') : undefined
    }
    if (zone) counts.set(zone, (counts.get(zone) ?? 0) + 1)
    else foreignCount++
  }
  const pointCount = summary.points.length
  const zones = [...counts]
    .map(([zone, points]) => ({ zone, points }))
    .sort((a, b) => b.points - a.points)
  if (zones.length === 0) return { status: 'undetected', foreignCount, pointCount }
  if (zones.length > 1) return { status: 'mixed', counts: zones, foreignCount, pointCount }
  return {
    status: 'detected',
    zone: zones[0].zone,
    locatedCount: zones[0].points,
    foreignCount,
    pointCount,
  }
}
