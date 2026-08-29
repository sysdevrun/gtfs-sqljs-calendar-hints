// Résultat de la détection automatique de la zone de vacances : académie du
// premier arrêt localisé → zone → tous les arrêts dans les académies de la
// zone (cf. academies.ts). Affiché dans la section « Vacances scolaires »,
// au-dessus des sélecteurs Zone/Académie qu'elle pilote.
import { DATASET_URL } from '../academies'
import type { AcademyZoneReport } from '../gtfs.worker'

export type ZoneDetectionState =
  | { kind: 'report'; report: AcademyZoneReport; source: 'api' | 'fallback'; sourceError?: string }
  | { kind: 'failed'; message: string }

interface Props {
  state: ZoneDetectionState
  /** `manual` : l'utilisateur a repris la main sur les sélecteurs. */
  academySource: 'auto' | 'manual'
  /** Un libellé de fériés a été ajusté en même temps que la zone (DOM). */
  holidayZoneLabel?: string
  onUseDetected: (academy: string) => void
}

const fmt = (n: number) => n.toLocaleString('fr-FR')

// « académie d'Amiens », « académie de Normandie », « académie de La Réunion ».
const deAcademy = (name: string) =>
  name === 'Réunion' ? 'de La Réunion' : /^[AEIOUÉÈÊÀÂÎÔ]/.test(name) ? `d'${name}` : `de ${name}`

export default function ZoneDetection({ state, academySource, holidayZoneLabel, onUseDetected }: Props) {
  if (state.kind === 'failed') {
    return (
      <div className="zone-detection detection-warn">
        <span className="badge badge-ko">Zone non détectée</span>{' '}
        Détection automatique indisponible : {state.message}. Choisissez la zone manuellement.
      </div>
    )
  }

  const { report, source, sourceError } = state
  const d = report.detection
  const datasetLink = (
    <a href={DATASET_URL} target="_blank" rel="noreferrer">fr-en-contour-academies-2020</a>
  )
  const fallbackNote = source === 'fallback' && (
    <p className="small muted">
      API des contours injoignable ({sourceError}) — extrait embarqué du dépôt, limité aux
      académies de Normandie et de La Réunion : la détection peut échouer à tort ailleurs.
    </p>
  )
  const ignoredNote = report.ignoredStops > 0 && (
    <p className="small muted">
      {fmt(report.ignoredStops)} arrêt{report.ignoredStops > 1 ? 's' : ''} aux coordonnées
      invalides (absentes, hors bornes ou 0,0), ignoré{report.ignoredStops > 1 ? 's' : ''}.
    </p>
  )

  if (d.status === 'no-stops') {
    return (
      <div className="zone-detection detection-neutral">
        <span className="badge badge-neutral">Zone non détectée</span>{' '}
        Le feed ne contient aucune position d'arrêt exploitable. Choisissez la zone manuellement.
        {ignoredNote}
      </div>
    )
  }

  if (d.status === 'outside-academies') {
    return (
      <div className="zone-detection detection-warn">
        <p>
          <span className="badge badge-ko">Zone non détectée</span>{' '}
          Aucune des positions d'arrêt sondées n'est dans une académie française
          (contours {datasetLink}) — feed hors de France ? Choisissez la zone manuellement.
        </p>
        {fallbackNote}
        {ignoredNote}
      </div>
    )
  }

  if (d.status === 'unknown-zone') {
    return (
      <div className="zone-detection detection-warn">
        <span className="badge badge-ko">Zone non détectée</span>{' '}
        L'académie {deAcademy(d.academy)} n'apparaît pas dans le calendrier scolaire chargé.
        Choisissez la zone manuellement.
      </div>
    )
  }

  if (d.status === 'outside-zone') {
    return (
      <div className="zone-detection detection-warn">
        <p>
          <span className="badge badge-ko">Zone non détectée</span>{' '}
          Premier arrêt localisé dans l'académie {deAcademy(d.academy)} ({d.zone}), mais{' '}
          {fmt(d.outsideCount)} des {fmt(d.pointCount)} positions d'arrêt sortent des académies
          de cette zone
          {d.otherAcademies.length > 0 && <> — certaines tombent dans : {d.otherAcademies.join(', ')}</>}
          {' '}(exemple : {d.sample.lat.toFixed(4)}, {d.sample.lon.toFixed(4)}).
          Le matching est strictement exact, sans seuil : choisissez la zone manuellement.
        </p>
        {fallbackNote}
        {ignoredNote}
      </div>
    )
  }

  // d.status === 'detected'
  const academies =
    d.academies.length === 1 ? (
      <>l'académie {deAcademy(d.academies[0].name)}</>
    ) : (
      <>les académies de la zone : {d.academies.map(a => `${a.name} (${fmt(a.points)})`).join(', ')}</>
    )

  if (academySource === 'manual') {
    return (
      <div className="zone-detection detection-neutral">
        <span className="badge badge-neutral">Détection automatique : {d.zone}</span>{' '}
        académie {deAcademy(d.academy)} — réglage manuel conservé.{' '}
        <button className="link-button" onClick={() => onUseDetected(d.academy)}>
          Revenir à la zone détectée
        </button>
      </div>
    )
  }

  return (
    <div className="zone-detection detection-ok">
      <p>
        <span className="badge badge-ok">Zone détectée automatiquement</span>{' '}
        <strong>{d.zone}</strong> — les {fmt(d.pointCount)} positions d'arrêt du feed
        ({fmt(report.totalStops)} arrêts) sont toutes dans {academies} (contours {datasetLink}).
        {holidayZoneLabel && <> Jours fériés réglés sur « {holidayZoneLabel} ».</>}
      </p>
      {fallbackNote}
      {ignoredNote}
    </div>
  )
}
