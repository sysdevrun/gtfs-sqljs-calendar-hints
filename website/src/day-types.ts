// Types de jour = signatures. Deux jours partagent une signature quand ils
// font tourner exactement les mêmes courses ; la librairie la calcule déjà
// pour chaque jour de la plage (`result.days[].signature`), les périodes en
// sont la fusion. On y accroche ici un style stable (couleur + motif) pour
// peindre le calendrier et sa légende.
import type { CalendarHintsResult, Period } from '../../src/calendar-hints'

// La librairie produit des libellés en anglais ; on les traduit à l'affichage.
// « Remaining days — lundis » est réduit au seul nom du jour.
const LABEL_FR: [string, string][] = [
  ['Remaining days — ', ''],
  ['Remaining days', 'Jours restants'],
  ['Mondays', 'lundis'],
  ['Tuesdays', 'mardis'],
  ['Wednesdays', 'mercredis'],
  ['Thursdays', 'jeudis'],
  ['Fridays', 'vendredis'],
  ['Saturdays', 'samedis'],
  ['Sundays', 'dimanches'],
]

export function frLabel(label: string): string {
  return LABEL_FR.reduce((s, [en, fr]) => s.replaceAll(en, fr), label)
}

// Libellé d'une période : les labels « Hint — Mondays + Hint — Tuesdays + … »
// issus de la politique per-day-of-week sont regroupés par hint — les jours
// d'abord, le nom du hint entre parenthèses : « Du lundi au samedi (Vacances
// scolaires) » — et les jours consécutifs condensés en « du … au … ».
// Semaine à la française, lundi en tête.
const WEEKDAYS_EN = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']
const WEEKDAYS_FR = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

function frWeekdays(indices: number[]): string {
  const sorted = [...new Set(indices)].sort((a, b) => a - b)
  const runs: number[][] = []
  for (const i of sorted) {
    const run = runs[runs.length - 1]
    if (run && i === run[run.length - 1] + 1) run.push(i)
    else runs.push([i])
  }
  return runs
    .map(run => {
      if (run.length === 7) return 'tous les jours'
      if (run.length >= 3) return `du ${WEEKDAYS_FR[run[0]]} au ${WEEKDAYS_FR[run[run.length - 1]]}`
      return run.map(i => `${WEEKDAYS_FR[i]}s`).join(' + ')
    })
    .join(' + ')
}

export function periodLabel(labels: string[]): string {
  // Groupes dans l'ordre de première apparition ; ceux issus d'un même hint
  // per-day-of-week (même préfixe avant « — jour ») fusionnent leurs jours.
  const groups: { prefix: string | null; weekdays: number[] }[] = []
  const byPrefix = new Map<string, { prefix: string | null; weekdays: number[] }>()
  for (const label of labels) {
    const sep = label.lastIndexOf(' — ')
    const weekday = sep >= 0 ? WEEKDAYS_EN.indexOf(label.slice(sep + 3)) : -1
    if (weekday < 0) {
      groups.push({ prefix: frLabel(label), weekdays: [] })
      continue
    }
    // « Remaining days — lundis » s'affiche sans préfixe, comme frLabel
    const prefix = label.slice(0, sep) === 'Remaining days' ? null : frLabel(label.slice(0, sep))
    let group = byPrefix.get(prefix ?? '')
    if (!group) {
      group = { prefix, weekdays: [] }
      byPrefix.set(prefix ?? '', group)
      groups.push(group)
    }
    group.weekdays.push(weekday)
  }
  const label = groups
    .map(g => {
      if (g.weekdays.length === 0) return g.prefix
      const days = frWeekdays(g.weekdays)
      return g.prefix === null ? days : `${days} (${g.prefix})`
    })
    .join(' + ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

// Palette stable ; quand elle boucle, le motif change — 12 × 4 = 48 styles
// distincts avant répétition, largement au-delà du nombre de signatures d'un
// feed réel.
export const DAY_TYPE_COLORS = [
  '#2563eb', '#16a34a', '#ea580c', '#9333ea', '#0891b2', '#ca8a04',
  '#dc2626', '#4f46e5', '#059669', '#d97706', '#db2777', '#65a30d',
]
const MOTIF_COUNT = 4

/** 0 = aplat, 1 = hachures ↗, 2 = hachures ↘, 3 = croisillons */
export interface DayTypeStyle {
  color: string
  motif: number
}

export function styleOf(index: number): DayTypeStyle {
  return {
    color: DAY_TYPE_COLORS[index % DAY_TYPE_COLORS.length],
    motif: Math.floor(index / DAY_TYPE_COLORS.length) % MOTIF_COUNT,
  }
}

/** Fond CSS d'un style : les hachures restent assez sombres pour le texte blanc. */
export function dayTypeBackground({ color, motif }: DayTypeStyle): string {
  const dark = `color-mix(in srgb, ${color} 62%, #000)`
  switch (motif) {
    case 1:
      return `repeating-linear-gradient(45deg, ${color} 0 4px, ${dark} 4px 8px)`
    case 2:
      return `repeating-linear-gradient(-45deg, ${color} 0 4px, ${dark} 4px 8px)`
    case 3:
      return `repeating-linear-gradient(45deg, ${dark} 0 2px, transparent 2px 7px), ` +
        `repeating-linear-gradient(-45deg, ${dark} 0 2px, transparent 2px 7px), ` +
        `linear-gradient(${color}, ${color})`
    default:
      return color
  }
}

export interface DayType {
  signature: string
  style: DayTypeStyle
  /** Libellés des périodes qui portent cette signature, ou « non classé » */
  label: string
  /** Jours de la plage analysée portant cette signature */
  dayCount: number
  /** Parmi eux, ceux qu'aucun hint n'a classés */
  unclassifiedCount: number
  tripCount: number
  serviceIds: string[]
}

export interface DayTypes {
  /** Ordre d'affichage = ordre d'attribution des styles */
  list: DayType[]
  bySignature: Map<string, DayType>
  /** Dates qu'aucun hint n'a classées (liseré pointillé sur le calendrier) */
  unclassifiedDates: Set<string>
}

export function buildDayTypes(result: CalendarHintsResult, orderedPeriods: Period[]): DayTypes {
  const dayCounts = new Map<string, number>()
  for (const d of result.days) dayCounts.set(d.signature, (dayCounts.get(d.signature) ?? 0) + 1)

  const unclassifiedDates = new Set<string>()
  for (const g of result.unclassified) for (const d of g.days) unclassifiedDates.add(d)

  // Les périodes d'abord, dans l'ordre des hints (les cartes de la synthèse
  // gardent ainsi leurs couleurs), puis les signatures qui n'existent que
  // parmi les jours non classés, les plus fréquentes d'abord. Une même
  // signature peut être les deux : matchée ici, restée non classée ailleurs.
  const signatures = orderedPeriods.map(p => p.signature)
  const fromPeriods = new Set(signatures)
  signatures.push(
    ...[...dayCounts.keys()]
      .filter(s => !fromPeriods.has(s))
      .sort((a, b) => dayCounts.get(b)! - dayCounts.get(a)! || a.localeCompare(b)),
  )

  const periodBySignature = new Map(orderedPeriods.map(p => [p.signature, p]))
  const unclassifiedBySignature = new Map(result.unclassified.map(g => [g.signature, g]))
  const list: DayType[] = signatures.map((signature, i) => {
    const period = periodBySignature.get(signature)
    const group = unclassifiedBySignature.get(signature)
    return {
      signature,
      style: styleOf(i),
      label: period ? periodLabel(period.labels) : 'non classé',
      dayCount: dayCounts.get(signature) ?? 0,
      unclassifiedCount: group?.days.length ?? 0,
      tripCount: period?.tripCount ?? group?.tripCount ?? 0,
      serviceIds: period?.serviceIds ?? group?.serviceIds ?? [],
    }
  })

  return { list, bySignature: new Map(list.map(t => [t.signature, t])), unclassifiedDates }
}
