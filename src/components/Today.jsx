import { useEffect, useState } from 'react'
import { useApp } from '../appContext.js'
import { MEALS, MEAL_LABEL } from '../lib/meals.js'
import { entryTotals, exerciseAllowance, inputToKg, sumEntries, weightUnit } from '../lib/calc.js'
import { addDays, formatDayLabel } from '../lib/dates.js'
import { Icon, Loading, MacroBar, Ring, Sheet, Stepper } from './ui.jsx'
import { ExerciseCard, WorkoutSheet } from './Workouts.jsx'

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-GB')

export default function Today() {
  const { store, date, setDate, today, targets, weights, dataVersion, bumpData, openAdd, toast, profile } = useApp()
  // Results are tagged with their date: after an add or edit the old list
  // stays on screen until the new one arrives (no spinner flash), but
  // switching days never shows the previous day's food.
  const [loadedEntries, setLoadedEntries] = useState({ date: null, rows: [] })
  const [loadedWorkouts, setLoadedWorkouts] = useState({ date: null, rows: [], error: null })
  const [editing, setEditing] = useState(null)
  const [workoutSheet, setWorkoutSheet] = useState(null) // { workout } or {} for new

  useEffect(() => {
    let cancelled = false
    store
      .listWorkouts(date, date)
      .then((rows) => !cancelled && setLoadedWorkouts({ date, rows, error: null }))
      .catch((e) => !cancelled && setLoadedWorkouts({ date, rows: [], error: e.message }))
    return () => {
      cancelled = true
    }
  }, [store, date, dataVersion])

  useEffect(() => {
    let cancelled = false
    store
      .listEntries(date, date)
      .then((rows) => !cancelled && setLoadedEntries({ date, rows }))
      .catch((e) => {
        if (!cancelled) {
          toast(e.message, 'error')
          setLoadedEntries({ date, rows: [] })
        }
      })
    return () => {
      cancelled = true
    }
  }, [store, date, dataVersion, toast])

  const entries = loadedEntries.date === date ? loadedEntries.rows : null
  const workouts = loadedWorkouts.date === date ? loadedWorkouts.rows : []
  const workoutError = loadedWorkouts.date === date ? loadedWorkouts.error : null

  const totals = sumEntries(entries || [])
  const burned = workouts.reduce((s, w) => s + (Number(w.calories_burned) || 0), 0)
  const allowance = exerciseAllowance(burned, profile.exercise_eatback_pct)
  const target = (targets?.calories || 0) + allowance
  const left = target - totals.calories
  const weighedToday = weights.some((w) => w.log_date === date)

  const [copying, setCopying] = useState(false)
  async function copyYesterday() {
    setCopying(true)
    try {
      const prev = await store.listEntries(addDays(date, -1), addDays(date, -1))
      if (!prev.length) return toast('Nothing logged the day before.')
      const added = await store.addEntries(prev.map((e) => ({ ...e, log_date: date, source: e.source })))
      bumpData()
      toast(`Copied ${prev.length} item${prev.length > 1 ? 's' : ''}`, 'info', {
        label: 'Undo',
        run: async () => {
          try {
            for (const e of added) await store.deleteEntry(e.id)
            bumpData()
          } catch (err) {
            toast(err.message, 'error')
          }
        },
      })
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setCopying(false)
    }
  }

  const isToday = date === today
  return (
    <div>
      <div className="daynav">
        <button className="icon-btn" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>
          <Icon name="left" />
        </button>
        <button className="link label center" onClick={() => setDate(today)} disabled={isToday} aria-label={isToday ? 'Today' : `${formatDayLabel(date, today)}. Tap to go back to today`}>
          {formatDayLabel(date, today)}
          {!isToday && <span className="back-today">Back to today</span>}
        </button>
        <button className="icon-btn" aria-label="Next day" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>
          <Icon name="right" />
        </button>
      </div>

      <section className="card">
        <div className="summary">
          <Ring value={totals.calories} max={target}>
            <span className="big num">{fmt(Math.abs(left))}</span>
            <span className="small muted">{left >= 0 ? 'kcal left' : 'kcal over'}</span>
          </Ring>
          <div className="grow">
            <div className="kvs">
              <div className="kv">
                <span className="muted">Eaten</span>
                <strong className="num">{fmt(totals.calories)}</strong>
              </div>
              <div className="kv">
                <span className="muted">Target</span>
                <strong className="num">{fmt(target)}</strong>
              </div>
              {burned > 0 && (
                <div className="kv">
                  <span className="muted">Burned</span>
                  <strong className="num">{fmt(burned)}</strong>
                </div>
              )}
            </div>
            <MacroBar label="Protein" value={totals.protein} target={targets?.protein || 0} color="var(--protein)" />
            <MacroBar label="Carbs" value={totals.carbs} target={targets?.carbs || 0} color="var(--carbs)" />
            <MacroBar label="Fat" value={totals.fat} target={targets?.fat || 0} color="var(--fat)" />
          </div>
        </div>
      </section>

      {isToday && !weighedToday && <QuickWeight units={profile.units} />}

      {entries === null ? (
        <Loading />
      ) : (
        MEALS.map((meal) => {
          const list = entries.filter((e) => e.meal === meal)
          const kcal = sumEntries(list).calories
          return (
            <section className="card" key={meal}>
              <div className="meal-head">
                <h2>{MEAL_LABEL[meal]}</h2>
                <div className="row">
                  {kcal > 0 && <span className="small muted num">{fmt(kcal)} kcal</span>}
                  <button className="btn soft sm" onClick={() => openAdd({ meal })} aria-label={`Add to ${MEAL_LABEL[meal]}`}>
                    + Add
                  </button>
                </div>
              </div>
              {list.map((e) => (
                <button key={e.id} className="entry" onClick={() => setEditing(e)}>
                  <div className="grow">
                    <div className="ellipsis">{e.name}</div>
                    <div className="tiny muted ellipsis">
                      {Number(e.servings) !== 1 && `${Number(e.servings)} × `}
                      {e.serving || (e.source === 'quick' ? 'Quick add' : '1 serving')}
                      {e.source === 'ai' && (
                        <>
                          {' '}
                          <span className="tag">AI est.</span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className="kcal num">{fmt(entryTotals(e).calories)}</span>
                </button>
              ))}
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
        <p className="center">
          <button className="btn ghost sm" onClick={copyYesterday} disabled={copying}>Copy the day before</button>
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
    <form className="card row" onSubmit={save}>
      <div className="grow">
        <div style={{ fontWeight: 600 }}>Morning weigh-in</div>
        <div className="tiny muted">After the toilet, before food</div>
      </div>
      <input className="input" style={{ width: 92 }} inputMode="decimal" placeholder={weightUnit(units)} value={val} onChange={(e) => setVal(e.target.value)} aria-label={`Weight in ${weightUnit(units)}`} />
      <button className="btn" disabled={busy || !val}>Save</button>
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

  async function run(fn, msg, action) {
    setBusy(true)
    try {
      await fn()
      bumpData()
      toast(msg, 'info', action)
      onClose()
    } catch (err) {
      toast(err.message, 'error')
      setBusy(false)
    }
  }

  const undoDelete = {
    label: 'Undo',
    run: async () => {
      try {
        await store.addEntries([entry])
        bumpData()
      } catch (err) {
        toast(err.message, 'error')
      }
    },
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
      <div className="row between" style={{ marginBottom: 12 }}>
        <div>
          <div className="small muted">Servings{entry.serving ? ` (${entry.serving})` : ''}</div>
          <Stepper value={e.servings} onChange={(v) => setE((s) => ({ ...s, servings: v }))} />
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="small muted">Total</div>
          <strong className="num" style={{ fontSize: 22 }}>{totals.calories} kcal</strong>
        </div>
      </div>
      <p className="small muted" style={{ marginBottom: 4 }}>Per serving (kcal and grams)</p>
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
        <button
          className="btn ghost block"
          disabled={busy}
          onClick={() => run(() => store.saveFood({ ...patch(), serving: entry.serving }), 'Saved to My foods')}
        >
          Save to My foods
        </button>
        <button className="btn danger block" disabled={busy} onClick={() => run(() => store.deleteEntry(entry.id), `Deleted ${entry.name}`, undoDelete)}>Delete</button>
      </div>
    </Sheet>
  )
}
