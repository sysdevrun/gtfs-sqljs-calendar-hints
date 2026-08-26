import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'
import { GtfsSqlJs } from 'gtfs-sqljs'
import { createSqlJsAdapter } from 'gtfs-sqljs/adapters/sql-js'
import { findCalendarPeriods, type Hint } from '../src/index'
import { makeStubSource, twoWeekSpec } from './helpers/stub-source'

// Ces tests valident le contrat structurel GtfsCalendarSource contre le VRAI
// gtfs-sqljs (les stubs ne détecteraient pas une dérive de son API) : les
// fixtures CSV de tests/fixtures/ sont zippées en mémoire puis chargées via
// l'adapter sql.js.

function fixtureZip(name: string, { bom = false } = {}): Uint8Array {
  const dir = fileURLToPath(new URL(`./fixtures/${name}/`, import.meta.url))
  const files: Record<string, Uint8Array> = {}
  for (const file of readdirSync(dir)) {
    const text = readFileSync(join(dir, file), 'utf8')
    files[file] = strToU8(bom ? '\uFEFF' + text : text)
  }
  return zipSync(files)
}

describe('integration: base feed through gtfs-sqljs', () => {
  // Miroir GTFS exact du feed de référence twoWeekSpec()
  const HOLIDAYS_HINT: Hint = { name: 'Jours fériés', policy: 'match-all', days: ['2026-01-07', '2026-01-14', '2026-06-01'] }
  let gtfs: GtfsSqlJs

  beforeAll(async () => {
    gtfs = await GtfsSqlJs.fromZipData(fixtureZip('base'), { adapter: await createSqlJsAdapter() })
  })
  afterAll(async () => {
    await gtfs.close()
  })

  it('classifies the feed like the unit tests (trip-ids)', async () => {
    const result = await findCalendarPeriods(gtfs, [HOLIDAYS_HINT])
    expect(result.firstDay).toBe('2026-01-05')
    expect(result.lastDay).toBe('2026-01-18')
    expect(result.hintResults[0].matched).toBe(true)
    expect(result.hintResults[0].groups[0].serviceIds).toEqual(['HOL'])
    expect(result.unclassified).toHaveLength(0)
    expect(result.periods).toHaveLength(4)
  })

  it('merges duplicated schedules in trip-content mode', async () => {
    const result = await findCalendarPeriods(gtfs, [HOLIDAYS_HINT], { signatureMode: 'trip-content' })
    expect(result.periods).toHaveLength(3)
    const merged = result.periods.find(p => p.labels.includes('Jours fériés'))
    expect(merged?.days).toEqual(['2026-01-07', '2026-01-11', '2026-01-14', '2026-01-18'])
  })

  it('produces results identical to the in-memory stub, in both modes', async () => {
    for (const signatureMode of ['trip-ids', 'trip-content'] as const) {
      const fromReal = await findCalendarPeriods(gtfs, [HOLIDAYS_HINT], { signatureMode })
      const fromStub = await findCalendarPeriods(makeStubSource(twoWeekSpec()), [HOLIDAYS_HINT], { signatureMode })
      expect(fromReal).toEqual(fromStub)
    }
  })
})

describe('integration: field-quirks feed (dates-only, BOM, alphabetical columns, ids with spaces)', () => {
  // 2 semaines scolaires (2026-01-05 → 2026-01-16) : services « service
  // semaine A » et « service semaine B » définis uniquement par exceptions
  // type 1, trips WA1/WB1 au contenu identique (pattern Pysae), week-end
  // du 10-11 sans aucun service.
  let gtfs: GtfsSqlJs

  beforeAll(async () => {
    gtfs = await GtfsSqlJs.fromZipData(fixtureZip('quirks', { bom: true }), { adapter: await createSqlJsAdapter() })
  })
  afterAll(async () => {
    await gtfs.close()
  })

  it('derives the range from type-1 dates only, keeping service ids with spaces', async () => {
    const result = await findCalendarPeriods(gtfs, [])
    expect(result.firstDay).toBe('2026-01-05')
    expect(result.lastDay).toBe('2026-01-16')
    expect(result.days).toHaveLength(12)
    expect(result.days[0].serviceIds).toEqual(['service semaine A'])
  })

  it('trip-ids: the two weeks stay distinct, the closed weekend merges into one period', async () => {
    const hints: Hint[] = [
      { name: 'Semaine A', policy: 'match-all', days: ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09'] },
      { name: 'Semaine B', policy: 'match-all', days: ['2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16'] },
    ]
    const result = await findCalendarPeriods(gtfs, hints)
    expect(result.hintResults.every(r => r.matched)).toBe(true)
    expect(result.periods).toHaveLength(3)
    const closed = result.periods.find(p => p.tripCount === 0)
    expect(closed?.days).toEqual(['2026-01-10', '2026-01-11'])

    // sans hints, en trip-ids, les deux semaines restent inclassables (2 groupes)
    const noHints = await findCalendarPeriods(gtfs, [])
    expect(noHints.unclassified.map(g => g.days.length)).toEqual([5, 5])
  })

  it('trip-content: duplicated schedules under different trip ids collapse into one period', async () => {
    const result = await findCalendarPeriods(gtfs, [], { signatureMode: 'trip-content' })
    expect(result.unclassified).toHaveLength(0)
    expect(result.periods).toHaveLength(2)
    const school = result.periods.find(p => p.tripCount === 1)
    expect(school?.days).toEqual([
      '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09',
      '2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16',
    ])
  })
})
