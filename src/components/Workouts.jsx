import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../appContext.js'
import { HOME_ACTIVITIES, activityKcal, estimateWorkoutKcal, exerciseAllowance, kmhToMph, mphToKmh, workoutSummary } from '../lib/calc.js'
import { addDays, formatDayLabel, formatShortDate } from '../lib/dates.js'
import { useDay } from '../lib/useDay.js'
import { HOME_PRESETS, TREADMILL_PRESETS } from '../data/workouts.js'
import { WORKOUT_CHOICES, WORKOUT_GROUPS, WORKOUT_TYPE_BY_KEY, workoutTypeForName } from '../data/appleWorkouts.js'
import { Icon, Segmented, Sheet, Spinner } from './ui.jsx'

const r1 = (n) => Math.round(n * 10) / 10
const INTENSITY = [
  ['light', 'Light'],
  ['moderate', 'Moderate'],
  ['hard', 'Hard'],
]

const distanceText = (km, units) => (km ? (units === 'imperial' ? `${r1(kmhToMph(Number(km)))} mi` : `${r1(Number(km))} km`) : null)

export function workoutDetail(w, units) {
  if (w.kind === 'other') return [`${Math.round(w.duration_min)} min`, distanceText(w.distance_km, units)].filter(Boolean).join(' · ')
  if (w.kind === 'treadmill') {
    const speed = w.speed_kmh ? (units === 'imperial' ? `${r1(kmhToMph(w.speed_kmh))} mph` : `${r1(w.speed_kmh)} km/h`) : null
    const incline = w.incline_pct ? `${r1(w.incline_pct)}% incline` : null
    return [`${Math.round(w.duration_min)} min`, speed, incline].filter(Boolean).join(' · ')
  }
  const a = HOME_ACTIVITIES[w.activity]
  return [`${Math.round(w.duration_min)} min`, a?.label, w.intensity].filter(Boolean).join(' · ')
}

export const workoutLook = (w) =>
  w.kind === 'treadmill' ? { icon: 'run', color: 'var(--red)' }
    : w.kind === 'other' ? { icon: 'bolt', color: 'var(--green)' }
      : { icon: w.source === 'apple' ? 'flame' : 'house', color: 'var(--orange)' }

function WorkoutRow({ w, units, onEdit, showDate }) {
  const look = workoutLook(w)
  return (
    <button className="list-row has-icon" onClick={() => onEdit(w)}>
      <span className="row-icon" style={{ '--c': look.color }}>
        <Icon name={look.icon} />
      </span>
      <span className="label">
        <span className="ellipsis" style={{ display: 'block' }}>
          {w.name}
          {w.source === 'apple' && <> <span className="badge fitness">Fitness</span></>}
        </span>
        <span className="sub ellipsis">{showDate ? `${formatShortDate(w.log_date)} · ` : ''}{workoutDetail(w, units)}</span>
      </span>
      <span className="entry-kcal">{w.calories_burned}</span>
    </button>
  )
}

/** The day's workouts plus an Add button (in the Workouts sheet). */
export function ExerciseCard({ workouts, error, onAdd, onEdit, allowance }) {
  const { units } = useApp()
  const burned = workouts.reduce((s, w) => s + (Number(w.calories_burned) || 0), 0)
  return (
    <section>
      <div className="list-header">Exercise{burned > 0 ? ` · ${burned} kcal` : ''}</div>
      <div className="list">
        {error && <div className="list-row small danger-text">{error}</div>}
        {workouts.map((w) => (
          <WorkoutRow key={w.id} w={w} units={units} onEdit={onEdit} />
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

/**
 * The Workouts section: the day's sessions, Apple Fitness import and the last
 * 30 days. Opened from the Dashboard, so the Dashboard itself stays small.
 */
export function WorkoutsSheet({ date, onClose }) {
  const { store, units, profile, today, openSheet, dataVersion } = useApp()
  const day = useDay(date)
  const [recent, setRecent] = useState(null)
  const isToday = date === today
  const workouts = day?.workouts || []
  const burned = workouts.reduce((s, w) => s + (Number(w.calories_burned) || 0), 0)
  const allowance = exerciseAllowance(burned, profile.exercise_eatback_pct)

  useEffect(() => {
    let cancelled = false
    store
      .listWorkouts(addDays(today, -29), today)
      .then((w) => !cancelled && setRecent(w))
      .catch(() => !cancelled && setRecent([]))
    return () => {
      cancelled = true
    }
  }, [store, today, dataVersion])

  const others = (recent || []).filter((w) => w.log_date !== date).sort((a, b) => (a.log_date < b.log_date ? 1 : a.log_date > b.log_date ? -1 : 0))
  const month = workoutSummary(recent || [])
  const edit = (w) => openSheet('workout', { date: w.log_date, workout: w })

  return (
    <Sheet title={`Workouts${isToday ? '' : ` · ${formatDayLabel(date, today)}`}`} onClose={onClose}>
      <ExerciseCard workouts={workouts} error={day?.workoutError} allowance={allowance} onAdd={() => openSheet('workout', { date })} onEdit={edit} />

      <div className="list" style={{ marginTop: 14 }}>
        <button className="list-row has-icon" onClick={() => openSheet('workout', { date, preset: { kind: 'other' } })}>
          <span className="row-icon" style={{ '--c': 'var(--indigo)' }} aria-hidden="true">
            <Icon name="grid" strokeWidth={2.2} />
          </span>
          <span className="label">
            Browse {WORKOUT_CHOICES.length} workout types
            <span className="sub">Cycling, swimming, dance, cricket, tennis…</span>
          </span>
          <svg className="chev" viewBox="0 0 8 14" aria-hidden="true">
            <path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button className="list-row has-icon" onClick={() => openSheet('appleImport')}>
          <span className="row-icon fitness-icon" aria-hidden="true">
            <Icon name="heart" strokeWidth={2.4} />
          </span>
          <span className="label">
            Import from Apple Fitness
            <span className="sub">Search your Health export and pick workouts</span>
          </span>
          <svg className="chev" viewBox="0 0 8 14" aria-hidden="true">
            <path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="list-header">
        Last 30 days{month.sessions ? <span className="no-caps"> · {month.sessions} sessions · {month.minutes} min · {month.kcal.toLocaleString('en-GB')} kcal</span> : ''}
      </div>
      {recent === null ? (
        <div className="center" style={{ padding: 20, color: 'var(--text-3)' }}><Spinner /></div>
      ) : others.length ? (
        <div className="list">
          {others.slice(0, 40).map((w) => (
            <WorkoutRow key={w.id} w={w} units={units} onEdit={edit} showDate />
          ))}
        </div>
      ) : (
        <p className="list-footer">Nothing else in the last 30 days yet.</p>
      )}
    </Sheet>
  )
}

/**
 * Every workout type Apple's Workout app offers, searchable and grouped, with
 * a rough burn for 30 minutes at your weight.
 */
function WorkoutPicker({ onPick, weightKg }) {
  const [q, setQ] = useState('')
  const [group, setGroup] = useState('all')
  const query = q.toLowerCase().trim()
  const shown = WORKOUT_CHOICES.filter((c) => (group === 'all' || c.type.group === group) && (!query || `${c.name} ${WORKOUT_GROUPS[c.type.group].label}`.toLowerCase().includes(query)))
  const groups = Object.keys(WORKOUT_GROUPS).filter((g) => shown.some((c) => c.type.group === g))
  return (
    <div className="workout-picker">
      <div className="search-field" style={{ marginBottom: 10 }}>
        <Icon name="search" />
        <input className="input" type="search" placeholder={`Search ${WORKOUT_CHOICES.length} workouts`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search workout types" />
      </div>
      <div className="chips" style={{ marginBottom: 4 }}>
        <button type="button" className={`chip${group === 'all' ? ' tinted' : ''}`} onClick={() => setGroup('all')}>All</button>
        {Object.entries(WORKOUT_GROUPS).map(([g, info]) => (
          <button key={g} type="button" className={`chip${group === g ? ' tinted' : ''}`} style={{ '--c': info.color }} onClick={() => setGroup(group === g ? 'all' : g)}>
            {info.label}
          </button>
        ))}
      </div>
      {groups.map((g) => (
        <div key={g}>
          <div className="list-header">{WORKOUT_GROUPS[g].label}</div>
          <div className="list">
            {shown.filter((c) => c.type.group === g).map((c) => (
              <button key={c.id} type="button" className="list-row has-icon" onClick={() => onPick(c)}>
                <span className="row-icon" style={{ '--c': WORKOUT_GROUPS[g].color }}>
                  <Icon name={WORKOUT_GROUPS[g].icon} strokeWidth={2.2} />
                </span>
                <span className="label">{c.name}</span>
                {weightKg ? <span className="value small num">≈ {activityKcal({ weightKg, minutes: 30, met: c.type.met })} kcal</span> : null}
              </button>
            ))}
          </div>
        </div>
      ))}
      {groups.length > 0 && weightKg ? <p className="list-footer">Burn shown for 30 minutes at a moderate effort, for your weight.</p> : null}
      {!groups.length && <p className="list-footer">No workout called “{q}”. Pick Other workout and name it yourself.</p>}
    </div>
  )
}

function emptyForm(kind) {
  return {
    kind,
    name: '',
    duration_min: kind === 'home' ? '20' : '30',
    type: null, // kind 'other': the chosen entry in WORKOUT_TYPES
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
    manualKcal: w.calories_source === 'manual' || w.calories_source === 'device' ? String(w.calories_burned) : '',
    distance_km: w.distance_km,
    type: w.kind === 'other' ? workoutTypeForName(w.name) : null,
    notes: w.notes || '',
  }
}

/** Add or edit a workout. */
function fromPreset(p = {}) {
  const f = emptyForm(p.kind === 'home' || p.kind === 'other' ? p.kind : 'treadmill')
  if (p.typeKey && WORKOUT_TYPE_BY_KEY[p.typeKey]) Object.assign(f, { type: WORKOUT_TYPE_BY_KEY[p.typeKey], choice: p.name || null })
  if (p.duration_min) f.duration_min = String(p.duration_min)
  if (p.mode) Object.assign(f, { mode: p.mode, modeTouched: true })
  if (p.activity) f.activity = p.activity
  return f
}

export function WorkoutSheet({ date, workout, preset, onClose }) {
  const { store, units, currentWeightKg, profile, bumpData, toast, today, openSheet } = useApp()
  const [f, setF] = useState(() => (workout ? fromWorkout(workout, units) : fromPreset(preset)))
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }))
  const imperial = units === 'imperial'
  const weightKg = currentWeightKg || Number(profile.start_weight_kg)

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
      f.kind === 'other'
        ? {
            ...base,
            name: f.name.trim() || f.choice || workout?.name || f.type?.label || 'Workout',
            activity: f.type?.fallback || f.activity,
            intensity: f.intensity,
            distance_km: f.distance_km ?? null,
            met: f.type?.met,
          }
        : f.kind === 'treadmill'
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
    // Apple's own figure stays marked as from the watch until it's changed.
    const fromDevice = workout?.calories_source === 'device' && manual && Math.round(Number(f.manualKcal)) === Number(workout.calories_burned)
    return {
      ...w,
      source: workout?.source ?? null,
      calories_burned: manual ? Math.round(Number(f.manualKcal)) : estimate,
      calories_source: fromDevice ? 'device' : manual ? 'manual' : 'estimate',
      estimate,
    }
  }, [f, date, minutes, speedKmh, weightKg, workout])

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

  async function run(fn, msg, action) {
    setBusy(true)
    try {
      await fn()
      bumpData()
      toast(msg, 'info', action)
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
  const needsSpeed = f.kind === 'treadmill' && !(speedKmh > 0)
  const picking = f.kind === 'other' && !f.type && !workout
  const valid = !problem && minutes > 0 && !needsSpeed && !picking
  const undoDelete = workout && {
    label: 'Undo',
    run: async () => {
      try {
        // Imported workouts keep their id, so a later import still knows them.
        await (workout.source === 'apple' ? store.importWorkouts([workout]) : store.addWorkout(workout))
        bumpData()
      } catch (e) {
        toast(e.message, 'error')
      }
    },
  }

  return (
    <Sheet title={`${workout ? 'Edit' : 'Log'} workout · ${formatDayLabel(date, today)}`} onClose={onClose}>
      {!workout && (
        <div style={{ marginBottom: 12 }}>
          <Segmented
            value={f.kind}
            onChange={(k) => setF((s) => ({ ...emptyForm(k), notes: s.notes }))}
            options={[
              ['treadmill', 'Treadmill'],
              ['home', 'Home'],
              ['other', `All ${WORKOUT_CHOICES.length}`],
            ]}
          />
        </div>
      )}

      {!workout && (
        <button type="button" className="link small fitness-link" onClick={() => openSheet('appleImport')}>
          <Icon name="heart" size={15} strokeWidth={2.4} /> Import from Apple Fitness instead
        </button>
      )}

      {picking ? (
        <WorkoutPicker
          weightKg={weightKg}
          onPick={(c) => setF((st) => ({ ...st, type: c.type, choice: c.name, name: '', manualKcal: '' }))}
        />
      ) : (
        <>
      {f.kind !== 'other' && <div className="chips" style={{ marginBottom: 12 }}>
        {(f.kind === 'treadmill' ? TREADMILL_PRESETS : HOME_PRESETS).map((p) => (
          <button key={p.name} type="button" className="chip tinted" style={{ '--c': f.kind === 'treadmill' ? 'var(--red)' : 'var(--orange)' }} onClick={() => (f.kind === 'treadmill' ? applyTreadmillPreset(p) : applyHomePreset(p))}>
            {p.name}
          </button>
        ))}
      </div>}

      {f.kind === 'other' && !workout && f.type && (
        <div className="list" style={{ marginBottom: 14 }}>
          <button type="button" className="list-row has-icon" onClick={() => setF((st) => ({ ...st, type: null, choice: null }))}>
            <span className="row-icon" style={{ '--c': WORKOUT_GROUPS[f.type.group].color }}>
              <Icon name={WORKOUT_GROUPS[f.type.group].icon} strokeWidth={2.2} />
            </span>
            <span className="label">
              {f.choice || f.type.label}
              <span className="sub">{WORKOUT_GROUPS[f.type.group].label}</span>
            </span>
            <span className="value" style={{ color: 'var(--tint)' }}>Change</span>
          </button>
        </div>
      )}

      <label className="field">
        <span>Name (optional)</span>
        <input className="input" value={f.name} onChange={set('name')} placeholder={f.kind === 'treadmill' ? 'Treadmill walk' : f.kind === 'other' ? f.choice || f.type?.label || 'Workout' : 'Home workout'} />
      </label>

      {f.kind === 'other' ? (
        <>
          <div className="grid2">
            <label className="field">
              <span>Minutes</span>
              <input className="input" inputMode="decimal" value={f.duration_min} onChange={set('duration_min')} />
            </label>
            {f.distance_km ? (
              <div className="field">
                <span>Distance</span>
                <div className="input readonly num">{distanceText(f.distance_km, units)}</div>
              </div>
            ) : (
              <label className="field">
                <span>Effort</span>
                <select className="input" value={f.intensity} onChange={set('intensity')}>
                  {INTENSITY.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </>
      ) : f.kind === 'treadmill' ? (
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
          {needsSpeed ? (
            <span className="small muted">Enter a speed</span>
          ) : (
            <strong className="num" style={{ color: 'var(--red)' }}>{estimate} kcal</strong>
          )}
        </div>
        <label className="field" style={{ margin: '8px 0 0' }}>
          <span>Use your own number instead (optional)</span>
          <input className="input" inputMode="numeric" placeholder={f.kind === 'treadmill' ? 'e.g. from the treadmill screen' : 'e.g. from your watch'} value={f.manualKcal} onChange={set('manualKcal')} />
        </label>
        <p className="tiny muted" style={{ margin: '6px 0 0' }}>
          {record.calories_source === 'device'
            ? 'Using Apple’s active energy for this workout: calories above resting, as the app counts them.'
            : f.kind === 'treadmill'
              ? 'Net calories above resting, from the ACSM treadmill equations and your weight. Treadmill screens usually show gross calories and read higher.'
              : 'Net calories above resting, from published MET values for this activity, your effort and your weight.'}
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
          <button className="btn destructive block" disabled={busy} onClick={() => run(() => store.deleteWorkout(workout.id), 'Workout deleted', undoDelete)}>
            Delete
          </button>
        )}
      </div>
        </>
      )}
    </Sheet>
  )
}
