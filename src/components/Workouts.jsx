import { useMemo, useState } from 'react'
import { useApp } from '../appContext.js'
import { HOME_ACTIVITIES, estimateWorkoutKcal, kmhToMph, mphToKmh } from '../lib/calc.js'
import { formatDayLabel } from '../lib/dates.js'
import { HOME_PRESETS, TREADMILL_PRESETS } from '../data/workouts.js'
import { Icon, Segmented, Sheet } from './ui.jsx'

const r1 = (n) => Math.round(n * 10) / 10
const INTENSITY = [
  ['light', 'Light'],
  ['moderate', 'Moderate'],
  ['hard', 'Hard'],
]

export function workoutDetail(w, units) {
  if (w.kind === 'treadmill') {
    const speed = w.speed_kmh ? (units === 'imperial' ? `${r1(kmhToMph(w.speed_kmh))} mph` : `${r1(w.speed_kmh)} km/h`) : null
    const incline = w.incline_pct ? `${r1(w.incline_pct)}% incline` : null
    return [`${Math.round(w.duration_min)} min`, speed, incline].filter(Boolean).join(' · ')
  }
  const a = HOME_ACTIVITIES[w.activity]
  return [`${Math.round(w.duration_min)} min`, a?.label, w.intensity].filter(Boolean).join(' · ')
}

/** The day's workouts plus an Add button (in the Dashboard's Exercise sheet). */
export function ExerciseCard({ workouts, error, onAdd, onEdit, allowance }) {
  const { units } = useApp()
  const burned = workouts.reduce((s, w) => s + (Number(w.calories_burned) || 0), 0)
  return (
    <section>
      <div className="list-header">Exercise{burned > 0 ? ` · ${burned} kcal` : ''}</div>
      <div className="list">
        {error && <div className="list-row small danger-text">{error}</div>}
        {workouts.map((w) => (
          <button key={w.id} className="list-row has-icon" onClick={() => onEdit(w)}>
            <span className="row-icon" style={{ '--c': w.kind === 'treadmill' ? 'var(--red)' : 'var(--orange)' }}>
              <Icon name={w.kind === 'treadmill' ? 'run' : 'house'} />
            </span>
            <span className="label">
              <span className="ellipsis" style={{ display: 'block' }}>{w.name}</span>
              <span className="sub ellipsis">{workoutDetail(w, units)}</span>
            </span>
            <span className="entry-kcal">{w.calories_burned}</span>
          </button>
        ))}
        <button className="list-row meal-row add-row" style={{ '--c': 'var(--red)' }} onClick={onAdd} aria-label="Add workout">
          <span className="dot" />
          <span className="label">{workouts.length ? 'Add another workout' : 'Treadmill or home workout'}</span>
          <span className="meal-add" aria-hidden="true">
            <Icon name="plus" strokeWidth={2.8} />
          </span>
        </button>
      </div>
      {burned > 0 && (
        <div className="list-footer">
          {allowance > 0
            ? `${allowance} kcal added to today's food target (Settings → Exercise calories).`
            : 'Not added to your food target: your activity level already allows for training.'}
        </div>
      )}
    </section>
  )
}

function emptyForm(kind) {
  return {
    kind,
    name: '',
    duration_min: kind === 'treadmill' ? '30' : '20',
    speed: '',
    incline_pct: '0',
    mode: 'walk',
    modeTouched: false,
    activity: 'bodyweight',
    intensity: 'moderate',
    exercises: [],
    manualKcal: '',
    notes: '',
  }
}

function fromWorkout(w, units) {
  return {
    ...emptyForm(w.kind),
    name: w.name,
    duration_min: String(Number(w.duration_min)),
    speed: w.speed_kmh ? String(r1(units === 'imperial' ? kmhToMph(Number(w.speed_kmh)) : Number(w.speed_kmh))) : '',
    incline_pct: w.incline_pct != null ? String(Number(w.incline_pct)) : '0',
    mode: w.mode || 'walk',
    modeTouched: true,
    activity: w.activity || 'bodyweight',
    intensity: w.intensity || 'moderate',
    exercises: (w.exercises || []).map((x) => ({ name: x.name, sets: x.sets ?? '', reps: x.reps ?? '' })),
    manualKcal: w.calories_source === 'manual' ? String(w.calories_burned) : '',
    notes: w.notes || '',
  }
}

/** Add or edit a workout. */
function fromPreset(p = {}) {
  const f = emptyForm(p.kind === 'home' ? 'home' : 'treadmill')
  if (p.duration_min) f.duration_min = String(p.duration_min)
  if (p.mode) Object.assign(f, { mode: p.mode, modeTouched: true })
  if (p.activity) f.activity = p.activity
  return f
}

export function WorkoutSheet({ date, workout, preset, onClose }) {
  const { store, units, series, profile, bumpData, toast, today } = useApp()
  const [f, setF] = useState(() => (workout ? fromWorkout(workout, units) : fromPreset(preset)))
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }))
  const imperial = units === 'imperial'
  const weightKg = series.length ? series[series.length - 1].trend : Number(profile.start_weight_kg)

  const speedKmh = f.speed ? (imperial ? mphToKmh(Number(f.speed)) : Number(f.speed)) : 0
  const minutes = Number(f.duration_min) || 0

  const record = useMemo(() => {
    const base = {
      kind: f.kind,
      log_date: date,
      duration_min: minutes,
      notes: f.notes.trim() || null,
    }
    const w =
      f.kind === 'treadmill'
        ? {
            ...base,
            name: f.name.trim() || (f.mode === 'run' ? 'Treadmill run' : 'Treadmill walk'),
            speed_kmh: speedKmh ? r1(speedKmh) : null,
            incline_pct: Number(f.incline_pct) || 0,
            mode: f.mode,
            distance_km: speedKmh && minutes ? Math.round(((speedKmh * minutes) / 60) * 100) / 100 : null,
          }
        : {
            ...base,
            name: f.name.trim() || HOME_ACTIVITIES[f.activity].label,
            activity: f.activity,
            intensity: f.intensity,
            exercises: f.exercises,
          }
    const estimate = estimateWorkoutKcal(w, weightKg)
    const manual = f.manualKcal !== '' && !Number.isNaN(Number(f.manualKcal))
    return { ...w, calories_burned: manual ? Math.round(Number(f.manualKcal)) : estimate, calories_source: manual ? 'manual' : 'estimate', estimate }
  }, [f, date, minutes, speedKmh, weightKg])

  function onSpeed(e) {
    const v = e.target.value
    setF((s) => {
      const kmh = v ? (imperial ? mphToKmh(Number(v)) : Number(v)) : 0
      return { ...s, speed: v, mode: s.modeTouched ? s.mode : kmh >= 8 ? 'run' : 'walk' }
    })
  }

  function applyTreadmillPreset(p) {
    setF((s) => ({
      ...s,
      name: p.name,
      duration_min: String(p.duration_min),
      speed: String(r1(imperial ? kmhToMph(p.speed_kmh) : p.speed_kmh)),
      incline_pct: String(p.incline_pct),
      mode: p.mode,
      modeTouched: true,
      manualKcal: '',
    }))
  }

  function applyHomePreset(p) {
    setF((s) => ({
      ...s,
      name: p.name,
      activity: p.activity,
      intensity: p.intensity,
      duration_min: String(p.duration_min),
      exercises: p.exercises.map((x) => ({ ...x })),
      manualKcal: '',
    }))
  }

  const setExercise = (i, k, v) =>
    setF((s) => ({ ...s, exercises: s.exercises.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }))

  async function run(fn, msg) {
    setBusy(true)
    try {
      await fn()
      bumpData()
      toast(msg)
      onClose()
    } catch (e) {
      toast(e.message, 'error')
      setBusy(false)
    }
  }

  const { estimate, ...toSave } = record
  // Mirror the table's check constraints so a bad value gets a clear message, not a database error.
  const incline = Number(f.incline_pct) || 0
  const problem =
    minutes > 600 ? 'Keep it under 600 minutes.'
      : f.kind === 'treadmill' && speedKmh > 25 ? `Speed looks too high (max ${imperial ? '15.5 mph' : '25 km/h'}).`
        : f.kind === 'treadmill' && (incline < -5 || incline > 40) ? 'Incline should be between −5% and 40%.'
          : f.kind === 'treadmill' && record.distance_km > 100 ? 'Distance looks too long (max 100 km).'
            : f.manualKcal !== '' && (Number.isNaN(Number(f.manualKcal)) || Number(f.manualKcal) < 0 || Number(f.manualKcal) > 5000) ? 'Your own number should be 0–5000 kcal.'
              : null
  const valid = !problem && minutes > 0 && (f.kind === 'home' || speedKmh > 0)

  return (
    <Sheet title={`${workout ? 'Edit' : 'Log'} workout · ${formatDayLabel(date, today)}`} onClose={onClose}>
      {!workout && (
        <div style={{ marginBottom: 12 }}>
          <Segmented
            value={f.kind}
            onChange={(k) => setF((s) => ({ ...emptyForm(k), notes: s.notes }))}
            options={[
              ['treadmill', 'Treadmill'],
              ['home', 'Home workout'],
            ]}
          />
        </div>
      )}

      <div className="chips" style={{ marginBottom: 12 }}>
        {(f.kind === 'treadmill' ? TREADMILL_PRESETS : HOME_PRESETS).map((p) => (
          <button key={p.name} type="button" className="chip tinted" style={{ '--c': f.kind === 'treadmill' ? 'var(--red)' : 'var(--orange)' }} onClick={() => (f.kind === 'treadmill' ? applyTreadmillPreset(p) : applyHomePreset(p))}>
            {p.name}
          </button>
        ))}
      </div>

      <label className="field">
        <span>Name (optional)</span>
        <input className="input" value={f.name} onChange={set('name')} placeholder={f.kind === 'treadmill' ? 'Treadmill walk' : 'Home workout'} />
      </label>

      {f.kind === 'treadmill' ? (
        <>
          <div className="grid3">
            <label className="field">
              <span>Minutes</span>
              <input className="input" inputMode="decimal" value={f.duration_min} onChange={set('duration_min')} />
            </label>
            <label className="field">
              <span>Speed ({imperial ? 'mph' : 'km/h'})</span>
              <input className="input" inputMode="decimal" value={f.speed} onChange={onSpeed} placeholder={imperial ? '3.5' : '5.6'} />
            </label>
            <label className="field">
              <span>Incline %</span>
              <input className="input" inputMode="decimal" value={f.incline_pct} onChange={set('incline_pct')} />
            </label>
          </div>
          <div className="field">
            <span>Walking or running?</span>
            <Segmented
              value={f.mode}
              onChange={(m) => setF((s) => ({ ...s, mode: m, modeTouched: true }))}
              options={[
                ['walk', 'Walk'],
                ['run', 'Run / jog'],
              ]}
            />
          </div>
          {record.distance_km ? (
            <p className="small muted">
              Distance ≈ {imperial ? `${r1(kmhToMph(record.distance_km))} miles` : `${r1(record.distance_km)} km`}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <label className="field">
            <span>Type</span>
            <select className="input" value={f.activity} onChange={set('activity')}>
              {Object.entries(HOME_ACTIVITIES).map(([k, a]) => (
                <option key={k} value={k}>
                  {a.label}: {a.hint}
                </option>
              ))}
            </select>
          </label>
          <div className="grid2">
            <label className="field">
              <span>Minutes</span>
              <input className="input" inputMode="decimal" value={f.duration_min} onChange={set('duration_min')} />
            </label>
            <label className="field">
              <span>Effort</span>
              <select className="input" value={f.intensity} onChange={set('intensity')}>
                {INTENSITY.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="tiny muted" style={{ margin: '4px 4px 8px', fontWeight: 500 }}>Exercises (optional)</div>
          {f.exercises.map((x, i) => (
            <div key={i} className="row" style={{ marginBottom: 6 }}>
              <input className="input grow" placeholder="Exercise" value={x.name} onChange={(e) => setExercise(i, 'name', e.target.value)} aria-label="Exercise name" />
              <input className="input" style={{ width: 56 }} inputMode="numeric" placeholder="sets" value={x.sets} onChange={(e) => setExercise(i, 'sets', e.target.value)} aria-label="Sets" />
              <input className="input" style={{ width: 84 }} placeholder="reps" value={x.reps} onChange={(e) => setExercise(i, 'reps', e.target.value)} aria-label="Reps" />
              <button type="button" className="icon-btn" aria-label="Remove exercise" onClick={() => setF((s) => ({ ...s, exercises: s.exercises.filter((_, j) => j !== i) }))}>
                <Icon name="close" size={18} />
              </button>
            </div>
          ))}
          <button type="button" className="link small" style={{ margin: '4px 4px 16px' }} onClick={() => setF((s) => ({ ...s, exercises: [...s.exercises, { name: '', sets: '', reps: '' }] }))}>
            + Add exercise
          </button>
        </>
      )}

      <div className="card tinted" style={{ '--c': 'var(--red)', padding: 14 }}>
        <div className="row between">
          <span className="small">Estimated burn</span>
          <strong className="num" style={{ color: 'var(--red)' }}>{estimate} kcal</strong>
        </div>
        <label className="field" style={{ margin: '8px 0 0' }}>
          <span>Use your own number instead (optional)</span>
          <input className="input" inputMode="numeric" placeholder="e.g. from the treadmill screen" value={f.manualKcal} onChange={set('manualKcal')} />
        </label>
        <p className="tiny muted" style={{ margin: '6px 0 0' }}>
          Net calories above resting, from {f.kind === 'treadmill' ? 'the ACSM treadmill equations' : 'published MET values'} and your weight. Treadmill screens usually show gross calories and read higher.
        </p>
      </div>

      <label className="field">
        <span>Notes (optional)</span>
        <input className="input" value={f.notes} onChange={set('notes')} placeholder="How did it feel?" />
      </label>

      {problem && (
        <p className="small" style={{ color: 'var(--danger)' }} role="alert">{problem}</p>
      )}
      <div className="stack">
        <button
          className="btn block"
          disabled={busy || !valid}
          onClick={() => run(() => (workout ? store.updateWorkout(workout.id, toSave) : store.addWorkout(toSave)), workout ? 'Workout updated' : `Logged · ${toSave.calories_burned} kcal`)}
        >
          {workout ? 'Save' : 'Log workout'}
        </button>
        {workout && (
          <button className="btn destructive block" disabled={busy} onClick={() => run(() => store.deleteWorkout(workout.id), 'Workout deleted')}>
            Delete
          </button>
        )}
      </div>
    </Sheet>
  )
}
