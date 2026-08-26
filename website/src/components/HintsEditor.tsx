// Éditeur de la liste des hints : réordonnancement (l'ordre compte, chaque
// hint consomme ses jours), activation, renommage, politique, et ajout de
// hints personnalisés (dates ou plages saisies à la main).
import type { Policy } from '../../../src/calendar-hints'
import { parseDaysText, type HintConfig } from '../hints'

const SOURCE_LABELS: Record<HintConfig['source'], string> = {
  holidays: 'jours fériés (auto)',
  'school-vacations': 'vacances scolaires (auto)',
  custom: 'dates personnalisées',
}

let nextCustomId = 1

interface Props {
  configs: HintConfig[]
  disabled: boolean
  onChange: (configs: HintConfig[]) => void
}

export default function HintsEditor({ configs, disabled, onChange }: Props) {
  const update = (id: string, patch: Partial<HintConfig>) =>
    onChange(configs.map(c => (c.id === id ? { ...c, ...patch } : c)))

  const move = (index: number, delta: number) => {
    const next = [...configs]
    const [moved] = next.splice(index, 1)
    next.splice(index + delta, 0, moved)
    onChange(next)
  }

  const addCustom = () =>
    onChange([
      ...configs,
      {
        id: `custom-${nextCustomId++}-${Date.now()}`,
        source: 'custom',
        name: `Hint personnalisé ${configs.filter(c => c.source === 'custom').length + 1}`,
        policy: 'match-all',
        enabled: true,
        daysText: '',
      },
    ])

  return (
    <div className="hints-editor">
      <p className="muted small">
        Les hints sont appliqués <strong>dans l'ordre</strong> : chaque jour matché est consommé
        et n'est plus disponible pour les hints suivants. Modifiez la liste puis relancez l'analyse.
      </p>
      <ol className="hint-config-list">
        {configs.map((c, i) => {
          const parsed = c.source === 'custom' ? parseDaysText(c.daysText) : null
          return (
            <li key={c.id} className={`hint-config ${c.enabled ? '' : 'hint-config-disabled'}`}>
              <div className="hint-config-main">
                <span className="hint-config-order">
                  <button type="button" title="Monter" disabled={disabled || i === 0}
                    onClick={() => move(i, -1)}>▲</button>
                  <button type="button" title="Descendre" disabled={disabled || i === configs.length - 1}
                    onClick={() => move(i, +1)}>▼</button>
                </span>
                <label className="hint-config-enabled" title={c.enabled ? 'Désactiver ce hint' : 'Activer ce hint'}>
                  <input type="checkbox" checked={c.enabled} disabled={disabled}
                    onChange={e => update(c.id, { enabled: e.target.checked })} />
                </label>
                <input className="hint-config-name" type="text" value={c.name} disabled={disabled}
                  onChange={e => update(c.id, { name: e.target.value })} />
                <span className="badge badge-neutral">{SOURCE_LABELS[c.source]}</span>
                <select value={c.policy} disabled={disabled}
                  onChange={e => update(c.id, { policy: e.target.value as Policy })}>
                  <option value="match-all">match-all (tous les jours identiques)</option>
                  <option value="per-day-of-week">per-day-of-week (par jour de semaine)</option>
                </select>
                {c.source === 'custom' && (
                  <button type="button" className="hint-config-remove" disabled={disabled}
                    onClick={() => onChange(configs.filter(x => x.id !== c.id))}>
                    Supprimer
                  </button>
                )}
              </div>
              {c.source === 'custom' && (
                <div className="hint-config-days">
                  <textarea rows={2} value={c.daysText} disabled={disabled}
                    placeholder="Dates ou plages, ex. : 2026-05-01, 2026-07-06..2026-08-31"
                    onChange={e => update(c.id, { daysText: e.target.value })} />
                  <div className="muted small">
                    {parsed!.days.length} jour{parsed!.days.length > 1 ? 's' : ''}
                    {parsed!.invalid.length > 0 && (
                      <span className="hint-config-invalid">
                        {' '}— ignoré{parsed!.invalid.length > 1 ? 's' : ''} : {parsed!.invalid.join(', ')}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ol>
      <button type="button" className="hint-config-add" disabled={disabled} onClick={addCustom}>
        + Ajouter un hint personnalisé
      </button>
    </div>
  )
}
