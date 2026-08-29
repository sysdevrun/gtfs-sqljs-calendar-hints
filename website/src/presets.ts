// Réseaux prêts à charger en un clic. Les URLs GTFS proviennent des points
// d'accès officiels (transport.data.gouv.fr / Pysae / Cityway).
export type HolidayZone =
  | 'metropole'
  | 'alsace-moselle'
  | 'guadeloupe'
  | 'martinique'
  | 'guyane'
  | 'reunion'
  | 'mayotte'
  | 'saint-martin'
  | 'saint-barthelemy'
  | 'saint-pierre-et-miquelon'
  | 'polynesie'
  | 'nouvelle-caledonie'
  | 'wallis-et-futuna'

export interface HolidayZoneDef {
  id: HolidayZone
  /** Libellé du sélecteur — fériés spécifiques entre parenthèses. */
  label: string
  /** Arguments du constructeur date-holidays (pays, puis état éventuel). */
  country: string
  state?: string
}

// Toutes les zones françaises connues de date-holidays. L'Alsace-Moselle y est
// découpée en trois départements (57/67/68) aux fériés identiques — une seule
// entrée ici ; Polynésie, Nouvelle-Calédonie, Wallis-et-Futuna et
// Saint-Pierre-et-Miquelon y sont modélisés comme des pays à part entière.
export const HOLIDAY_ZONES: HolidayZoneDef[] = [
  { id: 'metropole', label: 'France métropolitaine', country: 'FR' },
  { id: 'alsace-moselle', label: 'Alsace-Moselle (+ Vendredi saint, 26 décembre)', country: 'FR', state: '57' },
  { id: 'guadeloupe', label: 'Guadeloupe (+ Vendredi saint, 27 mai)', country: 'FR', state: 'GP' },
  { id: 'martinique', label: 'Martinique (+ Vendredi saint, 22 mai)', country: 'FR', state: 'MQ' },
  { id: 'guyane', label: 'Guyane (+ 10 juin)', country: 'FR', state: 'GF' },
  { id: 'reunion', label: 'La Réunion (+ 20 décembre)', country: 'FR', state: 'RE' },
  { id: 'mayotte', label: 'Mayotte (+ 27 avril)', country: 'FR', state: 'YT' },
  { id: 'saint-martin', label: 'Saint-Martin (+ 27 mai)', country: 'FR', state: 'MF' },
  { id: 'saint-barthelemy', label: 'Saint-Barthélemy (+ 9 octobre)', country: 'FR', state: 'BL' },
  { id: 'saint-pierre-et-miquelon', label: 'Saint-Pierre-et-Miquelon', country: 'PM' },
  { id: 'polynesie', label: 'Polynésie française (+ 5 mars, Matariʻi…)', country: 'PF' },
  { id: 'nouvelle-caledonie', label: 'Nouvelle-Calédonie (+ 24 septembre)', country: 'NC' },
  { id: 'wallis-et-futuna', label: 'Wallis-et-Futuna (+ 28 avril, 29 juin, 29 juillet)', country: 'WF' },
]
/** `location` du dataset fr-en-calendrier-scolaire : « Réunion », « Normandie »,
 *  « Rennes », « Créteil »… La liste réelle vient du fichier téléchargé. */
export type Academy = string

export interface NetworkPreset {
  id: string
  name: string
  description: string
  gtfsUrl: string
  holidayZone: HolidayZone
  academy: Academy
}

export const PRESETS: NetworkPreset[] = [
  {
    id: 'car-jaune',
    name: 'Car Jaune',
    description: 'Cars interurbains — La Réunion',
    gtfsUrl: 'https://pysae.com/api/v2/groups/car-jaune/gtfs/pub',
    holidayZone: 'reunion',
    academy: 'Réunion',
  },
  {
    id: 'kar-ouest',
    name: "Kar'Ouest",
    description: 'Réseau urbain du TCO — La Réunion',
    gtfsUrl: 'https://www.data.gouv.fr/api/1/datasets/r/c9c2f609-d0cd-4233-ad1b-cf86b9bf2dc8',
    holidayZone: 'reunion',
    academy: 'Réunion',
  },
  {
    id: 'citalis',
    name: 'Citalis',
    description: 'Réseau urbain de la CINOR — La Réunion',
    gtfsUrl: 'https://pysae.com/api/v2/groups/citalis/gtfs/pub',
    holidayZone: 'reunion',
    academy: 'Réunion',
  },
  {
    id: 'estival',
    name: 'Estival',
    description: 'Réseau urbain de la CIREST — La Réunion',
    gtfsUrl: 'https://www.data.gouv.fr/api/1/datasets/r/3b659ebb-8c17-46f4-a8ac-78c4129a4a29',
    holidayZone: 'reunion',
    academy: 'Réunion',
  },
  {
    id: 'carsud',
    name: 'CarSud',
    description: 'Réseau urbain de la CASud — La Réunion',
    gtfsUrl: 'https://www.data.gouv.fr/api/1/datasets/r/8f3642e3-9fc3-45ed-af46-8c532966ace3',
    holidayZone: 'reunion',
    academy: 'Réunion',
  },
  {
    id: 'astuce',
    name: 'Astuce (Rouen)',
    description: 'Réseau de la métropole Rouen Normandie',
    gtfsUrl: 'https://api.mrn.cityway.fr/dataflow/offre-tc/download?provider=ASTUCE&dataFormat=gtfs&dataProfil=ASTUCE',
    holidayZone: 'metropole',
    academy: 'Normandie',
  },
]
