import { useCallback, useMemo, useRef, useState } from 'react'
import { wrap, proxy, transfer, type Remote } from 'comlink'
import {
  GtfsSelector,
  fileTab,
  urlTab,
  transportDataGouvFr,
  mobilityDataCsv,
  type GtfsSelectionResult,
} from 'react-gtfs-selector'
import type { CalendarHintsOptions, CalendarHintsResult, SignatureMode } from '../../src/calendar-hints'
import type { GtfsWorkerAPI, ProgressInfo, FeedSummary } from './gtfs.worker'
import { proxyUrl } from './proxy'
import { PRESETS, type Academy, type HolidayZone, type NetworkPreset } from './presets'
import { generateHints, DEFAULT_HINT_CONFIGS, type GeneratedHints, type HintConfig } from './hints'
import {
  loadSchoolCalendar,
  recordsForLocation,
  zoneOfLocation,
  DATASET_URL,
  type SchoolCalendar,
} from './school-calendar'
import CodeSnippets from './components/CodeSnippets'
import ResultsView from './components/ResultsView'
import HintsView from './components/HintsView'
import HintsEditor from './components/HintsEditor'

interface Settings {
  zone: HolidayZone
  academy: Academy
  mode: SignatureMode
  firstDay: string
  lastDay: string
  hintConfigs: HintConfig[]
  /** Départ en vacances un mercredi ou un samedi : jour de vacances ? */
  includeWedSatStart: boolean
}

const SELECTOR_TABS = [fileTab, urlTab, transportDataGouvFr, mobilityDataCsv]

const DEFAULT_SETTINGS: Settings = {
  zone: 'metropole',
  academy: 'Normandie',
  mode: 'trip-content',
  firstDay: '',
  lastDay: '',
  hintConfigs: DEFAULT_HINT_CONFIGS,
  includeWedSatStart: true,
}

interface Analysis {
  result: CalendarHintsResult
  generated: GeneratedHints
  mode: SignatureMode
  /** Options réellement passées à `findCalendarPeriods` (pour les snippets). */
  options: CalendarHintsOptions
  durationMs: number
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'loading'; label: string; progress: ProgressInfo | null }
  | { kind: 'analyzing'; label: string }
  | { kind: 'ready'; label: string; summary: FeedSummary }
  | { kind: 'error'; label: string; message: string }

export default function App() {
  const workerRef = useRef<Remote<GtfsWorkerAPI> | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [calendar, setCalendar] = useState<SchoolCalendar | null>(null)
  const [calendarLoading, setCalendarLoading] = useState(false)
  const summaryRef = useRef<{ label: string; summary: FeedSummary } | null>(null)

  // `loadSchoolCalendar` garde l'export en cache : le bouton ne fait que
  // déclencher explicitement ce que l'analyse ferait de toute façon.
  const loadCalendar = useCallback(async () => {
    setCalendarLoading(true)
    try {
      setCalendar(await loadSchoolCalendar())
    } finally {
      setCalendarLoading(false)
    }
  }, [])

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      const worker = new Worker(new URL('./gtfs.worker.ts', import.meta.url), { type: 'module' })
      workerRef.current = wrap<GtfsWorkerAPI>(worker)
    }
    return workerRef.current
  }, [])

  const runAnalysis = useCallback(async (s: Settings) => {
    const worker = getWorker()
    const loaded = summaryRef.current
    if (!loaded) return
    setPhase({ kind: 'analyzing', label: loaded.label })
    setAnalysis(null)
    try {
      const clip = {
        ...(s.firstDay ? { firstDay: s.firstDay } : {}),
        ...(s.lastDay ? { lastDay: s.lastDay } : {}),
      }
      const started = performance.now()
      // Première passe légère pour connaître la plage du feed…
      const probe = await worker.analyze([], { signatureMode: 'trip-ids', ...clip })
      // …qui permet de générer les hints (fériés + vacances scolaires)…
      const schoolCalendar = await loadSchoolCalendar()
      setCalendar(schoolCalendar)
      const generated = await generateHints(
        s.zone,
        recordsForLocation(schoolCalendar, s.academy),
        probe.firstDay,
        probe.lastDay,
        s.hintConfigs,
        { includeWedSatStart: s.includeWedSatStart },
      )
      // …puis l'analyse complète dans le mode choisi.
      const options: CalendarHintsOptions = { signatureMode: s.mode, ...clip }
      const result = await worker.analyze(generated.hints, options)
      setAnalysis({ result, generated, mode: s.mode, options, durationMs: performance.now() - started })
      setPhase({ kind: 'ready', label: loaded.label, summary: loaded.summary })
    } catch (e) {
      setPhase({ kind: 'error', label: loaded.label, message: e instanceof Error ? e.message : String(e) })
    }
  }, [getWorker])

  const loadAndAnalyze = useCallback(async (
    label: string,
    load: (worker: Remote<GtfsWorkerAPI>, onProgress: (p: ProgressInfo) => void) => Promise<FeedSummary>,
    nextSettings: Settings,
  ) => {
    const worker = getWorker()
    setSettings(nextSettings)
    setAnalysis(null)
    summaryRef.current = null
    setPhase({ kind: 'loading', label, progress: null })
    try {
      const summary = await load(worker, p => {
        setPhase(current => (current.kind === 'loading' ? { ...current, progress: p } : current))
      })
      summaryRef.current = { label, summary }
      await runAnalysis(nextSettings)
    } catch (e) {
      setPhase({ kind: 'error', label, message: e instanceof Error ? e.message : String(e) })
    }
  }, [getWorker, runAnalysis])

  const loadPreset = useCallback((preset: NetworkPreset) => {
    void loadAndAnalyze(
      preset.name,
      (worker, onProgress) => worker.loadFromUrl(proxyUrl(preset.gtfsUrl), proxy(onProgress)),
      { ...settings, zone: preset.holidayZone, academy: preset.academy, firstDay: '', lastDay: '' },
    )
  }, [loadAndAnalyze, settings])

  const onSelect = useCallback((selection: GtfsSelectionResult) => {
    if (selection.type === 'file') {
      void loadAndAnalyze(
        selection.fileName,
        async (worker, onProgress) => {
          const buffer = await new Response(selection.blob).arrayBuffer()
          return worker.loadFromData(transfer(buffer, [buffer]), proxy(onProgress))
        },
        { ...settings, firstDay: '', lastDay: '' },
      )
    } else {
      void loadAndAnalyze(
        selection.title || selection.url,
        (worker, onProgress) => worker.loadFromUrl(proxyUrl(selection.url), proxy(onProgress)),
        { ...settings, firstDay: '', lastDay: '' },
      )
    }
  }, [loadAndAnalyze, settings])

  const busy = phase.kind === 'loading' || phase.kind === 'analyzing'
  const canAnalyze = summaryRef.current !== null && !busy

  const updateSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(s => ({ ...s, [key]: value }))
  }, [])

  const progressPercent = useMemo(() => {
    if (phase.kind !== 'loading' || !phase.progress) return null
    return Math.round(phase.progress.percentComplete)
  }, [phase])

  // La zone n'est pas un réglage à part : elle se déduit de l'académie choisie,
  // et la choisir revient à sélectionner la première académie qu'elle couvre.
  const schoolZone = calendar ? zoneOfLocation(calendar, settings.academy) ?? '' : ''
  const zoneLocations = calendar?.zones.find(z => z.zone === schoolZone)?.locations ?? []
  const selectSchoolZone = useCallback((zone: string) => {
    const first = calendar?.zones.find(z => z.zone === zone)?.locations[0]
    if (first) updateSetting('academy', first)
  }, [calendar, updateSetting])

  return (
    <div className="app">
      <header className="app-header">
        <h1>gtfs-calendar-hints</h1>
        <p>
          Détection des <strong>périodes de service</strong> d'un calendrier GTFS
          (« semaine scolaire », « vacances », « dimanches et fériés »…) par matching
          <strong> strictement exact</strong> contre des hints — jours fériés et vacances
          scolaires générés automatiquement. Tout tourne dans le navigateur
          (<a href="https://www.npmjs.com/package/gtfs-sqljs">gtfs-sqljs</a> + Web Worker),
          les GTFS sont téléchargés via le proxy CORS de SysDevRun.{' '}
          <a href="https://github.com/sysdevrun/gtfs-sqljs-calendar-hints">Code source</a>
        </p>
      </header>

      <section className="card">
        <h2>1. Choisir un GTFS</h2>
        <p className="muted">Réseaux prêts à l'emploi (chargés via le proxy) :</p>
        <div className="preset-grid">
          {PRESETS.map(preset => (
            <button
              key={preset.id}
              className="preset-button"
              disabled={busy}
              onClick={() => loadPreset(preset)}
            >
              <span className="preset-name">{preset.name}</span>
              <span className="preset-desc">{preset.description}</span>
            </button>
          ))}
        </div>
        <p className="muted">… ou n'importe quel GTFS (fichier, URL, recherche transport.data.gouv.fr) :</p>
        <GtfsSelector onSelect={onSelect} tabs={SELECTOR_TABS} />
      </section>

      <section className="card">
        <h2>2. Paramètres d'analyse</h2>
        <div className="settings-row">
          <label>
            Jours fériés
            <select value={settings.zone} disabled={busy}
              onChange={e => updateSetting('zone', e.target.value as HolidayZone)}>
              <option value="metropole">France métropolitaine</option>
              <option value="reunion">La Réunion (+ 20 décembre)</option>
            </select>
          </label>
          <label>
            Mode d'égalité
            <select value={settings.mode} disabled={busy}
              onChange={e => updateSetting('mode', e.target.value as SignatureMode)}>
              <option value="trip-content">trip-content (contenu des courses)</option>
              <option value="trip-ids">trip-ids (identifiants stricts)</option>
            </select>
          </label>
          <label>
            Du (optionnel)
            <input type="date" value={settings.firstDay} disabled={busy}
              onChange={e => updateSetting('firstDay', e.target.value)} />
          </label>
          <label>
            Au (optionnel)
            <input type="date" value={settings.lastDay} disabled={busy}
              onChange={e => updateSetting('lastDay', e.target.value)} />
          </label>
        </div>
        <h3>Vacances scolaires</h3>
        <div className="settings-row">
          <label>
            Départ un mercredi ou un samedi
            <select value={settings.includeWedSatStart ? 'include' : 'exclude'} disabled={busy}
              onChange={e => updateSetting('includeWedSatStart', e.target.value === 'include')}>
              <option value="include">jour de vacances (pas de cours ce jour-là)</option>
              <option value="exclude">jour de cours — vacances le lendemain</option>
            </select>
          </label>
        </div>
        <p className="small muted">
          Le calendrier officiel publie le jour du <em>départ</em> (dernière heure de cours) et
          celui de la <em>rentrée</em> : les vacances vont du lendemain du départ à la veille de
          la rentrée. Un départ publié un mercredi ou un samedi est, par défaut, déjà un jour de
          vacances — la plupart des élèves n'ont pas cours ce jour-là.
        </p>
        {!calendar ? (
          <div className="school-calendar">
            <p className="muted">
              Calendrier officiel{' '}
              <a href={DATASET_URL} target="_blank" rel="noreferrer">fr-en-calendrier-scolaire</a>{' '}
              (data.education.gouv.fr) : les trois zones de métropole, la Corse et l'outre-mer,
              avec toutes leurs académies. Environ 25 ko sur le réseau (550 ko une fois
              décompressés) — l'API autorise le CORS, aucun proxy n'est nécessaire.
            </p>
            <button
              className="hint-config-add"
              disabled={calendarLoading}
              onClick={() => void loadCalendar()}
            >
              {calendarLoading ? 'Téléchargement…' : 'Charger le calendrier scolaire'}
            </button>
          </div>
        ) : (
          <div className="school-calendar">
            <p className="muted">
              {calendar.source === 'api' ? (
                <>
                  <a href={DATASET_URL} target="_blank" rel="noreferrer">fr-en-calendrier-scolaire</a>{' '}
                  — {calendar.zones.length} zones,{' '}
                  {calendar.records.length.toLocaleString('fr-FR')} périodes,{' '}
                  {calendar.schoolYears[0]} → {calendar.schoolYears[calendar.schoolYears.length - 1]}.
                </>
              ) : (
                <>
                  API injoignable ({calendar.error}) — extrait embarqué du dépôt,
                  limité à {calendar.zones.map(z => z.zone).join(' et ')}.{' '}
                  <button className="link-button" onClick={() => void loadCalendar()} disabled={calendarLoading}>
                    {calendarLoading ? 'Téléchargement…' : 'Réessayer'}
                  </button>
                </>
              )}
            </p>
            <div className="settings-row">
              <label>
                Zone
                <select value={schoolZone} disabled={busy}
                  onChange={e => selectSchoolZone(e.target.value)}>
                  {schoolZone === '' && <option value="">— académie hors calendrier —</option>}
                  {calendar.zones.map(z => (
                    <option key={z.zone} value={z.zone}>
                      {z.zone}{z.locations.length > 1 ? ` (${z.locations.length} académies)` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Académie
                <select value={settings.academy} disabled={busy || zoneLocations.length <= 1}
                  onChange={e => updateSetting('academy', e.target.value as Academy)}>
                  {zoneLocations.length === 0 && <option value={settings.academy}>{settings.academy}</option>}
                  {zoneLocations.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
            </div>
            <p className="small muted">
              Toutes les académies d'une même zone partagent les mêmes dates — le choix
              ne change que l'étiquette, sauf pour les zones ultramarines qui ont leur
              propre calendrier.
            </p>
          </div>
        )}

        <h3>Hints</h3>
        <HintsEditor
          configs={settings.hintConfigs}
          disabled={busy}
          onChange={configs => updateSetting('hintConfigs', configs)}
        />
        <div className="settings-actions">
          <button className="analyze-button" disabled={!canAnalyze} onClick={() => void runAnalysis(settings)}>
            Relancer l'analyse
          </button>
        </div>
      </section>

      {phase.kind === 'loading' && (
        <section className="card status">
          <h2>Chargement de {phase.label}…</h2>
          <div className="progress-track">
            <div className="progress-bar" style={{ width: `${progressPercent ?? 0}%` }} />
          </div>
          <p className="muted">
            {phase.progress
              ? `${phase.progress.message} (${progressPercent}%)`
              : 'Téléchargement en cours…'}
          </p>
        </section>
      )}

      {phase.kind === 'analyzing' && (
        <section className="card status">
          <h2>Analyse de {phase.label}…</h2>
          <p className="muted">Calcul des signatures de chaque jour et matching des hints…</p>
        </section>
      )}

      {phase.kind === 'error' && (
        <section className="card error">
          <h2>Erreur — {phase.label}</h2>
          <p>{phase.message}</p>
        </section>
      )}

      {phase.kind === 'ready' && analysis && (
        <>
          <section className="card">
            <h2>{phase.label}</h2>
            <p className="muted">
              {phase.summary.agencies.join(', ')} — {phase.summary.tripCount.toLocaleString('fr-FR')} courses —{' '}
              analysé en {Math.round(analysis.durationMs)} ms (mode {analysis.mode})
            </p>
            <HintsView generated={analysis.generated} />
          </section>
          <ResultsView result={analysis.result} generated={analysis.generated} />
          <CodeSnippets
            generated={analysis.generated}
            options={analysis.options}
            result={analysis.result}
            feedLabel={phase.label}
          />
        </>
      )}
    </div>
  )
}
