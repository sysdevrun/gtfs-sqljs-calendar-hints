// Réseaux prêts à charger en un clic. Les URLs GTFS proviennent des points
// d'accès officiels (transport.data.gouv.fr / Pysae / Cityway).
export type HolidayZone = 'metropole' | 'reunion'
export type Academy = 'Réunion' | 'Normandie'

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
