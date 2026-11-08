import { useEffect, useRef, useState } from 'react'
import { useApp } from '../appContext.js'
import { APPETITE, ENERGY, MOODS, SYMPTOMS } from '../data/glp1.js'
import { BOTTLE_ML, GLASS_ML, formatWater, glp1Plan, waterTargetMl } from '../lib/glp1.js'
import { inputToKg, weightUnit } from '../lib/calc.js'
import { formatDayLabel } from '../lib/dates.js'
import { Icon, Segmented, Sheet } from './ui.jsx'

/** The day's water goal from the profile and trend weight. */
export function useWaterTarget() {
  const { profile, series } = useApp()
  const kg = series.length ? series[series.length - 1].trend : Number(profile.start_weight_kg)
  return waterTargetMl(kg, profile.water_target_ml)
}

/**
 * Water for a day with instant taps: the number updates straight away and
 * saves shortly after the last tap, so fast double taps never get lost.
 */
export function useWater(date, daily) {
  const { store, bumpData, toast } = useApp()
  const saved = Number(daily?.water_ml) || 0
  const [ml, setMl] = useState(saved)
  const pending = useRef(null)
  const timer = useRef()

  useEffect(() => {
    if (pending.current == null) setMl(saved)
  }, [saved, date])

  const flush = useRef()
  flush.current = async () => {
    const value = pending.current
    if (value == null) return
    try {
      await store.saveDailyLog(date, { water_ml: value })
      bumpData()
    } catch (e) {
      toast(e.message, 'error')
      setMl(saved)
    } finally {
      if (pending.current === value) pending.current = null
    }
  }
  // Closing the sheet straight after a tap still saves it.
  useEffect(
    () => () => {
      if (pending.current != null) {
        clearTimeout(timer.current)
        flush.current()
      }
    },
    [],
  )

  function add(delta) {
    const next = Math.max(0, Math.min(15000, (pending.current ?? ml) + delta))
    pending.current = next
    setMl(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => flush.current(), 450)
  }
  return { ml, add }
}

export function WaterSheet({ date, daily, onClose }) {
  const { today } = useApp()
  const target = useWaterTarget()
  const { ml, add } = useWater(date, daily)
  const pct = Math.min(1, ml / target)
  const glasses = Math.round(ml / GLASS_ML)
  const day = formatDayLabel(date, today)
  return (
    <Sheet title={`Water${day === 'Today' ? '' : ` · ${day}`}`} onClose={onClose}>
      <div className="water-hero">
        <div className="water-glass" style={{ '--p': pct }} aria-hidden="true">
          <i />
        </div>
        <div>
          <div className="water-amount num">{formatWater(ml)}</div>
          <div className="small muted">
            of {formatWater(target)} · {glasses} glass{glasses === 1 ? '' : 'es'}
          </div>
        </div>
      </div>
      <div className="grid3" style={{ marginBottom: 12 }}>
        <button className="btn secondary" style={{ '--tint': 'var(--cyan)' }} onClick={() => add(GLASS_ML)}>+ Glass</button>
        <button className="btn secondary" style={{ '--tint': 'var(--cyan)' }} onClick={() => add(BOTTLE_ML)}>+ Bottle</button>
        <button className="btn gray" disabled={ml <= 0} onClick={() => add(-GLASS_ML)}>− Glass</button>
      </div>
      <p className="list-footer" style={{ margin: '0 4px 14px' }}>
        A glass is 250 ml, a bottle 500 ml. Goal ≈ 30 ml per kg of body weight; drink more in the heat, on shift, or if you’re being sick. Change it in
        Settings → Tracking.
      </p>
      <button className="btn block" onClick={onClose}>Done</button>
    </Sheet>
  )
}

/** Mood, energy, appetite and symptoms for one day. */
export function MoodSheet({ date, daily, onClose, initialMood }) {
  const { store, bumpData, toast, today, profile } = useApp()
  const onGlp1 = !!glp1Plan(profile)
  const [mood, setMood] = useState(initialMood ?? daily?.mood ?? null)
  const [energy, setEnergy] = useState(daily?.energy ?? null)
  const [appetite, setAppetite] = useState(daily?.appetite ?? null)
  const [symptoms, setSymptoms] = useState(daily?.symptoms || [])
  const [note, setNote] = useState(daily?.note || '')
  const [busy, setBusy] = useState(false)
  const day = formatDayLabel(date, today)
  const urgent = symptoms.some((s) => SYMPTOMS.find((x) => x.id === s)?.urgent)

  const toggle = (id) => setSymptoms((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))

  async function save() {
    setBusy(true)
    try {
      await store.saveDailyLog(date, { mood, energy, appetite, symptoms, note: note.trim() || null })
      bumpData()
      toast('Check-in saved')
      onClose()
    } catch (e) {
      toast(e.message, 'error')
      setBusy(false)
    }
  }

  return (
    <Sheet title={`How are you${day === 'Today' ? ' today' : ` · ${day}`}?`} onClose={onClose}>
      <div className="mood-row" role="radiogroup" aria-label="Mood">
        {MOODS.map((m) => (
          <button
            key={m.v}
            type="button"
            role="radio"
            aria-checked={mood === m.v}
            className={`mood-btn${mood === m.v ? ' on' : ''}`}
            style={{ '--c': m.color }}
            onClick={() => setMood(mood === m.v ? null : m.v)}
          >
            <span className="mood-emoji" aria-hidden="true">{m.emoji}</span>
            <span className="caption">{m.label}</span>
          </button>
        ))}
      </div>

      <div className="list-header">Energy</div>
      <Segmented label="Energy" value={energy} onChange={(v) => setEnergy(v === energy ? null : v)} options={ENERGY} />

      <div className="list-header">Appetite{onGlp1 ? ' (GLP-1 often lowers it)' : ''}</div>
      <Segmented label="Appetite" value={appetite} onChange={(v) => setAppetite(v === appetite ? null : v)} options={APPETITE} />

      <div className="list-header">Anything bothering you?</div>
      <div className="chip-wrap">
        {SYMPTOMS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`chip${symptoms.includes(s.id) ? ' tinted' : ''}`}
            style={{ '--c': s.urgent ? 'var(--red)' : 'var(--indigo)' }}
            aria-pressed={symptoms.includes(s.id)}
            onClick={() => toggle(s.id)}
          >
            {symptoms.includes(s.id) && <Icon name="check" size={14} strokeWidth={3} />} {s.label}
          </button>
        ))}
      </div>
      {urgent && (
        <div className="card tinted small" style={{ '--c': 'var(--red)', marginTop: 12 }} role="alert">
          <strong>Get medical help today.</strong> Severe stomach pain that won’t settle (sometimes spreading to the back), or not being able to keep
          fluids down, can be serious on a GLP-1 medicine. In an emergency call 110.
        </div>
      )}

      <label className="field" style={{ marginTop: 16 }}>
        <span>Note (optional)</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Slept badly after night shift…" maxLength={1000} />
      </label>
      <button className="btn block" disabled={busy} onClick={save}>Save check-in</button>
    </Sheet>
  )
}

export function WeightSheet({ initialValue, onClose }) {
  const { store, today, units, reloadWeights, toast } = useApp()
  const [date, setDate] = useState(today)
  const [val, setVal] = useState(initialValue != null ? String(initialValue) : '')
  const [busy, setBusy] = useState(false)
  async function save(e) {
    e.preventDefault()
    const kg = inputToKg(val, units)
    if (!kg || kg < 30 || kg > 350) return toast('Enter a realistic weight', 'error')
    setBusy(true)
    try {
      await store.upsertWeight({ log_date: date, weight_kg: Math.round(kg * 100) / 100 })
      await reloadWeights()
      toast('Weight saved')
      onClose()
    } catch (err) {
      toast(err.message, 'error')
      setBusy(false)
    }
  }
  return (
    <Sheet title="Weigh-in" onClose={onClose}>
      <form onSubmit={save}>
        <div className="grid2">
          <label className="field">
            <span>Weight ({weightUnit(units)})</span>
            <input className="input" inputMode="decimal" autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder={weightUnit(units)} />
          </label>
          <label className="field">
            <span>Date</span>
            <input className="input" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <p className="list-footer" style={{ margin: '-4px 4px 14px' }}>Morning, after the toilet, before food. The trend matters more than any one day.</p>
        <button className="btn block" disabled={busy || !val}>Save</button>
      </form>
    </Sheet>
  )
}
