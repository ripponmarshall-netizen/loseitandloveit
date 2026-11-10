import { useMemo, useState } from 'react'
import { useApp } from '../appContext.js'
import { MOOD_BY_V } from '../data/glp1.js'
import { BOTTLE_ML, GLASS_ML, planDoseStatus, doseStatusLabel, formatWater, glp1Plan } from '../lib/glp1.js'
import { guessMeal, parseQuickLog, suggestLogActions } from '../lib/quicklog.js'
import { lbToKg } from '../lib/calc.js'
import { useDay } from '../lib/useDay.js'
import { useWater, useWaterTarget } from './Checkin.jsx'
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
 * The + button: type anything ("2 glasses water", "30 min walk", "patty"),
 * or tap what you want to log. The order follows the time of day and what's due.
 */
export default function LogSheet({ date, onClose }) {
  const app = useApp()
  const { openSheet, profile, weights, today, units, store, reloadWeights, toast } = app
  const day = useDay(date)
  const plan = glp1Plan(profile)
  const waterTarget = useWaterTarget()
  const water = useWater(date, day?.daily)
  const [text, setText] = useState('')
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

  function open(id, extra = {}) {
    const meal = extra.meal || (isToday ? guessMeal() : 'dinner')
    switch (id) {
      case 'meal': return openSheet('food', { date, meal, query: extra.query })
      case 'drink': return openSheet('food', { date, meal, drinks: true, query: extra.query })
      case 'water': return openSheet('water', { date, daily: day?.daily })
      case 'exercise': return openSheet('workout', { date, preset: extra.preset })
      case 'mood': return openSheet('mood', { date, daily: day?.daily, initialMood: extra.mood })
      case 'weight': return openSheet('weight', { date, initialValue: extra.value })
      case 'dose': return plan || extra.med ? openSheet('dose', { date, preset: extra }) : openSheet('medication')
      default:
    }
  }

  async function submit(e) {
    e.preventDefault()
    const p = parseQuickLog(text)
    if (!p) return
    if (p.type === 'water') {
      water.add(p.ml)
      toast(`+${formatWater(p.ml)} water`)
      setText('')
      return
    }
    if (p.type === 'weight' && p.unit && isToday) {
      // "212 lb": save straight away.
      const kg = p.unit === 'kg' ? p.value : lbToKg(p.value)
      if (kg >= 30 && kg <= 350) {
        try {
          await store.upsertWeight({ log_date: today, weight_kg: Math.round(kg * 100) / 100 })
          await reloadWeights()
          toast('Weight saved')
          onClose()
        } catch (err) {
          toast(err.message, 'error')
        }
        return
      }
    }
    if (p.type === 'weight') return open('weight', { value: p.value })
    if (p.type === 'mood') return open('mood', { mood: p.mood })
    if (p.type === 'dose') return open('dose', { med: p.med, dose: p.dose })
    if (p.type === 'exercise') {
      return open('exercise', { preset: { kind: p.kind, mode: p.mode, activity: p.activity, duration_min: p.minutes } })
    }
    return open(p.drink ? 'drink' : 'meal', { query: p.query })
  }

  const preview = text.trim() ? parseQuickLog(text) : null
  const hint = preview && {
    water: `Add ${formatWater(preview.ml)} of water`,
    weight: `Log weight${preview.value ? ` ${preview.value}${preview.unit ? ` ${preview.unit}` : units === 'imperial' ? ' lb' : ' kg'}` : ''}`,
    mood: `Check in${preview.mood ? `: ${MOOD_BY_V[preview.mood]?.label}` : ''}`,
    dose: 'Log a GLP-1 dose',
    exercise: `Log ${preview.minutes ? `${preview.minutes} min ` : ''}${preview.mode === 'run' ? 'run' : preview.kind === 'treadmill' ? 'walk' : 'workout'}`,
    food: `Search ${preview.drink ? 'drinks' : 'food'} for “${preview.query}”`,
  }[preview.type]

  return (
    <Sheet title="Log" onClose={onClose}>
      <form onSubmit={submit} className="quick-log">
        <div className="search-field grow">
          <Icon name="sparkles" />
          <input
            className="input"
            enterKeyHint="go"
            placeholder="Patty, 2 glasses water…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Log anything"
          />
        </div>
        <button className="send-btn" disabled={!text.trim()} aria-label="Log it">
          <Icon name="up" strokeWidth={2.6} />
        </button>
      </form>
      {hint && <p className="quick-hint small">↵ {hint}</p>}

      <div className="list-header">Suggested</div>
      <div className="list">
        {top.map((a) => (
          <button key={a.id} className="list-row has-icon" onClick={() => open(a.id)}>
            <span className="row-icon" style={{ '--c': ACTIONS[a.id].color }}>
              <Icon name={ACTIONS[a.id].icon} strokeWidth={2.2} />
            </span>
            <span className="label">
              {a.id === 'dose' && plan ? `${plan.name} dose` : a.id === 'meal' ? a.reason : ACTIONS[a.id].label}
              <span className="sub">{a.id === 'meal' ? `${isToday ? 'Now' : 'This day'} · search, AI photo or quick add` : a.reason}</span>
            </span>
            <svg className="chev" viewBox="0 0 8 14" aria-hidden="true">
              <path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ))}
      </div>

      <div className="list-header">Everything</div>
      <div className="log-grid">
        {Object.entries(ACTIONS).map(([id, a], i) => (
          <button key={id} className="log-tile rise" style={{ '--i': i, '--c': a.color }} onClick={() => open(id)}>
            <span className="log-tile-icon">
              <Icon name={a.icon} strokeWidth={2.2} />
            </span>
            <span className="log-tile-label">{a.label}</span>
          </button>
        ))}
      </div>

      <div className="list-header">
        Water · <span className="no-caps">{formatWater(water.ml)} of {formatWater(waterTarget)}</span>
      </div>
      <div className="grid3">
        <button className="btn secondary" style={{ '--tint': 'var(--cyan)' }} onClick={() => water.add(GLASS_ML)}>+ Glass</button>
        <button className="btn secondary" style={{ '--tint': 'var(--cyan)' }} onClick={() => water.add(BOTTLE_ML)}>+ Bottle</button>
        <button className="btn gray" disabled={water.ml <= 0} onClick={() => water.add(-GLASS_ML)}>− Glass</button>
      </div>
    </Sheet>
  )
}
