import { useMemo } from 'react'
import type { CalendarHintsResult } from '../../../src/calendar-hints'
import { frLabel } from './ResultsView'

const MONTHS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]
const DAY_HEADERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

interface DayCell {
  date: string
  color: string | null // null = jour non classé (hachuré)
  label: string
  tripCount: number
}

interface Month {
  key: string
  title: string
  /** Cases du lundi au dimanche, null = hors plage ou hors mois */
  cells: (DayCell | null)[]
}

export default function CalendarGrid({ result, colors }: { result: CalendarHintsResult; colors: string[] }) {
  const months = useMemo<Month[]>(() => {
    const byDate = new Map<string, DayCell>()
    result.periods.forEach((p, i) => {
      const color = colors[i % colors.length]
      const label = p.labels.map(frLabel).join(' + ')
      for (const d of p.days) {
        const info = result.days.find(x => x.date === d)
        byDate.set(d, { date: d, color, label, tripCount: info?.tripCount ?? 0 })
      }
    })
    for (const g of result.unclassified) {
      for (const d of g.days) {
        byDate.set(d, { date: d, color: null, label: 'non classé', tripCount: g.tripCount })
      }
    }
    // Les jours dans la plage mais absents des deux listes (ne devrait pas
    // arriver) restent visibles en gris neutre
    for (const d of result.days) {
      if (!byDate.has(d.date)) {
        byDate.set(d.date, { date: d.date, color: '#9ca3af', label: '?', tripCount: d.tripCount })
      }
    }

    const months: Month[] = []
    let current: Month | null = null
    for (const day of result.days) {
      const [y, m, dayNum] = [day.date.slice(0, 4), Number(day.date.slice(5, 7)), Number(day.date.slice(8, 10))]
      const key = `${y}-${m}`
      if (!current || current.key !== key) {
        current = { key, title: `${MONTHS_FR[m - 1]} ${y}`, cells: [] }
        months.push(current)
        // caler le 1er jour affiché sur sa colonne lundi-dimanche
        const weekday = new Date(day.date + 'T00:00:00Z').getUTCDay() // 0=dimanche
        const mondayIndex = (weekday + 6) % 7
        for (let i = 0; i < mondayIndex; i++) current.cells.push(null)
      }
      void dayNum
      current.cells.push(byDate.get(day.date)!)
    }
    return months
  }, [result, colors])

  return (
    <div className="calendar-grid">
      {months.map(month => (
        <div key={month.key} className="calendar-month">
          <div className="calendar-month-title">{month.title}</div>
          <div className="calendar-days">
            {DAY_HEADERS.map((h, i) => (
              <div key={i} className="calendar-day-header">{h}</div>
            ))}
            {month.cells.map((cell, i) =>
              cell ? (
                <div
                  key={cell.date}
                  className={`calendar-day ${cell.color === null ? 'calendar-day-unclassified' : ''}`}
                  style={cell.color ? { backgroundColor: cell.color } : undefined}
                  title={`${cell.date} — ${cell.label} — ${cell.tripCount} courses`}
                >
                  {Number(cell.date.slice(8, 10))}
                </div>
              ) : (
                <div key={`empty-${i}`} className="calendar-day calendar-day-empty" />
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
