import { useMemo } from 'react'
import type { CalendarHintsResult } from '../../../src/calendar-hints'
import { dayTypeBackground, type DayType, type DayTypes } from '../day-types'

const MONTHS_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]
const DAY_HEADERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

interface DayCell {
  date: string
  type: DayType
  /** Aucun hint (ni la passe finale par jour de semaine) n'a classé ce jour */
  unclassified: boolean
  /** Jour férié : astérisque à côté du numéro */
  holiday: boolean
  /** Vacances scolaires (hors dimanche) : numéro souligné */
  vacation: boolean
}

interface Month {
  key: string
  title: string
  /** Cases du lundi au dimanche, null = hors plage ou hors mois */
  cells: (DayCell | null)[]
}

export default function CalendarGrid({ result, dayTypes, holidays, vacationDays }: {
  result: CalendarHintsResult
  dayTypes: DayTypes
  /** Dates ISO des jours fériés */
  holidays: Set<string>
  /** Dates ISO des jours de vacances scolaires, dimanches exclus */
  vacationDays: Set<string>
}) {
  const months = useMemo<Month[]>(() => {
    const months: Month[] = []
    let current: Month | null = null
    for (const day of result.days) {
      const [y, m] = [day.date.slice(0, 4), Number(day.date.slice(5, 7))]
      const key = `${y}-${m}`
      if (!current || current.key !== key) {
        current = { key, title: `${MONTHS_FR[m - 1]} ${y}`, cells: [] }
        months.push(current)
        // caler le 1er jour affiché sur sa colonne lundi-dimanche
        const weekday = new Date(day.date + 'T00:00:00Z').getUTCDay() // 0=dimanche
        const mondayIndex = (weekday + 6) % 7
        for (let i = 0; i < mondayIndex; i++) current.cells.push(null)
      }
      current.cells.push({
        date: day.date,
        type: dayTypes.bySignature.get(day.signature)!,
        unclassified: dayTypes.unclassifiedDates.has(day.date),
        holiday: holidays.has(day.date),
        vacation: vacationDays.has(day.date),
      })
    }
    return months
  }, [result, dayTypes, holidays, vacationDays])

  return (
    <>
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
                    className={`calendar-day ${cell.unclassified ? 'calendar-day-unclassified' : ''}`}
                    style={{ background: dayTypeBackground(cell.type.style) }}
                    title={
                      `${cell.date} — ${cell.type.label} — ${cell.type.tripCount} courses` +
                      `${cell.holiday ? ' — férié' : ''}` +
                      `${cell.vacation ? ' — vacances scolaires' : ''}` +
                      `${cell.unclassified && cell.type.label !== 'non classé' ? ' (jour non classé)' : ''}` +
                      ` — signature ${cell.type.signature}`
                    }
                  >
                    <span className={cell.vacation ? 'calendar-day-vacation' : undefined}>
                      {Number(cell.date.slice(8, 10))}
                    </span>
                    {cell.holiday && '*'}
                  </div>
                ) : (
                  <div key={`empty-${i}`} className="calendar-day calendar-day-empty" />
                ),
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="calendar-marks-legend muted small">
        <span><span className="calendar-mark-sample calendar-day-vacation">15</span> vacances scolaires (hors dimanche)</span>
        <span><span className="calendar-mark-sample">15*</span> jour férié</span>
      </div>

      <div className="day-type-legend">
        {dayTypes.list.map(type => (
          <div key={type.signature} className="day-type-item">
            <span
              className={`day-type-swatch ${type.unclassifiedCount > 0 ? 'day-type-swatch-unclassified' : ''}`}
              style={{ background: dayTypeBackground(type.style) }}
            />
            <div className="day-type-text">
              <span className="day-type-label" title={`signature ${type.signature}`}>{type.label}</span>
              <span className="muted small">
                {type.dayCount} j · {type.tripCount.toLocaleString('fr-FR')} courses
                {type.unclassifiedCount > 0 && type.unclassifiedCount < type.dayCount
                  ? ` · dont ${type.unclassifiedCount} non classé${type.unclassifiedCount > 1 ? 's' : ''}`
                  : ''}
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
