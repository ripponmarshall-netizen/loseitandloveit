import { useState } from 'react'
import { useApp } from '../appContext.js'
import { MOOD_BY_V } from '../data/glp1.js'
import { doseStatusLabel, formatWater, glp1Plan, planDoseStatus } from '../lib/glp1.js'
import { guessMeal, parseQuickLog } from '../lib/quicklog.js'
import { displayWeight, lbToKg, weeklyRate, weightUnit, weightValue } from '../lib/calc.js'
import { MEAL_LABEL } from '../lib/meals.js'
import { useDay } from '../lib/useDay.js'
import { useWater, useWaterTarget } from './Checkin.jsx'
import { Icon } from './ui.jsx'

/**
 * "Log anything": one phrase -> the right action. Shared by the Dashboard's
 * composer and the + sheet. Food goes to the AI estimate in cloud mode.
 */
function useQuickLog(date, { onDone } = {}) {
  const { openSheet, profile, today, units, store, reloadWeights, toast, mode } = useApp()
  const day = useDay(date)
  const plan = glp1Plan(profile)
  const water = useWater(date, day?.daily)
  const [text, setText] = useState('')
  const isToday = date === today

  function open(id, extra = {}) {
    const meal = extra.meal || (isToday ? guessMeal() : 'dinner')
    switch (id) {
      case 'meal': return openSheet('food', { date, meal, query: extra.query })
      case 'drink': return openSheet('food', { date, meal, drinks: true, query: extra.query })
      case 'water': return openSheet('water', { date, daily: day?.daily })
      // A typed workout opens the form; a plain tap opens the Workouts section.
      case 'exercise': return extra.preset ? openSheet('workout', { date, preset: extra.preset }) : openSheet('workouts', { date })
      case 'mood': return openSheet('mood', { date, daily: day?.daily, initialMood: extra.mood })
      case 'weight': return openSheet('weight', { date, initialValue: extra.value })
      case 'dose': return plan || extra.med ? openSheet('dose', { date, preset: extra }) : openSheet('medication')
      default:
    }
  }

  async function submit(e) {
    e?.preventDefault()
    const p = parseQuickLog(text)
    if (!p) return
    if (p.type === 'water') {
      water.add(p.ml)
      toast(`+${formatWater(p.ml)} water`)
      setText('')
      return
    }
    setText('')
    if (p.type === 'weight' && p.unit && isToday) {
      // "212 lb": save straight away.
      const kg = p.unit === 'kg' ? p.value : lbToKg(p.value)
      if (kg >= 30 && kg <= 350) {
        try {
          await store.upsertWeight({ log_date: today, weight_kg: Math.round(kg * 100) / 100 })
          await reloadWeights()
          toast('Weight saved')
          onDone?.()
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
      return open('exercise', { preset: { kind: p.kind, mode: p.mode, activity: p.activity, duration_min: p.minutes, typeKey: p.typeKey, name: p.name } })
    }
    return open(p.drink ? 'drink' : 'meal', { query: p.query })
  }

  const preview = text.trim() ? parseQuickLog(text) : null
  const hint = preview && {
    water: `Add ${formatWater(preview.ml)} of water`,
    weight: `Log weight${preview.value ? ` ${preview.value}${preview.unit ? ` ${preview.unit}` : units === 'imperial' ? ' lb' : ' kg'}` : ''}`,
    mood: `Check in${preview.mood ? `: ${MOOD_BY_V[preview.mood]?.label}` : ''}`,
    dose: 'Log a GLP-1 dose',
    exercise: `Log ${preview.minutes ? `${preview.minutes} min ` : ''}${preview.name ? preview.name.toLowerCase() : preview.mode === 'run' ? 'run' : preview.kind === 'treadmill' ? 'walk' : 'workout'}`,
    food: preview.drink || mode !== 'cloud' ? `Search ${preview.drink ? 'drinks' : 'food'} for “${preview.query}”` : `Estimate “${preview.query}” with AI`,
  }[preview.type]

  return { text, setText, submit, hint, day, water, plan }
}

/** The input itself: sparkle, field, send. */
function QuickLogField({ q, placeholder = 'Patty, 2 glasses water…', className = '', autoFocus = false }) {
  return (
    <>
      <form onSubmit={q.submit} className={`quick-log ${className}`}>
        <div className="search-field grow">
          <Icon name="sparkles" />
          <input
            className="input"
            enterKeyHint="go"
            placeholder={placeholder}
            value={q.text}
            onChange={(e) => q.setText(e.target.value)}
            aria-label="Log anything"
            autoFocus={autoFocus}
          />
        </div>
        <button className="send-btn" disabled={!q.text.trim()} aria-label="Log it">
          <Icon name="up" strokeWidth={2.6} />
        </button>
      </form>
      {q.hint && <p className="quick-hint small">↵ {q.hint}</p>}
    </>
  )
}

const RING_C = 2 * Math.PI * 16.5
const fmt = (n) => Math.round(n).toLocaleString('en-GB')

// "Due today" -> "Due"; the full label is in the dose sheet.
function shortDose(dose) {
  if (dose.state === 'taken') return 'Taken'
  if (dose.state === 'overdue') return 'Overdue'
  if (dose.state === 'none') return 'Start'
  if (dose.state === 'due') return 'Due'
  return doseStatusLabel(dose)
}

/** One row of shortcuts that double as status: what's logged, at a glance. */
function useDockItems(date, q) {
  const { openAdd, openSheet, weights, series, units, today } = useApp()
  const { day, water, plan } = q
  const waterTarget = useWaterTarget()
  const daily = day?.daily || null
  const workouts = day?.workouts || []
  const burned = workouts.reduce((s, w) => s + (Number(w.calories_burned) || 0), 0)
  const mood = MOOD_BY_V[daily?.mood]
  const dose = plan && day ? planDoseStatus(plan, day.doses, date) : null
  const weighIn = weights.find((w) => w.log_date === date)
  const upTo = series.filter((p) => p.date <= date)
  const lastTrend = upTo[upTo.length - 1]
  const rate = weeklyRate(upTo)
  const signedRate = rate == null ? null : `${rate > 0 ? '+' : rate < 0 ? '−' : ''}${Math.abs(weightValue(rate, units)).toFixed(1)} ${weightUnit(units)}/wk`
  const nextMeal = date === today ? guessMeal() : 'dinner'

  return [
    { id: 'meal', icon: 'fork', color: 'var(--orange)', label: 'Meal', value: MEAL_LABEL[nextMeal], onClick: () => openAdd({ meal: nextMeal }), aria: `Log ${MEAL_LABEL[nextMeal]}` },
    {
      id: 'water', icon: 'drop', color: 'var(--cyan)', label: 'Water', value: formatWater(water.ml), pct: water.ml / waterTarget,
      done: water.ml >= waterTarget, onClick: () => openSheet('water', { date, daily }), aria: `Water: ${formatWater(water.ml)} of ${formatWater(waterTarget)}`,
    },
    {
      id: 'workout', icon: 'run', color: 'var(--red)', label: 'Workout', value: workouts.length ? fmt(burned) : '—', unit: workouts.length ? 'kcal' : '',
      done: workouts.length > 0, alert: !!day?.workoutError, onClick: () => openSheet('workouts', { date }),
      aria: workouts.length ? `Workouts: ${workouts.length}, ${fmt(burned)} kcal` : 'Workouts: none yet',
    },
    {
      id: 'mood', icon: mood ? null : 'smile', emoji: mood?.emoji, color: mood?.color || 'var(--yellow)', label: 'Mood', value: mood ? mood.label : '—',
      done: !!mood, onClick: () => openSheet('mood', { date, daily }), aria: `Mood: ${mood ? mood.label : 'not checked in'}`,
    },
    {
      id: 'weight', icon: 'scale', color: 'var(--indigo)', label: 'Weight', value: lastTrend ? weightValue(lastTrend.weight, units).toFixed(1) : '—', unit: lastTrend ? weightUnit(units) : '',
      done: !!weighIn, onClick: () => openSheet('weight', weighIn ? { weight: weighIn } : { date }),
      aria: lastTrend ? `Weight ${displayWeight(lastTrend.weight, units)}${signedRate ? `, trend ${signedRate}` : ''}` : 'Log a weigh-in',
    },
    plan && {
      id: 'dose', icon: plan.route === 'oral' ? 'pill' : 'syringe', color: 'var(--purple)', label: 'GLP-1', value: dose ? shortDose(dose) : '…',
      done: dose?.state === 'taken', alert: dose?.state === 'due' || dose?.state === 'overdue', onClick: () => openSheet('dose', { date }),
      aria: `GLP-1: ${dose ? doseStatusLabel(dose) : ''}`,
    },
  ].filter(Boolean)
}

/**
 * The one logging surface, on the Dashboard and in the + sheet: type anything
 * (AI handles food), or tap a shortcut that also shows the day's status.
 */
export function LogDock({ date, onDone, autoFocus = false, bare = false, className = '', style }) {
  const { mode } = useApp()
  const q = useQuickLog(date, { onDone })
  const items = useDockItems(date, q)
  return (
    <section className={`${bare ? '' : 'card '}log-dock ${className}`} style={style}>
      <QuickLogField q={q} autoFocus={autoFocus} placeholder={mode === 'cloud' ? 'What did you eat or do?' : 'Patty, 2 glasses water…'} />
      <div className="dock-row" style={{ '--n': items.length }}>
        {items.map((it) => (
          <button key={it.id} type="button" className={`dock-item${it.done ? ' done' : ''}${it.alert ? ' alert' : ''}`} style={{ '--c': it.color }} onClick={it.onClick} aria-label={it.aria}>
            <span className="dock-icon" aria-hidden="true">
              {it.emoji ? <span className="dock-emoji">{it.emoji}</span> : <Icon name={it.icon} size={18} strokeWidth={2.2} />}
              {it.pct != null && (
                <svg className="dock-ring" viewBox="0 0 36 36">
                  <circle cx="18" cy="18" r="16.5" strokeDasharray={`${Math.min(1, it.pct) * RING_C} ${RING_C}`} />
                </svg>
              )}
            </span>
            <span className="dock-value num ellipsis">
              {it.value}
              {it.unit && <span className="dock-unit"> {it.unit}</span>}
            </span>
            <span className="dock-label ellipsis">{it.label}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
