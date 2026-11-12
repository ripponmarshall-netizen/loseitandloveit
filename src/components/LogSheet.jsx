import { useMemo } from 'react'
import { useApp } from '../appContext.js'
import { planDoseStatus, doseStatusLabel } from '../lib/glp1.js'
import { suggestLogActions } from '../lib/quicklog.js'
import { useWaterTarget } from './Checkin.jsx'
import { LogDock, useQuickLog } from './QuickLog.jsx'
import { Icon, Sheet } from './ui.jsx'

const ACTIONS = {
  meal: { label: 'Meal', icon: 'fork', color: 'var(--orange)' },
  drink: { label: 'Drink', icon: 'cup', color: 'var(--pink)' },
  water: { label: 'Water', icon: 'drop', color: 'var(--cyan)' },
  exercise: { label: 'Exercise', icon: 'run', color: 'var(--red)' },
  mood: { label: 'Mood', icon: 'smile', color: 'var(--yellow)' },
  weight: { label: 'Weight', icon: 'scale', color: 'var(--indigo)' },
  dose: { label: 'GLP-1', icon: 'syringe', color: 'var(--purple)' },
}

/**
 * The + button: the same logging card as the Dashboard (type anything, or tap
 * a shortcut), plus two suggestions for right now.
 */
export default function LogSheet({ date, onClose }) {
  const { weights, today, mode } = useApp()
  const q = useQuickLog(date, { onDone: onClose })
  const { day, water, plan, open } = q
  const waterTarget = useWaterTarget()
  const isToday = date === today
  const hour = isToday ? new Date().getHours() + new Date().getMinutes() / 60 : 20

  const dose = planDoseStatus(plan, day?.doses, date)
  const mealsLogged = useMemo(() => Object.fromEntries((day?.entries || []).map((e) => [e.meal, true])), [day])
  const actions = suggestLogActions({
    hour,
    onGlp1: !!plan,
    dose: dose && { state: dose.state, label: doseStatusLabel(dose) },
    weighed: weights.some((w) => w.log_date === date),
    moodLogged: !!day?.daily?.mood,
    waterMl: water.ml,
    waterTarget,
    mealsLogged,
  })
  const top = actions.slice(0, 2)

  return (
    <Sheet title="Log" onClose={onClose}>
      <LogDock date={date} bare onDone={onClose} className="sheet-dock" />

      <div className="list-header">Suggested</div>
      <div className="list">
        {top.map((a) => (
          <button key={a.id} className="list-row has-icon" onClick={() => open(a.id)}>
            <span className="row-icon" style={{ '--c': ACTIONS[a.id].color }}>
              <Icon name={ACTIONS[a.id].icon} strokeWidth={2.2} />
            </span>
            <span className="label">
              {a.id === 'dose' && plan ? `${plan.name} dose` : a.id === 'meal' ? a.reason : ACTIONS[a.id].label}
              <span className="sub">{a.id === 'meal' ? `${isToday ? 'Now' : 'This day'} · ${mode === 'cloud' ? 'describe it or snap a photo' : 'search or quick add'}` : a.reason}</span>
            </span>
            <svg className="chev" viewBox="0 0 8 14" aria-hidden="true">
              <path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ))}
      </div>

    </Sheet>
  )
}
