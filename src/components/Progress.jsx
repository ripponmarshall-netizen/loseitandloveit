import { useEffect, useState } from 'react'
import { useApp } from '../appContext.js'
import { adaptiveTdee, dailyTotals, displayWeight, hasCondition, kmhToMph, milestones, projectGoalDate, weeklyRate, weightUnit, weightValue, workoutSummary } from '../lib/calc.js'
import { addDays, formatEta, formatShortDate, lastNDates } from '../lib/dates.js'
import { CalorieBars, WeightChart } from './Charts.jsx'
import { Segmented } from './ui.jsx'
import { WeightSheet, weightDelta } from './Weight.jsx'

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

  const week = lastNDates(addDays(today, -1), 7)
  const loggedWeek = week.filter((d) => daily[d]?.calories >= 500)
  const avgWeek = loggedWeek.length ? Math.round(loggedWeek.reduce((s, d) => s + daily[d].calories, 0) / loggedWeek.length) : null

  const fromDate = range === 'all' ? '0000-01-01' : addDays(today, -Number(range) + 1)
  const toGoal = last && goalKg ? last.trend - goalKg : null
  const signed = (kg) => {
    const v = weightValue(kg, units)
    return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} ${weightUnit(units)}`
  }

  async function adoptAdaptive() {
    const plannedDeficit = targets.tdee - targets.calories
    const newTarget = Math.round((adaptive.tdee - Math.max(0, plannedDeficit)) / 10) * 10
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

      <div className="stats" style={{ marginBottom: 12 }}>
        <Stat label="Trend" value={last ? displayWeight(last.trend, units) : '—'} />
        <Stat label="Since start" value={last ? signed(last.trend - startKg) : '—'} />
        <Stat
          label="To goal"
          value={toGoal == null ? '—' : toGoal <= 0 ? 'Reached' : `${weightValue(toGoal, units).toFixed(1)} ${weightUnit(units)}`}
          sub={toGoal > 0 ? 'to go' : undefined}
        />
        <Stat label="Per week" value={rate == null ? '—' : signed(rate)} />
        <Stat label="Goal ETA" value={eta ? formatEta(eta, today) : '—'} />
        <Stat label="7-day avg" value={avgWeek ? `${avgWeek}` : '—'} sub={avgWeek ? `of ${targets.calories} kcal` : 'no full days'} />
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

      <WeighIns weights={weights} />

      <Milestones startKg={startKg} currentKg={last?.trend} units={units} pcos={hasCondition(profile, 'pcos')} />

      <section className="card">
        <h2>Calories, last 14 days</h2>
        <CalorieBars dates={lastNDates(today, 14)} daily={daily} target={targets.calories} />
        <p className="tiny muted" style={{ margin: 0 }}>Grey = nothing logged. Orange = over target.</p>
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
              {signed(adaptive.trendChangeKg)} in {adaptive.spanDays} days. The formula estimate was {targets.tdee} kcal.
            </p>
            {Math.abs(adaptive.tdee - targets.tdee) >= 150 && (
              <button className="btn soft sm" onClick={adoptAdaptive}>
                Base my target on this ({Math.round((adaptive.tdee - Math.max(0, targets.tdee - targets.calories)) / 10) * 10} kcal)
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
        <Stat label="Minutes" value={week.minutes} sub="aim 150+" />
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

function Milestones({ startKg, currentKg, units, pcos }) {
  const list = milestones(startKg, currentKg)
  if (!list.length) return null
  return (
    <section className="card">
      <h2>Health milestones</h2>
      {list.map((m) => (
        <div key={m.pct} className="macro">
          <div className="row between small">
            <span>
              {m.pct}% lost · {displayWeight(m.targetKg, units)}
            </span>
            <span className="num muted">{m.reached ? 'Done ✓' : `${Math.round(m.progress * 100)}%`}</span>
          </div>
          <div className="bar">
            <i style={{ width: `${m.progress * 100}%`, background: m.reached ? 'var(--ok)' : 'var(--brand)' }} />
          </div>
        </div>
      ))}
      <p className="tiny muted" style={{ margin: 0 }}>
        {pcos
          ? 'With PCOS, losing 5–10% of your starting weight can bring back regular cycles, help fertility and lower diabetes risk, even if the goal is still far off.'
          : 'Losing 5–10% of your starting weight already lowers blood pressure and blood sugar, even if the goal is still far off.'}
      </p>
    </section>
  )
}

function WeighIns({ weights }) {
  const { units, today } = useApp()
  const [showAll, setShowAll] = useState(false)
  const [sheet, setSheet] = useState(null) // { weight } to edit, {} to add
  const list = [...weights].reverse()
  const shown = showAll ? list : list.slice(0, 7)
  return (
    <section className="card">
      <div className="meal-head">
        <h2 style={{ textTransform: 'none' }}>Weigh-ins</h2>
        <button className="btn soft sm" onClick={() => setSheet({})}>+ Log weight</button>
      </div>
      {!list.length && <p className="small muted" style={{ margin: 0 }}>No weigh-ins yet. Log one for any date, including past days.</p>}
      {shown.map((w, i) => {
        const prev = list[i + 1]
        return (
          <button key={w.id} className="entry" onClick={() => setSheet({ weight: w })} aria-label={`Edit weigh-in for ${formatShortDate(w.log_date)}`}>
            <div className="grow">
              <div>{w.log_date === today ? 'Today' : formatShortDate(w.log_date)}</div>
              {w.note && <div className="tiny muted ellipsis">{w.note}</div>}
            </div>
            {prev && <span className="tiny muted num">{weightDelta(w.weight_kg, prev.weight_kg, units)}</span>}
            <strong className="num">{displayWeight(Number(w.weight_kg), units)}</strong>
            <span className="muted" aria-hidden="true">›</span>
          </button>
        )
      })}
      {list.length > 7 && (
        <button className="link small" style={{ marginTop: 8 }} onClick={() => setShowAll((s) => !s)}>
          {showAll ? 'Show less' : `Show all ${list.length}`}
        </button>
      )}
      {list.length > 0 && <p className="tiny muted" style={{ margin: '8px 0 0' }}>Tap a weigh-in to change its date, weight or note.</p>}
      {sheet && <WeightSheet weight={sheet.weight} onClose={() => setSheet(null)} />}
    </section>
  )
}
