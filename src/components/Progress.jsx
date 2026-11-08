import { useEffect, useRef, useState } from 'react'
import { useApp } from '../appContext.js'
import {
  adaptiveTarget, adaptiveTdee, bucketAverages, bucketStats, dailyTotals, displayWeight, inputToKg, kmhToMph,
  projectGoalDate, weeklyRate, weightUnit, weightValue, workoutSummary,
} from '../lib/calc.js'
import { MOOD_BY_V, SYMPTOM_BY_ID } from '../data/glp1.js'
import { doseLevels, formatDose, formatWater, glp1Plan, summariseDailyLogs } from '../lib/glp1.js'
import { Glp1Progress } from './Glp1.jsx'
import { useWaterTarget } from './Checkin.jsx'
import { addDays, formatShortDate, lastNDates } from '../lib/dates.js'
import { Sparkline, TrendChart } from './Charts.jsx'
import { Icon, Segmented } from './ui.jsx'

const GRANULARITY = [
  ['day', 'Daily'],
  ['week', 'Weekly'],
  ['month', 'Monthly'],
]
const COUNT = { day: 30, week: 12, month: 12 }
const PERIOD = { day: 'last 30 days', week: 'last 12 weeks', month: 'last 12 months' }

// A year of food in 2-month chunks: one big request would hit the API's row cap.
async function loadYear(store, today) {
  const from = addDays(today, -372)
  const ranges = []
  for (let s = from; s <= today; s = addDays(s, 61)) {
    const e = addDays(s, 60)
    ranges.push([s, e < today ? e : today])
  }
  const parts = await Promise.all(ranges.map(([a, b]) => store.listEntries(a, b)))
  return dailyTotals(parts.flat())
}

export default function Progress() {
  const { store, series, weights, profile, targets, today, units, toast, dataVersion, saveProfile, openSheet, progressFocus } = useApp()
  const [daily, setDaily] = useState({})
  const [workouts, setWorkouts] = useState([])
  const [open, setOpen] = useState({ weight: true, macros: false, dose: false })

  useEffect(() => {
    let cancelled = false
    loadYear(store, today)
      .then((d) => !cancelled && setDaily(d))
      .catch((e) => toast(e.message, 'error'))
    store
      .listWorkouts(addDays(today, -27), today)
      .then((w) => !cancelled && setWorkouts(w))
      .catch(() => !cancelled && setWorkouts([]))
    return () => {
      cancelled = true
    }
  }, [store, today, dataVersion, toast])

  // A Dashboard card sent us here: open its trend and scroll to it.
  useEffect(() => {
    if (!progressFocus) return
    const { section } = progressFocus
    setOpen((o) => ({ ...o, [section]: true }))
    const t = setTimeout(() => document.getElementById(`trend-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 140)
    return () => clearTimeout(t)
  }, [progressFocus])

  const last = series[series.length - 1]
  const startKg = Number(profile.start_weight_kg)
  const goalKg = Number(profile.goal_weight_kg)
  const rate = weeklyRate(series)
  const eta = projectGoalDate(series, goalKg, today, rate)
  const adaptive = adaptiveTdee({ daily, series, endDate: addDays(today, -1) })

  const week = lastNDates(addDays(today, -1), 7)
  const loggedWeek = week.filter((d) => daily[d]?.calories >= 500)
  const avgWeek = loggedWeek.length ? Math.round(loggedWeek.reduce((s, d) => s + daily[d].calories, 0) / loggedWeek.length) : null

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
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }))

  return (
    <div>
      <header className="page-head">
        <div className="grow">
          <div className="eyebrow">Trends and stats</div>
          <h1>Progress</h1>
        </div>
      </header>

      <div className="stats" style={{ marginBottom: 18 }}>
        <Stat label="Trend" color="var(--blue)" value={last ? displayWeight(last.trend, units) : '—'} />
        <Stat label="Since start" color="var(--green)" value={last ? signed(last.trend - startKg) : '—'} />
        <Stat label="To goal" color="var(--teal)" value={last && goalKg ? signed(goalKg - last.trend) : '—'} />
        <Stat label="Per week" color="var(--purple)" value={rate == null ? '—' : signed(rate)} />
        <Stat label="Goal ETA" color="var(--pink)" value={eta ? formatShortDate(eta) : '—'} />
        <Stat label="7-day avg" color="var(--orange)" value={avgWeek ? avgWeek.toLocaleString('en-GB') : '—'} sub={avgWeek && targets ? `of ${targets.calories.toLocaleString('en-GB')} kcal` : 'no full days'} />
      </div>

      <WeightTrend open={open.weight} onToggle={() => toggle('weight')} goalKg={goalKg} />
      <MacroTrend open={open.macros} onToggle={() => toggle('macros')} daily={daily} />
      <DoseTrend open={open.dose} onToggle={() => toggle('dose')} />

      <LogWeight />

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
            <p className="tiny muted" style={{ marginTop: 10, marginBottom: 0 }}>
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

/** A card that opens out into a full chart. Tapping the header toggles it. */
function TrendCard({ id, open, onToggle, icon, color, title, value, sub, spark, children }) {
  const opened = useRef(open)
  if (open) opened.current = true
  return (
    <section className={`card trend-card${open ? ' open' : ''}`} id={`trend-${id}`} style={{ '--c': color }}>
      <button className="trend-head" onClick={onToggle} aria-expanded={open} aria-controls={`trend-body-${id}`}>
        <span className="tile-icon" aria-hidden="true"><Icon name={icon} strokeWidth={2.2} /></span>
        <span className="grow trend-text">
          <span className="trend-title">{title}</span>
          <span className="trend-value num">{value}</span>
          {sub && <span className="trend-sub">{sub}</span>}
        </span>
        <span className="trend-spark" aria-hidden="true">{spark}</span>
        <Icon name="right" size={16} strokeWidth={2.4} className="trend-chev" />
      </button>
      <div className="expand" id={`trend-body-${id}`}>
        <div className="expand-inner">{opened.current && <div className="trend-body">{children}</div>}</div>
      </div>
    </section>
  )
}

function WeightTrend({ open, onToggle, goalKg }) {
  const { series, units, today } = useApp()
  const [gran, setGran] = useState('day')
  const conv = (kg) => Math.round(weightValue(kg, units) * 10) / 10
  const unit = weightUnit(units)
  const trend = series.map((p) => ({ date: p.date, value: conv(p.trend) }))
  const buckets = bucketAverages(trend, gran, today, COUNT[gran])
  const dots = gran === 'day' ? bucketAverages(series.map((p) => ({ date: p.date, value: conv(p.weight) })), 'day', today, COUNT.day).map((b) => b.value) : null
  const stats = bucketStats(buckets)
  const last = series[series.length - 1]
  const change = stats && stats.count > 1 ? stats.change : null
  const signedV = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} ${unit}`
  return (
    <TrendCard
      id="weight"
      open={open}
      onToggle={onToggle}
      icon="scale"
      color="var(--indigo)"
      title="Weight"
      value={last ? displayWeight(last.trend, units) : 'No weigh-ins yet'}
      sub={change != null ? `${signedV(change)} · ${PERIOD[gran]}` : 'Smoothed trend'}
      spark={<Sparkline values={series.slice(-30).map((p) => conv(p.trend))} color="var(--indigo)" width={72} height={28} />}
    >
      <Segmented label="Weight chart period" value={gran} onChange={setGran} options={GRANULARITY} />
      {series.length < 2 ? (
        <p className="small muted chart-empty">Log at least two weigh-ins to see your trend. Morning, after the toilet, before food works best.</p>
      ) : (
        <>
          <TrendChart
            buckets={buckets}
            dots={dots}
            granularity={gran}
            color="var(--blue)"
            color2="var(--purple)"
            target={goalKg ? conv(goalKg) : null}
            targetLabel="goal"
            format={(v) => (Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1))}
            tipFormat={(v) => v.toFixed(1)}
            unit={unit}
            ariaLabel={`Weight trend, ${PERIOD[gran]}`}
          />
          {stats && (
            <div className="trend-stats">
              <MiniStat label="Average" value={stats.avg.toFixed(1)} unit={unit} />
              <MiniStat label="Lowest" value={stats.min.toFixed(1)} unit={unit} />
              <MiniStat label="Change" value={change != null ? signedV(change) : '—'} tone={change != null ? (change < 0 ? 'good' : change > 0 ? 'bad' : '') : ''} />
            </div>
          )}
          <p className="tiny muted trend-note">
            {gran === 'day' ? 'Dots are weigh-ins; the line is your smoothed trend. Judge progress by the line.' : `Each point is the average trend for that ${gran}.`} Drag across the chart to read a point.
          </p>
        </>
      )}
    </TrendCard>
  )
}

const MACROS = [
  ['calories', 'kcal', 'var(--green)', 'var(--mint)', 'kcal'],
  ['protein', 'Protein', 'var(--protein)', null, 'g'],
  ['carbs', 'Carbs', 'var(--carbs)', null, 'g'],
  ['fat', 'Fat', 'var(--fat)', null, 'g'],
]

function MacroTrend({ open, onToggle, daily }) {
  const { targets, today } = useApp()
  const [gran, setGran] = useState('day')
  const [metric, setMetric] = useState('calories')
  const [, label, color, color2, unit] = MACROS.find((m) => m[0] === metric)
  // Daily view shows every logged day; weekly and monthly average only full days.
  const days = Object.entries(daily).filter(([, d]) => (gran === 'day' ? d.count > 0 : d.calories >= 500))
  const pts = days.map(([date, d]) => ({ date, value: Math.round(d[metric]) }))
  const buckets = bucketAverages(pts, gran, today, COUNT[gran])
  const stats = bucketStats(buckets)
  const target = targets?.[metric] || null
  const fmtN = (v) => Math.round(v).toLocaleString('en-GB')
  const week = bucketAverages(Object.entries(daily).filter(([, d]) => d.count > 0).map(([date, d]) => ({ date, value: d.calories })), 'day', today, 14)
  const loggedInRange = buckets.filter((b) => b.value != null).length
  return (
    <TrendCard
      id="macros"
      open={open}
      onToggle={onToggle}
      icon="chart"
      color="var(--green)"
      title="Calories & macros"
      value={stats ? `${fmtN(stats.avg)} ${unit === 'g' ? 'g' : 'kcal'}` : 'Nothing logged yet'}
      sub={stats ? `${label === 'kcal' ? 'Calories' : label}, daily avg · ${PERIOD[gran]}` : 'Log food to see trends'}
      spark={<Sparkline values={week.map((b) => b.value)} color="var(--green)" width={72} height={28} />}
    >
      <Segmented label="Macro chart period" value={gran} onChange={setGran} options={GRANULARITY} />
      <div className="metric-chips" role="radiogroup" aria-label="Nutrient">
        {MACROS.map(([id, l, c]) => (
          <button key={id} type="button" role="radio" aria-checked={metric === id} className={`chip${metric === id ? ' tinted' : ''}`} style={{ '--c': c }} onClick={() => setMetric(id)}>
            {id === 'calories' ? 'Calories' : l}
          </button>
        ))}
      </div>
      <TrendChart
        buckets={buckets}
        granularity={gran}
        color={color}
        color2={color2}
        target={target}
        format={fmtN}
        unit={unit}
        ariaLabel={`${label} trend, ${PERIOD[gran]}`}
      />
      {stats && (
        <div className="trend-stats">
          <MiniStat label="Average" value={fmtN(stats.avg)} unit={unit} />
          <MiniStat label="vs target" value={target ? `${stats.avg - target > 0 ? '+' : stats.avg - target < 0 ? '−' : ''}${fmtN(Math.abs(stats.avg - target))}` : '—'} tone={target ? (metric === 'protein' ? (stats.avg >= target * 0.9 ? 'good' : 'bad') : Math.abs(stats.avg - target) <= target * 0.1 ? 'good' : stats.avg > target ? 'bad' : '') : ''} />
          <MiniStat label={gran === 'day' ? 'Days logged' : `${gran === 'week' ? 'Weeks' : 'Months'} logged`} value={`${loggedInRange} / ${buckets.length}`} />
        </div>
      )}
      <p className="tiny muted trend-note">
        {gran === 'day' ? 'Every day with food logged.' : `Average per day across each ${gran}, counting only days with 500+ kcal logged.`} The dashed line is your target.
      </p>
    </TrendCard>
  )
}

/** GLP-1 dose over time: a stepped line, with a marker on each logged dose. */
function DoseTrend({ open, onToggle }) {
  const { store, profile, today, dataVersion, openSheet } = useApp()
  const plan = glp1Plan(profile)
  const [doses, setDoses] = useState(null)
  const [gran, setGran] = useState('week')

  useEffect(() => {
    let cancelled = false
    store
      .listDoses(addDays(today, -400), today)
      .then((rows) => !cancelled && setDoses(rows))
      .catch(() => !cancelled && setDoses([]))
    return () => {
      cancelled = true
    }
  }, [store, today, dataVersion])

  if (!plan && !doses?.length) return null
  const frequency = plan?.frequency || 'weekly'
  const unit = plan?.unit || doses?.[0]?.unit || 'mg'
  const { levels, taken } = doseLevels({ doses: doses || [], from: addDays(today, -400), to: today, frequency, plan })
  // The dose you were on at the end of each day / week / month (never an average).
  const buckets = bucketAverages(levels, gran, today, COUNT[gran], 'last')
  // Markers where a dose was logged: daily only (weekly/monthly would stack on the line).
  const marks = gran === 'day' ? bucketAverages(taken, 'day', today, COUNT.day, 'last').map((b) => b.value) : null
  const stats = bucketStats(buckets)
  const current = levels.length && levels[levels.length - 1].date === today ? levels[levels.length - 1].value : null
  const first = taken[0]
  const changes = taken.reduce((n, t, i) => (i && t.value !== taken[i - 1].value ? n + 1 : n), 0)
  const logged = (doses || []).length
  const fmtD = (v) => String(Math.round(v * 100) / 100)
  return (
    <TrendCard
      id="dose"
      open={open}
      onToggle={onToggle}
      icon={plan?.route === 'oral' ? 'pill' : 'syringe'}
      color="var(--purple)"
      title={`${plan?.name || 'GLP-1'} dose`}
      value={current != null ? formatDose(current, unit) : plan ? formatDose(plan.dose, unit) : '—'}
      sub={logged ? `${logged} logged${changes ? ` · ${changes} change${changes > 1 ? 's' : ''}` : ''}` : 'From your plan’s start date'}
      spark={<Sparkline values={bucketAverages(levels, 'week', today, 12, 'last').map((b) => b.value)} color="var(--purple)" width={72} height={28} />}
    >
      <Segmented label="Dose chart period" value={gran} onChange={setGran} options={GRANULARITY} />
      {doses === null ? null : (
        <>
          <TrendChart
            buckets={buckets}
            dots={marks}
            granularity={gran}
            color="var(--purple)"
            color2="var(--indigo)"
            format={fmtD}
            unit={unit}
            step
            zero
            ariaLabel={`Dose over the ${PERIOD[gran]}`}
          />
          {stats && (
            <div className="trend-stats">
              <MiniStat label="Now" value={current != null ? fmtD(current) : '—'} unit={current != null ? unit : null} />
              <MiniStat label="Started on" value={first ? fmtD(first.value) : '—'} unit={first ? unit : null} />
              <MiniStat label="Highest" value={fmtD(stats.max)} unit={unit} />
            </div>
          )}
          <p className="tiny muted trend-note">
            {gran === 'day' ? 'Each dose holds until the next; dots are the days you logged one.' : `The dose you were on at the end of each ${gran}.`}{' '}
            {!logged && plan ? 'Drawn from your plan until you log a dose. ' : ''}Dose changes are your prescriber’s call.
          </p>
          <button className="btn sm secondary" style={{ marginTop: 12 }} onClick={() => openSheet('dose', { date: today })}>
            Log a dose
          </button>
        </>
      )}
    </TrendCard>
  )
}

function MiniStat({ label, value, unit, tone = '' }) {
  return (
    <div className={`mini-stat ${tone}`}>
      <span className="l">{label}</span>
      <span className="v num">
        {value}
        {unit && <small> {unit}</small>}
      </span>
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
    <div className={`stat${inner ? ' inner' : ''}`} style={{ '--c': color }}>
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
