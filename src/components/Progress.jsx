import { useEffect, useState } from 'react'
import { useApp } from '../appContext.js'
import { adaptiveTarget, adaptiveTdee, dailyTotals, displayWeight, inputToKg, kmhToMph, projectGoalDate, weeklyRate, weightUnit, weightValue, workoutSummary } from '../lib/calc.js'
import { MOOD_BY_V, SYMPTOM_BY_ID } from '../data/glp1.js'
import { formatWater, summariseDailyLogs } from '../lib/glp1.js'
import { Glp1Progress } from './Glp1.jsx'
import { useWaterTarget } from './Checkin.jsx'
import { addDays, formatShortDate, lastNDates } from '../lib/dates.js'
import { CalorieBars, WeightChart } from './Charts.jsx'
import { Icon, Segmented } from './ui.jsx'

export default function Progress() {
  const { store, series, weights, profile, targets, today, units, toast, dataVersion, saveProfile, openSheet } = useApp()
  const [range, setRange] = useState('90')
  const [daily, setDaily] = useState({})
  const [workouts, setWorkouts] = useState([])

  useEffect(() => {
    store
      .listEntries(addDays(today, -89), today)
      .then((rows) => setDaily(dailyTotals(rows)))
      .catch((e) => toast(e.message, 'error'))
    store
      .listWorkouts(addDays(today, -27), today)
      .then(setWorkouts)
      .catch(() => setWorkouts([]))
  }, [store, today, dataVersion, toast])

  const last = series[series.length - 1]
  const startKg = Number(profile.start_weight_kg)
  const goalKg = Number(profile.goal_weight_kg)
  const rate = weeklyRate(series)
  const eta = projectGoalDate(series, goalKg, today, rate)
  const adaptive = adaptiveTdee({ daily, series, endDate: addDays(today, -1) })

  const week = lastNDates(addDays(today, -1), 7)
  const loggedWeek = week.filter((d) => daily[d]?.calories >= 500)
  const avgWeek = loggedWeek.length ? Math.round(loggedWeek.reduce((s, d) => s + daily[d].calories, 0) / loggedWeek.length) : null

  const fromDate = range === 'all' ? '0000-01-01' : addDays(today, -Number(range) + 1)
  const signed = (kg) => {
    const v = weightValue(kg, units)
    return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} ${weightUnit(units)}`
  }

  // Measured maintenance minus the deficit for the chosen pace. (It used to
  // subtract the gap to the current target, so each tap lowered it again.)
  const suggestedTarget = adaptiveTarget(adaptive, targets)
  async function adoptAdaptive() {
    const newTarget = suggestedTarget
    try {
      await saveProfile({ ...profile, calorie_target_override: newTarget })
      toast(`Target set to ${newTarget} kcal`)
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  return (
    <div>
      <h1>Progress</h1>

      <div className="stats" style={{ marginBottom: 14 }}>
        <Stat label="Trend" color="var(--blue)" value={last ? displayWeight(last.trend, units) : '—'} />
        <Stat label="Since start" color="var(--green)" value={last ? signed(last.trend - startKg) : '—'} />
        <Stat label="To goal" color="var(--teal)" value={last && goalKg ? signed(goalKg - last.trend) : '—'} />
        <Stat label="Per week" color="var(--purple)" value={rate == null ? '—' : signed(rate)} />
        <Stat label="Goal ETA" color="var(--pink)" value={eta ? formatShortDate(eta) : '—'} />
        <Stat label="7-day avg" color="var(--orange)" value={avgWeek ? `${avgWeek}` : '—'} sub={avgWeek && targets ? `of ${targets.calories} kcal` : 'no full days'} />
      </div>

      <section className="card">
        <div className="row between" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Weight</h2>
          <div style={{ width: 160 }}>
            <Segmented value={range} onChange={setRange} options={[['30', '30d'], ['90', '90d'], ['all', 'All']]} />
          </div>
        </div>
        <WeightChart series={series} goalKg={goalKg} units={units} fromDate={fromDate} toDate={today} />
      </section>

      <LogWeight />

      <section className="card">
        <h2>Calories, last 14 days</h2>
        <CalorieBars dates={lastNDates(today, 14)} daily={daily} target={targets?.calories || 0} />
        <p className="tiny muted" style={{ margin: '6px 0 0' }}>Green = on target. Orange = over. Grey = nothing logged.</p>
      </section>

      <ExerciseSummary workouts={workouts} today={today} units={units} />

      <Glp1Progress onEditDose={(d) => openSheet('dose', { date: d.log_date, dose: d })} onSetup={() => openSheet('medication')} />

      <Wellbeing today={today} />

      <section className="card">
        <h2>Your real maintenance</h2>
        {adaptive ? (
          <>
            <p>
              About <strong className="num">{adaptive.tdee} kcal/day</strong>{' '}
              <span className={`badge ${adaptive.confidence === 'high' ? 'jam' : adaptive.confidence === 'low' ? 'off' : 'usda'}`}>{adaptive.confidence} confidence</span>
            </p>
            <p className="small muted">
              You averaged {adaptive.avgIntake} kcal over {adaptive.loggedDays} logged days while your trend moved{' '}
              {signed(adaptive.trendChangeKg)} in {adaptive.spanDays} days. The formula estimate was {targets?.tdee ?? '—'} kcal.
            </p>
            {suggestedTarget && Math.abs(adaptive.tdee - targets.tdee) >= 150 && suggestedTarget !== targets.calories && (
              <button className="btn secondary sm" onClick={adoptAdaptive}>
                Base my target on this ({suggestedTarget} kcal)
              </button>
            )}
            <p className="tiny muted" style={{ marginTop: 8, marginBottom: 0 }}>
              Only as accurate as your logging. Days with under 500 kcal logged are ignored as incomplete.
            </p>
          </>
        ) : (
          <p className="small muted">
            Log food on at least 10 of the last 21 days and weigh in across 10+ days. The app will then work out what you really burn, which is usually
            more useful than any formula.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Weigh-ins</h2>
        <WeightList weights={weights} />
      </section>
    </div>
  )
}

/** Mood, water and symptoms over the last 14 days. */
function Wellbeing({ today }) {
  const { store, dataVersion, openSheet } = useApp()
  const waterTarget = useWaterTarget()
  const [logs, setLogs] = useState(null)
  const dates = lastNDates(today, 14)
  useEffect(() => {
    let cancelled = false
    store
      .listDailyLogs(dates[0], today)
      .then((rows) => !cancelled && setLogs(rows))
      .catch(() => !cancelled && setLogs([]))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, today, dataVersion])
  if (!logs) return null
  const byDate = Object.fromEntries(logs.map((l) => [l.log_date, l]))
  const sum = summariseDailyLogs(logs)
  return (
    <section className="card">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Wellbeing, 14 days</h2>
        <button className="btn sm secondary" onClick={() => openSheet('mood', { date: today, daily: byDate[today] })}>Check in</button>
      </div>
      <div className="mood-strip" aria-label="Mood for each of the last 14 days">
        {dates.map((d) => {
          const m = MOOD_BY_V[byDate[d]?.mood]
          return (
            <span key={d} className={`mood-cell${m ? ' has' : ''}`} title={`${formatShortDate(d)}: ${m ? m.label : 'no check-in'}`} style={{ '--c': m?.color }}>
              {m ? m.emoji : ''}
            </span>
          )
        })}
      </div>
      <div className="stats" style={{ marginTop: 12 }}>
        <Stat label="Mood" color="var(--yellow)" value={sum.mood ? MOOD_BY_V[Math.round(sum.mood)]?.label : '—'} sub={sum.mood ? `${sum.mood} / 5 avg` : 'no check-ins'} />
        <Stat label="Water" color="var(--cyan)" value={sum.waterMl ? formatWater(sum.waterMl) : '—'} sub={`goal ${formatWater(waterTarget)}`} />
        <Stat label="Energy" color="var(--green)" value={sum.energy ? `${sum.energy}/5` : '—'} sub="average" />
      </div>
      {sum.symptoms.length > 0 && (
        <p className="small muted" style={{ margin: '10px 0 0' }}>
          Most common: {sum.symptoms.slice(0, 3).map(([id, n]) => `${SYMPTOM_BY_ID[id]?.label || id} (${n} day${n > 1 ? 's' : ''})`).join(', ')}.
        </p>
      )}
    </section>
  )
}

function ExerciseSummary({ workouts, today, units }) {
  const week = workoutSummary(workouts.filter((w) => w.log_date > addDays(today, -7)))
  const month = workoutSummary(workouts)
  const km = (v) => (units === 'imperial' ? `${(Math.round(kmhToMph(v) * 10) / 10).toFixed(1)} mi` : `${v.toFixed(1)} km`)
  return (
    <section className="card">
      <h2>Exercise, last 7 days</h2>
      <div className="stats" style={{ marginBottom: 8 }}>
        <Stat inner label="Sessions" color="var(--red)" value={week.sessions} />
        <Stat inner label="Minutes" color="var(--orange)" value={week.minutes} />
        <Stat inner label="Burned" color="var(--pink)" value={week.kcal} sub="net kcal" />
        <Stat inner label="Strength" color="var(--purple)" value={`${week.strength}/2+`} sub="sessions" />
        <Stat inner label="Treadmill" color="var(--blue)" value={week.treadmill} sub={week.treadmillKm ? km(week.treadmillKm) : 'sessions'} />
        <Stat inner label="28 days" color="var(--teal)" value={month.sessions} sub={`${month.minutes} min`} />
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>
        Aim for 2–3 strength sessions a week to keep muscle while you lose fat, plus walking or treadmill for steps.
      </p>
    </section>
  )
}

function Stat({ label, value, sub, color, inner }) {
  return (
    <div className="stat" style={{ '--c': color, background: inner ? 'var(--card-2)' : undefined }}>
      <div className="l">{label}</div>
      <div className="v num">{value}</div>
      {sub && <div className="s">{sub}</div>}
    </div>
  )
}

function LogWeight() {
  const { store, today, units, reloadWeights, toast } = useApp()
  const [date, setDate] = useState(today)
  const [val, setVal] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(e) {
    e.preventDefault()
    const kg = inputToKg(val, units)
    if (!date || date > today) return toast('Pick a date up to today', 'error')
    if (!kg || kg < 30 || kg > 350) return toast('Enter a realistic weight', 'error')
    setBusy(true)
    try {
      await store.upsertWeight({ log_date: date, weight_kg: Math.round(kg * 100) / 100 })
      await reloadWeights()
      setVal('')
      toast('Weight saved')
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="card" onSubmit={save}>
      <h2>Log weight</h2>
      <div className="row">
        <input className="input" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} style={{ flex: 1.3 }} aria-label="Date" />
        <input className="input" inputMode="decimal" placeholder={weightUnit(units)} value={val} onChange={(e) => setVal(e.target.value)} style={{ flex: 1 }} aria-label="Weight" />
        <button className="btn" disabled={busy || !val} style={{ minHeight: 46 }}>Save</button>
      </div>
    </form>
  )
}

function WeightList({ weights }) {
  const { store, units, reloadWeights, toast } = useApp()
  const [showAll, setShowAll] = useState(false)
  const list = [...weights].reverse()
  const shown = showAll ? list : list.slice(0, 7)
  async function remove(w) {
    if (!window.confirm(`Delete the ${formatShortDate(w.log_date)} weigh-in (${displayWeight(Number(w.weight_kg), units)})?`)) return
    try {
      await store.deleteWeight(w.id)
      await reloadWeights()
    } catch (e) {
      toast(e.message, 'error')
    }
  }
  if (!list.length) return <p className="small muted">No weigh-ins yet.</p>
  return (
    <div>
      {shown.map((w) => (
        <div key={w.id} className="row between" style={{ padding: '6px 0', borderTop: '0.5px solid var(--sep)' }}>
          <span>{formatShortDate(w.log_date)}</span>
          <span className="row">
            <strong className="num">{displayWeight(Number(w.weight_kg), units)}</strong>
            <button className="icon-btn" aria-label="Delete weigh-in" style={{ width: 36, height: 36, color: 'var(--red)' }} onClick={() => remove(w)}>
              <Icon name="trash" size={18} />
            </button>
          </span>
        </div>
      ))}
      {list.length > 7 && (
        <button className="link small" onClick={() => setShowAll((s) => !s)}>
          {showAll ? 'Show less' : `Show all ${list.length}`}
        </button>
      )}
    </div>
  )
}
