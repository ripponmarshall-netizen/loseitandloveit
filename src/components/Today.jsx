import { useEffect, useRef, useState } from 'react'
import { useApp } from '../appContext.js'
import { MEALS, MEAL_COLOR, MEAL_LABEL } from '../lib/meals.js'
import { entryTotals, exerciseAllowance, inputToKg, sumEntries, weightUnit } from '../lib/calc.js'
import { addDays, formatDayLabel, formatLongDate } from '../lib/dates.js'
import { Icon, MacroBar, Ring, Sheet, Spinner, Stepper } from './ui.jsx'
import { ExerciseCard, WorkoutSheet } from './Workouts.jsx'

const fmt = (n) => Math.round(n).toLocaleString('en-GB')

export default function Today() {
  const { store, date, setDate, today, targets, weights, dataVersion, bumpData, openAdd, toast, profile } = useApp()
  const [entries, setEntries] = useState(null)
  const [editing, setEditing] = useState(null)
  const [workouts, setWorkouts] = useState([])
  const [workoutError, setWorkoutError] = useState(null)
  const [workoutSheet, setWorkoutSheet] = useState(null) // { workout } or {} for new
  const shownKey = useRef(null)

  useEffect(() => {
    let cancelled = false
    setWorkoutError(null)
    store
      .listWorkouts(date, date)
      .then((rows) => !cancelled && setWorkouts(rows))
      .catch((e) => {
        if (!cancelled) {
          setWorkouts([])
          setWorkoutError(e.message)
        }
      })
    return () => {
      cancelled = true
    }
  }, [store, date, dataVersion])

  useEffect(() => {
    let cancelled = false
    // Only show the spinner when the day changes, not on every add/edit.
    if (shownKey.current !== date) setEntries(null)
    store
      .listEntries(date, date)
      .then((rows) => {
        if (cancelled) return
        shownKey.current = date
        setEntries(rows)
      })
      .catch((e) => {
        if (!cancelled) {
          toast(e.message, 'error')
          setEntries([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [store, date, dataVersion, toast])

  const totals = sumEntries(entries || [])
  const burned = workouts.reduce((s, w) => s + (Number(w.calories_burned) || 0), 0)
  const allowance = exerciseAllowance(burned, profile.exercise_eatback_pct)
  const target = (targets?.calories || 0) + allowance
  const left = target - totals.calories
  const weighedToday = weights.some((w) => w.log_date === date)
  const isToday = date === today

  async function copyYesterday() {
    try {
      const prev = await store.listEntries(addDays(date, -1), addDays(date, -1))
      if (!prev.length) return toast('Nothing logged the day before.')
      await store.addEntries(prev.map((e) => ({ ...e, log_date: date, source: e.source })))
      bumpData()
      toast(`Copied ${prev.length} item${prev.length > 1 ? 's' : ''}`)
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  return (
    <div>
      <header className="page-head">
        <div className="grow">
          <div className="eyebrow">{formatLongDate(date)}</div>
          <h1>{formatDayLabel(date, today)}</h1>
        </div>
        <div className="day-nav">
          <button className="icon-btn" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>
            <Icon name="left" />
          </button>
          {!isToday && (
            <button className="btn sm secondary" onClick={() => setDate(today)}>Today</button>
          )}
          <button className="icon-btn" aria-label="Next day" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>
            <Icon name="right" />
          </button>
        </div>
      </header>

      <section className="card">
        <div className="summary">
          <Ring value={totals.calories} max={target}>
            <span className="big num">{fmt(Math.abs(left))}</span>
            <span className="tiny muted">{left >= 0 ? 'kcal left' : 'kcal over'}</span>
          </Ring>
          <div className="grow">
            <div className="kv"><span className="k">Eaten</span><span className="v">{fmt(totals.calories)}</span></div>
            <div className="kv">
              <span className="k">Target</span>
              <span className="v">{fmt(target)}</span>
            </div>
            {burned > 0 && (
              <div className="kv">
                <span className="k">Exercise</span>
                <span className="v" style={{ color: 'var(--red)' }}>{allowance > 0 ? `+${fmt(allowance)}` : fmt(burned)}</span>
              </div>
            )}
          </div>
        </div>
        <div className="grid3" style={{ marginTop: 6 }}>
          <MacroBar label="Protein" value={totals.protein} target={targets?.protein || 0} color="var(--protein)" />
          <MacroBar label="Carbs" value={totals.carbs} target={targets?.carbs || 0} color="var(--carbs)" />
          <MacroBar label="Fat" value={totals.fat} target={targets?.fat || 0} color="var(--fat)" />
        </div>
      </section>

      {isToday && !weighedToday && <QuickWeight units={profile.units} />}

      {entries === null ? (
        <div className="center" style={{ padding: 32, color: 'var(--text-3)' }}>
          <Spinner />
        </div>
      ) : (
        MEALS.map((meal, mi) => {
          const list = entries.filter((e) => e.meal === meal)
          const kcal = sumEntries(list).calories
          const color = MEAL_COLOR[meal]
          return (
            <section key={meal} className="rise" style={{ '--i': mi, marginBottom: 14 }}>
              <div className="row between" style={{ margin: '18px 4px 8px' }}>
                <div className="meal-title">
                  <span className="dot" style={{ '--c': color }} />
                  <span className="title3">{MEAL_LABEL[meal]}</span>
                  {kcal > 0 && <span className="small muted num">{fmt(kcal)} kcal</span>}
                </div>
                <button className="meal-add" style={{ '--c': color }} onClick={() => openAdd({ meal })} aria-label={`Add to ${MEAL_LABEL[meal]}`}>
                  <Icon name="plus" strokeWidth={2.8} />
                </button>
              </div>
              <div className="list">
                {list.map((e) => (
                  <button key={e.id} className="list-row" onClick={() => setEditing(e)}>
                    <span className="label">
                      <span className="ellipsis" style={{ display: 'block' }}>{e.name}</span>
                      <span className="sub ellipsis">
                        {Number(e.servings) !== 1 && `${Number(e.servings)} × `}
                        {e.serving || (e.source === 'quick' ? 'Quick add' : '1 serving')}
                        {e.source === 'ai' && (
                          <>
                            {' '}
                            <span className="badge ai">AI</span>
                          </>
                        )}
                      </span>
                    </span>
                    <span className="entry-kcal">{fmt(entryTotals(e).calories)}</span>
                  </button>
                ))}
                {list.length === 0 && (
                  <button className="list-row empty-row" onClick={() => openAdd({ meal })}>
                    Add {MEAL_LABEL[meal].toLowerCase()}
                  </button>
                )}
              </div>
            </section>
          )
        })
      )}

      <ExerciseCard
        workouts={workouts}
        error={workoutError}
        allowance={allowance}
        onAdd={() => setWorkoutSheet({})}
        onEdit={(w) => setWorkoutSheet({ workout: w })}
      />

      {entries && entries.length === 0 && (
        <p className="center" style={{ marginTop: 18 }}>
          <button className="btn sm gray" onClick={copyYesterday}>Copy the day before</button>
        </p>
      )}

      {editing && <EditEntry entry={editing} onClose={() => setEditing(null)} />}
      {workoutSheet && <WorkoutSheet date={date} workout={workoutSheet.workout} onClose={() => setWorkoutSheet(null)} />}
    </div>
  )
}

function QuickWeight({ units }) {
  const { store, today, reloadWeights, toast } = useApp()
  const [val, setVal] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(e) {
    e.preventDefault()
    const kg = inputToKg(val, units)
    if (!kg || kg < 30 || kg > 350) return toast('Enter a realistic weight', 'error')
    setBusy(true)
    try {
      await store.upsertWeight({ log_date: today, weight_kg: Math.round(kg * 100) / 100 })
      await reloadWeights()
      toast('Weight saved')
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="card tinted row" style={{ '--c': 'var(--indigo)', padding: '12px 12px 12px 14px' }} onSubmit={save}>
      <span className="row-icon" style={{ '--c': 'var(--indigo)' }}>
        <Icon name="scale" />
      </span>
      <span className="grow">
        <span className="headline" style={{ display: 'block' }}>Weigh-in</span>
        <span className="tiny muted">Morning, before food</span>
      </span>
      <input className="input" style={{ width: 92 }} inputMode="decimal" placeholder={weightUnit(units)} value={val} onChange={(e) => setVal(e.target.value)} aria-label="Weight" />
      <button className="btn sm" disabled={busy || !val} style={{ minHeight: 46, borderRadius: 10 }}>Save</button>
    </form>
  )
}

function EditEntry({ entry, onClose }) {
  const { store, bumpData, toast } = useApp()
  const [e, setE] = useState({
    name: entry.name,
    meal: entry.meal,
    servings: Number(entry.servings),
    calories: String(Number(entry.calories)),
    protein_g: String(Number(entry.protein_g)),
    carbs_g: String(Number(entry.carbs_g)),
    fat_g: String(Number(entry.fat_g)),
  })
  const [busy, setBusy] = useState(false)
  const set = (k) => (ev) => setE((s) => ({ ...s, [k]: ev.target.value }))
  const totals = entryTotals(e)

  async function run(fn, msg) {
    setBusy(true)
    try {
      await fn()
      bumpData()
      toast(msg)
      onClose()
    } catch (err) {
      toast(err.message, 'error')
      setBusy(false)
    }
  }

  const patch = () => ({
    name: e.name.trim() || entry.name,
    meal: e.meal,
    servings: Number(e.servings) || 1,
    calories: Number(e.calories) || 0,
    protein_g: Number(e.protein_g) || 0,
    carbs_g: Number(e.carbs_g) || 0,
    fat_g: Number(e.fat_g) || 0,
  })

  return (
    <Sheet title="Edit entry" onClose={onClose}>
      <label className="field">
        <span>Name</span>
        <input className="input" value={e.name} onChange={set('name')} />
      </label>
      <div className="row between" style={{ marginBottom: 16 }}>
        <div>
          <div className="tiny muted" style={{ marginBottom: 6 }}>Servings{entry.serving ? ` · ${entry.serving}` : ''}</div>
          <Stepper value={e.servings} onChange={(v) => setE((s) => ({ ...s, servings: v }))} />
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="tiny muted">Total</div>
          <strong className="num" style={{ fontSize: 28, letterSpacing: '-0.02em' }}>{fmt(totals.calories)}</strong>
          <span className="muted"> kcal</span>
        </div>
      </div>
      <div className="tiny muted" style={{ margin: '0 4px 6px' }}>Per serving</div>
      <div className="grid4">
        <label className="field"><span>kcal</span><input className="input" inputMode="decimal" value={e.calories} onChange={set('calories')} /></label>
        <label className="field"><span>Protein</span><input className="input" inputMode="decimal" value={e.protein_g} onChange={set('protein_g')} /></label>
        <label className="field"><span>Carbs</span><input className="input" inputMode="decimal" value={e.carbs_g} onChange={set('carbs_g')} /></label>
        <label className="field"><span>Fat</span><input className="input" inputMode="decimal" value={e.fat_g} onChange={set('fat_g')} /></label>
      </div>
      <label className="field">
        <span>Meal</span>
        <select className="input" value={e.meal} onChange={set('meal')}>
          {MEALS.map((m) => (
            <option key={m} value={m}>{MEAL_LABEL[m]}</option>
          ))}
        </select>
      </label>
      <div className="stack">
        <button className="btn block" disabled={busy} onClick={() => run(() => store.updateEntry(entry.id, patch()), 'Updated')}>Save</button>
        <button className="btn secondary block" disabled={busy} onClick={() => run(() => store.saveFood({ ...patch(), serving: entry.serving }), 'Saved to My foods')}>
          Save to My foods
        </button>
        <button className="btn destructive block" disabled={busy} onClick={() => run(() => store.deleteEntry(entry.id), 'Deleted')}>Delete</button>
      </div>
    </Sheet>
  )
}
