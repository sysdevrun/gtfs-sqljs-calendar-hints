// Résultat de la détection automatique de la zone de jours fériés (régime
// général, Alsace-Moselle, DOM/COM — cf. holiday-zones.ts). Affiché sous le
// sélecteur « Jours fériés » qu'elle pilote.
import { HOLIDAY_ZONES, type HolidayZone } from '../presets'
import type { HolidayZoneReport } from '../gtfs.worker'

export type HolidayDetectionState =
  | { kind: 'report'; report: HolidayZoneReport }
  | { kind: 'failed'; message: string }

interface Props {
  state: HolidayDetectionState
  /** `manual` : l'utilisateur a repris la main sur le sélecteur. */
  source: 'auto' | 'manual'
  onUseDetected: (zone: HolidayZone) => void
}

const fmt = (n: number) => n.toLocaleString('fr-FR')
const labelOf = (zone: HolidayZone) => HOLIDAY_ZONES.find(z => z.id === zone)?.label ?? zone

export default function HolidayDetection({ state, source, onUseDetected }: Props) {
  if (state.kind === 'failed') {
    return (
      <div className="zone-detection detection-warn">
        <span className="badge badge-ko">Fériés non détectés</span>{' '}
        Détection automatique indisponible : {state.message}. Choisissez la zone manuellement.
      </div>
    )
  }

  const d = state.report.detection
  const foreignNote =
    'foreignCount' in d && d.foreignCount > 0 ? (
      <> {fmt(d.foreignCount)} position{d.foreignCount > 1 ? 's' : ''} hors de France
      ignorée{d.foreignCount > 1 ? 's' : ''} (elles ne portent pas de fériés français).</>
    ) : null

  if (d.status === 'undetected') {
    return (
      <div className="zone-detection detection-neutral">
        <span className="badge badge-neutral">Fériés non détectés</span>{' '}
        Aucune position d'arrêt localisée en France. Choisissez la zone manuellement.
        {foreignNote}
      </div>
    )
  }

  if (d.status === 'mixed') {
    return (
      <div className="zone-detection detection-warn">
        <span className="badge badge-ko">Fériés non détectés</span>{' '}
        Le réseau chevauche plusieurs régimes de jours fériés :{' '}
        {d.counts.map(c => `${labelOf(c.zone)} (${fmt(c.points)} positions)`).join(', ')}.
        Aucune configuration unique n'est juste — choisissez la zone manuellement.
        {foreignNote}
      </div>
    )
  }

  // d.status === 'detected'
  if (source === 'manual') {
    return (
      <div className="zone-detection detection-neutral">
        <span className="badge badge-neutral">Détection automatique : {labelOf(d.zone)}</span>{' '}
        réglage manuel conservé.{' '}
        <button className="link-button" onClick={() => onUseDetected(d.zone)}>
          Revenir aux fériés détectés
        </button>
      </div>
    )
  }

  return (
    <div className="zone-detection detection-ok">
      <span className="badge badge-ok">Fériés détectés automatiquement</span>{' '}
      <strong>{labelOf(d.zone)}</strong> —{' '}
      {d.zone === 'metropole' ? (
        <>aucune des {fmt(d.locatedCount)} positions d'arrêt localisées n'est dans un
        territoire à fériés spécifiques.</>
      ) : d.zone === 'alsace-moselle' ? (
        <>les {fmt(d.locatedCount)} positions d'arrêt localisées en France sont toutes
        dans les départements 57, 67 ou 68.</>
      ) : (
        <>les {fmt(d.locatedCount)} positions d'arrêt localisées en France sont toutes
        dans ce territoire.</>
      )}
      {foreignNote}
      {' '}<span className="muted">(contours administratifs Etalab / Admin Express IGN)</span>
    </div>
  )
}
