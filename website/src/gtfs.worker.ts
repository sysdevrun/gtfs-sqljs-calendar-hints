// Web Worker : gtfs-sqljs + findCalendarPeriods tournent hors du thread
// principal ; l'instance GTFS reste ici, l'UI ne reçoit que les résultats.
import { expose } from 'comlink'
import { GtfsSqlJs } from 'gtfs-sqljs'
import { createSqlJsAdapter } from 'gtfs-sqljs/adapters/sql-js'
import {
  findCalendarPeriods,
  type CalendarHintsOptions,
  type CalendarHintsResult,
  type Hint,
} from '../../src/calendar-hints'

export interface ProgressInfo {
  phase: string
  percentComplete: number
  message: string
  bytesDownloaded?: number
  totalBytes?: number
}

export interface FeedSummary {
  agencies: string[]
  tripCount: number
}

export interface GtfsWorkerAPI {
  loadFromUrl(url: string, onProgress: (p: ProgressInfo) => void): Promise<FeedSummary>
  loadFromData(data: ArrayBuffer, onProgress: (p: ProgressInfo) => void): Promise<FeedSummary>
  analyze(hints: Hint[], options: CalendarHintsOptions): Promise<CalendarHintsResult>
  close(): Promise<void>
}

// shapes.txt est inutile pour l'analyse de calendrier et souvent énorme
const SKIP_FILES = ['shapes.txt', 'fare_attributes.txt', 'fare_rules.txt', 'transfers.txt', 'pathways.txt']

async function makeAdapter() {
  return createSqlJsAdapter({
    locateFile: (filename: string) => {
      if (filename.endsWith('.wasm')) {
        const base = import.meta.env.BASE_URL || '/'
        return new URL(filename, new URL(base, self.location.origin)).href
      }
      return filename
    },
  })
}

class GtfsWorker implements GtfsWorkerAPI {
  private gtfs: GtfsSqlJs | null = null

  private async summarize(): Promise<FeedSummary> {
    const agencies = await this.gtfs!.getAgencies()
    const trips = await this.gtfs!.getTrips()
    return { agencies: agencies.map(a => a.agency_name), tripCount: trips.length }
  }

  async loadFromUrl(url: string, onProgress: (p: ProgressInfo) => void): Promise<FeedSummary> {
    await this.close()
    this.gtfs = await GtfsSqlJs.fromZip(url, {
      adapter: await makeAdapter(),
      skipFiles: SKIP_FILES,
      onProgress: p => onProgress({
        phase: p.phase,
        percentComplete: p.percentComplete,
        message: p.message,
        bytesDownloaded: p.bytesDownloaded,
        totalBytes: p.totalBytes,
      }),
    })
    return this.summarize()
  }

  async loadFromData(data: ArrayBuffer, onProgress: (p: ProgressInfo) => void): Promise<FeedSummary> {
    await this.close()
    this.gtfs = await GtfsSqlJs.fromZipData(data, {
      adapter: await makeAdapter(),
      skipFiles: SKIP_FILES,
      onProgress: p => onProgress({
        phase: p.phase,
        percentComplete: p.percentComplete,
        message: p.message,
      }),
    })
    return this.summarize()
  }

  async analyze(hints: Hint[], options: CalendarHintsOptions): Promise<CalendarHintsResult> {
    if (!this.gtfs) throw new Error('Aucun GTFS chargé')
    return findCalendarPeriods(this.gtfs, hints, options)
  }

  async close(): Promise<void> {
    if (this.gtfs) {
      await this.gtfs.close()
      this.gtfs = null
    }
  }
}

expose(new GtfsWorker())
