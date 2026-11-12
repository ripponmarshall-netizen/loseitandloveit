import { useState } from 'react'
import { useApp } from '../appContext.js'
import { MOOD_BY_V } from '../data/glp1.js'
import { formatWater, glp1Plan } from '../lib/glp1.js'
import { guessMeal, parseQuickLog } from '../lib/quicklog.js'
import { lbToKg } from '../lib/calc.js'
import { useDay } from '../lib/useDay.js'
import { useWater } from './Checkin.jsx'
import { Icon } from './ui.jsx'

/**
 * "Log anything": one phrase -> the right action. Shared by the Dashboard's
 * composer and the + sheet. Food goes to the AI estimate in cloud mode.
 */
export function useQuickLog(date, { onDone } = {}) {
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
    food: preview.drink || mode !== 'cloud' ? `Search ${preview.drink ? 'drinks' : 'food'} for “${preview.query}”` : `Estimate “${preview.query}” with AI`,
  }[preview.type]

  return { text, setText, submit, hint, open, day, water, plan }
}

/** The input itself: sparkle, field, send. */
export function QuickLogField({ q, placeholder = 'Patty, 2 glasses water…', className = '' }) {
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
