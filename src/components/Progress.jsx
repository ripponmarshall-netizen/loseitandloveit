import { useEffect, useState } from 'react'
import { useApp } from '../appContext.js'
import { adaptiveCalorieTarget, adaptiveTdee, dailyTotals, displayWeight, inputToKg, kmhToMph, projectGoalDate, weeklyRate, weightUnit, weightValue, workoutSummary } from '../lib/calc.js'
import { addDays, formatShortDate, lastNDates } from '../lib/dates.js'
import { CalorieBars, WeightChart } from './Charts.jsx'
import { Segmented } from './ui.jsx'

export default function Progress() {
  const { store, series, weights, profile, targets, today, units, toast, dataVersion, saveProfile } = useApp()
  const [range, setRange] = useState('90')
  const [daily, setDaily] = useState({})
  const [workouts, setWorkouts] = useState([])

  useEffect(() => {
    let cancelled = false
    store
      .listEntries(addDays(today, -89), today)
      .then((rows) => !cancelled && setDaily(dailyTotals(rows)))
      .catch((e) => !cancelled && toast(e.message, 'error'))
    store
      .listWorkouts(addDays(today, -27), today)
      .then((rows) => !cancelled && setWorkouts(rows))
      .catch(() => !cancelled && setWorkouts([]))
    return () => {
      cancelled = true
    }
  }, [store, today, dataVersion, toast])

  const last = series[series.length - 1]
  const startKg = Number(profile.start_weight_kg)
  const goalKg = Number(profile.goal_weight_kg)
  const rate = weeklyRate(series)
  const eta = projectGoalDate(series, goalKg, today, rate)
  const adaptive = adaptiveTdee({ daily, series, endDate: addDays(today, -1) })
  const targetKcal = targets?.calories ?? 0
  const suggested = adaptive && targets ? adaptiveCalorieTarget(adaptive.tdee, targets.plannedWeeklyLossKg, profile.sex) : null

  const week = lastNDates(addDays(today, -1), 7)
  const loggedWeek = week.filter((d) => daily[d]?.calories >= 500)
  const avgWeek = loggedWeek.length ? Math.round(loggedWeek.reduce((s, d) => s + daily[d].calories, 0) / loggedWeek.length) : null

  const fromDate = range === 'all' ? '0000-01-01' : addDays(today, -Number(range) + 1)
  const signed = (kg) => {
    const v = weightValue(kg, units)
    return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} ${weightUnit(units)}`
  }

  async function adoptAdaptive() {
    try {
      await saveProfile({ ...profile, calorie_target_override: suggested })
      toast(`Target set to ${suggested} kcal`)
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  return (
    <div>
      <h1>Progress</h1>

      <div className="stats" style={{ marginBottom: 12 }}>
        <Stat label="Trend" value={last ? displayWeight(last.trend, units) : '—'} />
        <Stat label="Since start" value={last ? signed(last.trend - startKg) : '—'} />
        <Stat label="To goal" value={last && goalKg ? signed(goalKg - last.trend) : '—'} />
        <Stat label="Per week" value={rate == null ? '—' : signed(rate)} />
        <Stat label="Goal ETA" value={eta ? formatShortDate(eta) : '—'} />
        <Stat label="7-day avg" value={avgWeek ? `${avgWeek}` : '—'} sub={avgWeek ? `of ${targetKcal} kcal` : 'no full days'} />
      </div>

      <section className="card">
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Weight</h2>
          <div style={{ width: 170 }}>
            <Segmented value={range} onChange={setRange} options={[['30', '30d'], ['90', '90d'], ['all', 'All']]} />
          </div>
        </div>
        <WeightChart series={series} goalKg={goalKg} units={units} fromDate={fromDate} toDate={today} />
      </section>

      <LogWeight />

      <section className="card">
        <h2>Calories, last 14 days</h2>
        <CalorieBars dates={lastNDates(today, 14)} daily={daily} target={targetKcal} />
        <p className="tiny muted" style={{ margin: 0 }}>Grey = nothing logged. Orange = over target (before any exercise allowance).</p>
      </section>

      <ExerciseSummary workouts={workouts} today={today} units={units} />

      <section className="card">
        <h2>Your real maintenance</h2>
        {adaptive ? (
          <>
            <p>
              About <strong className="num">{adaptive.tdee} kcal/day</strong>{' '}
              <span className="tag">{adaptive.confidence} confidence</span>
            </p>
            <p className="small muted">
              You averaged {adaptive.avgIntake} kcal over {adaptive.loggedDays} logged days while your trend moved{' '}
              {signed(adaptive.trendChangeKg)} in {adaptive.spanDays} days. The formula estimate was {targets?.tdee ?? '—'} kcal.
            </p>
            {suggested != null && Math.abs(suggested - targetKcal) >= 100 && (
              <button className="btn soft sm" onClick={adoptAdaptive}>
                Base my target on this ({suggested} kcal)
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

function ExerciseSummary({ workouts, today, units }) {
  const week = workoutSummary(workouts.filter((w) => w.log_date > addDays(today, -7)))
  const month = workoutSummary(workouts)
  const km = (v) => (units === 'imperial' ? `${(Math.round(kmhToMph(v) * 10) / 10).toFixed(1)} mi` : `${v.toFixed(1)} km`)
  return (
    <section className="card">
      <h2>Exercise, last 7 days</h2>
      <div className="stats" style={{ marginBottom: 8 }}>
        <Stat label="Sessions" value={week.sessions} />
        <Stat label="Minutes" value={week.minutes} />
        <Stat label="Burned" value={week.kcal} sub="net kcal" />
        <Stat label="Strength" value={`${week.strength}/2+`} sub="sessions" />
        <Stat label="Treadmill" value={week.treadmill} sub={week.treadmillKm ? km(week.treadmillKm) : 'sessions'} />
        <Stat label="28 days" value={month.sessions} sub={`${month.minutes} min`} />
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>
        Aim for 2–3 strength sessions a week to keep muscle while you lose fat, plus walking or treadmill for steps.
      </p>
    </section>
  )
}

function Stat({ label, value, sub }) {
  return (
    <div className="stat">
      <div className="l">{label}</div>
      <div className="v num">{value}</div>
      {sub && <div className="tiny muted">{sub}</div>}
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
        <button className="btn" disabled={busy || !val}>Save</button>
      </div>
    </form>
  )
}

function WeightList({ weights }) {
  const { store, units, reloadWeights, toast } = useApp()
  const [showAll, setShowAll] = useState(false)
  const list = [...weights].reverse()
  const shown = showAll ? list : list.slice(0, 7)
  async function remove(id) {
    try {
      await store.deleteWeight(id)
      await reloadWeights()
    } catch (e) {
      toast(e.message, 'error')
    }
  }
  if (!list.length) return <p className="small muted">No weigh-ins yet.</p>
  return (
    <div>
      {shown.map((w) => (
        <div key={w.id} className="row between" style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
          <span>{formatShortDate(w.log_date)}</span>
          <span className="row">
            <strong className="num">{displayWeight(Number(w.weight_kg), units)}</strong>
            <button className="icon-btn" aria-label="Delete weigh-in" style={{ width: 36, height: 36, fontSize: 16 }} onClick={() => remove(w.id)}>
              🗑
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
