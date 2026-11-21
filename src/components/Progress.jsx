import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../appContext.js'
import {
  adaptiveTarget, adaptiveTdee, bucketAverages, bucketStats, calendarWeeks, dailyTotals, displayWeight, exerciseAllowance, goalProgress,
  hasCondition, kmhToMph, macroShareByWeek, mealSplit, projectGoalDate, weekdayAverages, weeklyRate, weeklyTrendChange, weightUnit,
  weightValue, wholePercents, workoutSummary,
} from '../lib/calc.js'
import { buildMilestones, computeBadges, milestoneProgress } from '../lib/milestones.js'
import { BadgeCelebration, BadgeDetail, BadgeGrid, MilestonesCard, keepEarned, useNewBadges } from './Milestones.jsx'
import { MOOD_BY_V, SYMPTOM_BY_ID } from '../data/glp1.js'
import { doseLevels, formatDose, formatWater, glp1Plan, summariseDailyLogs } from '../lib/glp1.js'
import { Glp1Progress } from './Glp1.jsx'
import { useWaterTarget, weightDelta } from './Checkin.jsx'
import { addDays, formatEta, formatShortDate, formatTime, formatTimeUntil, lastNDates } from '../lib/dates.js'
import { CalendarHeat, Sparkline, StackedBars, TrendChart } from './Charts.jsx'
import { CountUp, Icon, PenguinFace, Segmented } from './ui.jsx'
import { MEAL_COLOR, MEAL_LABEL } from '../lib/meals.js'
import { requestGoalEstimate } from '../lib/ai.js'
import { buildGoalContext, cleanGoalEstimate, goalEstimateDue, goalFingerprint } from '../lib/goalEstimate.js'

const fmtN = (n) => Math.round(Number(n) || 0).toLocaleString('en-GB')

const readJson = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}
const writeJson = (key, v) => {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* private mode: it just asks again next time */
  }
}

/**
 * Mimi's goal date (Haiku reads the weigh-ins and the plan). Asked for only
 * when the weigh-ins or goal change; the answer is kept on the device.
 * Returns { result, loading } where result is null until there is one for the current goal.
 */
function useGoalEstimate({ enabled, who, profile, series, targets, today, formulaEta, rateKg, goalReached }) {
  const key = `lili:goal-eta:${who || 'local'}`
  const [cache, setCache] = useState(() => readJson(key))
  const [loading, setLoading] = useState(false)
  const fingerprint = goalFingerprint({ profile, series })

  useEffect(() => {
    if (!enabled) return
    const cached = readJson(key)
    setCache(cached)
    if (!goalEstimateDue({ cached, fingerprint, series, goalReached })) return
    const ctl = new AbortController()
    let alive = true
    setLoading(true)
    const plan = glp1Plan(profile)
    const context = buildGoalContext({
      profile, series, targets, today, formulaEta, weeklyRateKg: rateKg,
      glp1: plan ? { medicine: plan.name, dose: formatDose(plan.dose, plan.unit) } : null,
    })
    requestGoalEstimate({ context, signal: ctl.signal })
      .then((raw) => {
        const result = cleanGoalEstimate(raw, today)
        if (!result) throw new Error('The estimate came back unusable.')
        const next = { fingerprint, goalKg: Number(profile.goal_weight_kg), result, at: Date.now() }
        writeJson(key, next)
        if (alive) setCache(next)
      })
      .catch((e) => {
        if (e.name === 'AbortError') return
        console.warn('[goal] estimate skipped:', e.message) // the straight-line date still shows
        const next = { ...(cached || {}), failedAt: Date.now() }
        writeJson(key, next)
        if (alive) setCache(next)
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
      ctl.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, fingerprint, goalReached])

  // Only an answer for this goal, and never a date that has already passed.
  const r = cache?.result
  const fits = enabled && r && Number(cache.goalKg) === Number(profile.goal_weight_kg) && r.eta >= today
  return { result: fits ? r : null, loading: enabled && loading }
}

const GRANULARITY = [
  ['day', 'Daily'],
  ['week', 'Weekly'],
  ['month', 'Monthly'],
]
const COUNT = { day: 30, week: 12, month: 12 }

// Progress is split into four short views instead of one long page.
const VIEWS = [
  ['weight', 'Weight'],
  ['food', 'Food'],
  ['habits', 'Habits'],
  ['health', 'Health'],
  ['awards', 'Awards'],
]
const VIEW_IDS = VIEWS.map(([v]) => v)
// Which view holds each section a Dashboard card can jump to.
const VIEW_OF = { weight: 'weight', macros: 'food', dose: 'health', awards: 'awards' }
const PERIOD = { day: 'last 30 days', week: 'last 12 weeks', month: 'last 12 months' }

// A year of food in 2-month chunks: one big request would hit the API's row cap.
// Returns the daily totals and the last 30 days' entries (for the meal split).
async function loadYear(store, today) {
  const from = addDays(today, -372)
  const ranges = []
  for (let s = from; s <= today; s = addDays(s, 61)) {
    const e = addDays(s, 60)
    ranges.push([s, e < today ? e : today])
  }
  const parts = await Promise.all(ranges.map(([a, b]) => store.listEntries(a, b)))
  const all = parts.flat()
  const from30 = addDays(today, -29)
  return { daily: dailyTotals(all), recent: all.filter((e) => e.log_date >= from30) }
}

export default function Progress() {
  const { store, mode, series, weights, profile, targets, today, units, toast, dataVersion, saveProfile, openSheet, progressFocus, session } = useApp()
  const [daily, setDaily] = useState({})
  const [recentEntries, setRecentEntries] = useState([])
  const [workouts, setWorkouts] = useState([]) // a year, for badges; the exercise card uses the last 28 days
  const [loaded, setLoaded] = useState({ food: false, workouts: false })
  const [open, setOpen] = useState({ weight: true, macros: true, dose: true })
  const [view, setViewRaw] = useState('weight')
  // Which way the section switch went, so the new one slides in from that side.
  const [viewDir, setViewDir] = useState(null)
  const viewRef = useRef('weight')
  const setView = (v) => {
    if (v === viewRef.current) return
    setViewDir(VIEW_IDS.indexOf(v) > VIEW_IDS.indexOf(viewRef.current) ? 'fwd' : 'back')
    viewRef.current = v
    setViewRaw(v)
  }
  const [badgeOpen, setBadgeOpen] = useState(null)

  useEffect(() => {
    let cancelled = false
    loadYear(store, today)
      .then(({ daily: d, recent }) => {
        if (cancelled) return
        setDaily(d)
        setRecentEntries(recent)
        setLoaded((l) => ({ ...l, food: true }))
      })
      .catch((e) => !cancelled && toast(e.message, 'error'))
    store
      .listWorkouts(addDays(today, -372), today)
      .then((w) => !cancelled && setWorkouts(w))
      .catch(() => !cancelled && setWorkouts([]))
      .finally(() => !cancelled && setLoaded((l) => ({ ...l, workouts: true })))
    return () => {
      cancelled = true
    }
  }, [store, today, dataVersion, toast])

  // A Dashboard card sent us here: open its trend and scroll to it.
  useEffect(() => {
    if (!progressFocus) return
    const { section } = progressFocus
    setOpen((o) => ({ ...o, [section]: true }))
    setView(VIEW_OF[section] || 'weight')
    const t = setTimeout(() => document.getElementById(`trend-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 140)
    return () => clearTimeout(t)
  }, [progressFocus])

  const last = series[series.length - 1]
  const startKg = Number(profile.start_weight_kg)
  const goalKg = Number(profile.goal_weight_kg)

  const ms = useMemo(() => buildMilestones({ startKg, goalKg, series, units }), [startKg, goalKg, series, units])
  // Distances are measured from the latest weigh-in (the "Current" figure) to
  // the goal weight in the profile; milestones are still reached by the trend.
  const goal = goalProgress(startKg, goalKg, last?.weight)
  const msProgress = milestoneProgress(ms, startKg, last?.weight)
  const badges = useMemo(
    () =>
      computeBadges({
        weights, daily, workouts, targets, milestones: ms, startKg, goalKg, currentKg: last?.trend,
        stepLabel: units === 'imperial' ? '5 lb' : '2 kg',
      }),
    [weights, daily, workouts, targets, ms, startKg, goalKg, last?.trend, units],
  )
  const recentWorkouts = useMemo(() => workouts.filter((w) => w.log_date >= addDays(today, -27)), [workouts, today])
  const celebration = useNewBadges(badges, loaded.food && loaded.workouts, session?.user?.id)
  const rate = weeklyRate(series)
  const eta = projectGoalDate(series, goalKg, today, rate)
  const ai = useGoalEstimate({
    enabled: mode === 'cloud', who: session?.user?.id, profile, series, targets, today,
    formulaEta: eta, rateKg: rate, goalReached: !!last && last.trend <= goalKg,
  })
  const etaDate = ai.result?.eta || eta
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
      toast(`Target set to ${fmtN(newTarget)} kcal`)
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

      <div className="progress-tabs">
        <Segmented label="Progress section" value={view} onChange={setView} options={VIEWS} />
      </div>

      <div key={view} className="view-swap" data-dir={viewDir || undefined}>
      {view === 'weight' && (
      <>
      <div className="stats" style={{ marginBottom: 18 }}>
        <Stat label="Current" color="var(--weight)" value={last ? displayWeight(last.weight, units) : '—'} sub={last ? (last.date === today ? 'today' : formatShortDate(last.date)) : undefined} />
        <Stat
          label="Goal"
          color="var(--teal)"
          value={goalKg ? displayWeight(goalKg, units) : '—'}
          sub={!last || !goal ? undefined : goal.reached ? 'Reached' : `${weightValue(goal.toGoalKg, units).toFixed(1)} ${weightUnit(units)} to go`}
        />
        <Stat
          label="Goal ETA"
          color="var(--pink)"
          value={etaDate ? formatEta(etaDate, today) : ai.loading ? '…' : '—'}
          sub={etaDate ? `${formatTimeUntil(etaDate, today)}${ai.result ? ' · Mimi' : ''}` : ai.loading ? 'Mimi is checking' : undefined}
        />
      </div>

      {ai.result && <GoalEstimateCard est={ai.result} today={today} units={units} />}

      <WeightTrend
        open={open.weight}
        onToggle={() => toggle('weight')}
        goalKg={goalKg}
        extra={[
          ['Since start', last ? signed(last.weight - startKg) : '—'],
          ['Per week', rate == null ? '—' : signed(rate)],
          ['Started at', startKg ? displayWeight(startKg, units) : '—'],
          ['Goal', goalKg ? displayWeight(goalKg, units) : '—'],
        ]}
      />
      <WeeklyChange />
      <WeighIns weights={weights} />
      </>
      )}

      {view === 'food' && (
      <>
      <div className="stats" style={{ marginBottom: 18 }}>
        <Stat label="7-day avg" color="var(--orange)" value={avgWeek ? <CountUp value={avgWeek} /> : loaded.food ? '—' : '…'} sub={avgWeek ? 'kcal a day' : loaded.food ? 'no full days' : 'loading'} />
        <Stat label="Target" color="var(--kcal)" value={targets ? <CountUp value={targets.calories} /> : '—'} sub="kcal a day" />
        <Stat label="Maintenance" color="var(--blue)" value={adaptive ? <CountUp value={adaptive.tdee} /> : targets?.tdee ? <CountUp value={targets.tdee} /> : '—'} sub={adaptive ? 'measured' : 'formula'} />
      </div>

      <MacroTrend open={open.macros} onToggle={() => toggle('macros')} daily={daily} loaded={loaded.food} />
      {loaded.food && <MacroMix daily={daily} />}
      {loaded.food && <MealSplitCard entries={recentEntries} />}

      <section className="card">
        <h2>Your real maintenance</h2>
        {adaptive ? (
          <>
            <p>
              About <strong className="num">{fmtN(adaptive.tdee)} kcal/day</strong>{' '}
              <span className={`badge ${adaptive.confidence === 'high' ? 'jam' : adaptive.confidence === 'low' ? 'off' : 'usda'}`}>{adaptive.confidence} confidence</span>
            </p>
            <p className="small muted">
              You averaged {fmtN(adaptive.avgIntake)} kcal over {adaptive.loggedDays} logged days while your trend moved{' '}
              {signed(adaptive.trendChangeKg)} in {adaptive.spanDays} days. The formula estimate was {targets?.tdee ? fmtN(targets.tdee) : '—'} kcal.
            </p>
            {suggestedTarget && Math.abs(adaptive.tdee - targets.tdee) >= 150 && suggestedTarget !== targets.calories && (
              <button className="btn secondary sm" onClick={adoptAdaptive}>
                Base my target on this ({fmtN(suggestedTarget)} kcal)
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
      </>
      )}

      {view === 'habits' && (
      <>
      <LoggingCalendar daily={daily} workouts={workouts} loaded={loaded.food} />
      <WeekdayRhythm daily={daily} loaded={loaded.food} />
      <WaterBars />
      </>
      )}

      {view === 'health' && (
      <>
      <ExerciseSummary workouts={recentWorkouts} today={today} units={units} />
      <Wellbeing today={today} />
      <DoseTrend open={open.dose} onToggle={() => toggle('dose')} />
      <Glp1Progress onEditDose={(d) => openSheet('dose', { date: d.log_date, dose: d })} onSetup={() => openSheet('medication')} />
      </>
      )}

      {view === 'awards' && (
      <>
      <MilestonesCard milestones={ms} progress={msProgress} goal={goal} series={series} units={units} pcos={hasCondition(profile, 'pcos')} />
      <BadgeGrid badges={keepEarned(badges, celebration.kept)} fresh={celebration.fresh} units={units} onOpen={setBadgeOpen} />
      </>
      )}
      </div>

      {celebration.queue.length > 0 && <BadgeCelebration badges={celebration.queue} units={units} onDone={celebration.dismiss} />}
      {badgeOpen && <BadgeDetail badge={badgeOpen} units={units} onClose={() => setBadgeOpen(null)} />}
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

function WeightTrend({ open, onToggle, goalKg, extra = [] }) {
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
      color="var(--weight)"
      title="Weight"
      value={last ? displayWeight(last.weight, units) : 'No weigh-ins yet'}
      sub={change != null ? `Trend ${signedV(change)} · ${PERIOD[gran]}` : last ? 'Latest weigh-in' : 'Log one to start'}
      spark={<Sparkline values={series.slice(-30).map((p) => conv(p.trend))} color="var(--weight)" width={72} height={28} />}
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
            color="var(--weight)"
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
          {extra.length > 0 && (
            <div className="trend-stats">
              {extra.map(([l, v]) => (
                <MiniStat key={l} label={l} value={v} />
              ))}
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
  ['calories', 'kcal', 'var(--kcal)', 'var(--kcal-b)', 'kcal'],
  ['protein', 'Protein', 'var(--protein)', null, 'g'],
  ['carbs', 'Carbs', 'var(--carbs)', null, 'g'],
  ['fat', 'Fat', 'var(--fat)', null, 'g'],
]

function MacroTrend({ open, onToggle, daily, loaded }) {
  const { targets, today } = useApp()
  const [gran, setGran] = useState('day')
  const [metric, setMetric] = useState('calories')
  const [style, setStyle] = useState('bars')
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
      color="var(--kcal)"
      title="Calories & macros"
      value={stats ? `${fmtN(stats.avg)} ${unit === 'g' ? 'g' : 'kcal'}` : loaded ? 'Nothing logged yet' : 'Loading…'}
      sub={stats ? `${label === 'kcal' ? 'Calories' : label}, daily avg · ${PERIOD[gran]}` : loaded ? 'Log food to see trends' : '\u00a0'}
      spark={<Sparkline values={week.map((b) => b.value)} color="var(--kcal)" width={72} height={28} />}
    >
      <div className="chart-controls">
        <Segmented label="Macro chart period" value={gran} onChange={setGran} options={GRANULARITY} />
        <ChartStyle value={style} onChange={setStyle} />
      </div>
      <div className="metric-chips" role="radiogroup" aria-label="Nutrient">
        {MACROS.map(([id, l, c]) => (
          <button key={id} type="button" role="radio" aria-checked={metric === id} className={`chip${metric === id ? ' tinted' : ''}`} style={{ '--c': c }} onClick={() => setMetric(id)}>
            {id === 'calories' ? 'Calories' : l}
          </button>
        ))}
      </div>
      {!loaded ? (
        <div className="skeleton chart-skel" aria-label="Loading chart" />
      ) : (
        <TrendChart
          buckets={buckets}
          granularity={gran}
          color={color}
          color2={color2}
          target={target}
          format={fmtN}
          unit={unit}
          bars={style === 'bars'}
          // Calories over target show in orange; for protein, more is fine.
          barColor={metric === 'protein' ? undefined : (v) => (target && v > target ? 'var(--over)' : color)}
          ariaLabel={`${label} trend, ${PERIOD[gran]}`}
        />
      )}
      {stats && (
        <div className="trend-stats">
          <MiniStat label="Average" value={fmtN(stats.avg)} unit={unit} />
          <MiniStat label="vs target" value={target ? `${stats.avg - target > 0 ? '+' : stats.avg - target < 0 ? '−' : ''}${fmtN(Math.abs(stats.avg - target))}` : '—'} tone={target ? (metric === 'protein' ? (stats.avg >= target * 0.9 ? 'good' : 'bad') : Math.abs(stats.avg - target) <= target * 0.1 ? 'good' : stats.avg > target ? 'bad' : '') : ''} />
          <MiniStat label={gran === 'day' ? 'Days logged' : `${gran === 'week' ? 'Weeks' : 'Months'} logged`} value={`${loggedInRange} / ${buckets.length}`} />
        </div>
      )}
      <p className="tiny muted trend-note">
        {gran === 'day' ? 'Every day with food logged.' : `Average per day across each ${gran}, counting only days with 500+ kcal logged.`} The dashed line is your target{style === 'bars' && metric !== 'protein' ? '; orange bars went over it' : ''}.
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
  const [moods, setMoods] = useState([])
  const dates = lastNDates(today, 14)
  useEffect(() => {
    let cancelled = false
    store
      .listDailyLogs(dates[0], today)
      .then((rows) => !cancelled && setLogs(rows))
      .catch(() => !cancelled && setLogs([]))
    store
      .listMoods(dates[0], today)
      .then((rows) => !cancelled && setMoods(rows))
      .catch(() => !cancelled && setMoods([]))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, today, dataVersion])
  if (!logs) return null
  const byDate = Object.fromEntries(logs.map((l) => [l.log_date, l]))
  const sum = summariseDailyLogs(logs, moods)
  const checkins = {}
  for (const m of moods) checkins[m.log_date] = (checkins[m.log_date] || 0) + 1
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
            <span key={d} className={`mood-cell${m ? ' has' : ''}`} title={`${formatShortDate(d)}: ${m ? `${m.label}${checkins[d] > 1 ? ` (latest of ${checkins[d]})` : ''}` : 'no check-in'}`} style={{ '--c': m?.color }}>
              {m ? m.emoji : ''}
            </span>
          )
        })}
      </div>
      <div className="stats" style={{ marginTop: 12 }}>
        <Stat label="Mood" color="var(--yellow)" value={sum.mood ? MOOD_BY_V[Math.round(sum.mood)]?.label : '—'} sub={sum.mood ? `${sum.mood} / 5 avg` : 'none yet'} />
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
        <Stat inner label="Burned" color="var(--pink)" value={fmtN(week.kcal)} sub="net kcal" />
        <Stat inner label="Strength" color="var(--purple)" value={week.strength} sub="aim for 2+" />
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

function WeighIns({ weights }) {
  const { units, today, openSheet } = useApp()
  const [showAll, setShowAll] = useState(false)
  const list = [...weights].reverse()
  const shown = showAll ? list : list.slice(0, 5)
  return (
    <section className="card" id="weigh-ins">
      <div className="row between" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>Weigh-ins</h2>
        <button className="btn secondary sm" onClick={() => openSheet('weight')}>+ Log</button>
      </div>
      {!list.length && <p className="small muted" style={{ margin: 0 }}>No weigh-ins yet. You can log one for any day, including past days.</p>}
      {shown.map((w, i) => {
        const prev = list[i + 1]
        return (
          <button
            key={w.id}
            className="list-row weigh-row tap"
            style={{ padding: '10px 2px', width: '100%', background: 'none', border: 0, textAlign: 'left', color: 'var(--text)' }}
            onClick={() => openSheet('weight', { weight: w })}
            aria-label={`Edit weigh-in for ${formatShortDate(w.log_date)}${w.weighed_at ? ` at ${formatTime(w.weighed_at)}` : ''}`}
          >
            <span className="label">
              {w.log_date === today ? 'Today' : formatShortDate(w.log_date)}
              {(w.weighed_at || w.note) && <span className="sub ellipsis">{[formatTime(w.weighed_at), w.note].filter(Boolean).join(' · ')}</span>}
            </span>
            {prev && <span className="delta num">{weightDelta(w.weight_kg, prev.weight_kg, units)}</span>}
            <strong className="num">{displayWeight(Number(w.weight_kg), units)}</strong>
            <svg className="chev" viewBox="0 0 8 14" aria-hidden="true" style={{ width: 8, height: 14, marginLeft: 8, color: 'var(--text-3, var(--text-2))' }}>
              <path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )
      })}
      {list.length > 5 && (
        <button className="link small" style={{ marginTop: 6 }} onClick={() => setShowAll((s) => !s)}>
          {showAll ? 'Show less' : `Show all ${list.length}`}
        </button>
      )}
      {list.length > 0 && <p className="tiny muted" style={{ margin: '8px 0 0' }}>Tap a weigh-in to change its weight, date, time or note, or delete it. The trend uses each day’s first weigh-in.</p>}
    </section>
  )
}


/** Mimi's read of the weigh-ins: the likely date, a range, and why. */
function GoalEstimateCard({ est, today, units }) {
  const range = est.earliest !== est.latest ? `${formatEta(est.earliest, today)} – ${formatEta(est.latest, today)}` : null
  return (
    <section className="card goal-est rise" aria-label="Mimi’s goal estimate">
      <div className="row" style={{ gap: 10, marginBottom: 8 }}>
        <PenguinFace size={30} />
        <div className="grow">
          <div className="eyebrow">Mimi’s estimate</div>
          <div className="headline">
            Goal around {formatShortDate(est.eta)} {est.eta.slice(0, 4)}
          </div>
        </div>
        <span className={`badge ${est.confidence === 'high' ? 'jam' : est.confidence === 'low' ? 'off' : 'usda'}`}>{est.confidence} confidence</span>
      </div>
      {est.summary && <p className="small" style={{ margin: '0 0 6px' }}>{est.summary}</p>}
      <p className="tiny muted" style={{ margin: 0 }}>
        {[range && `Likely ${range}`, est.ratePerWeek && `about ${est.ratePerWeek} ${weightUnit(units)} a week`].filter(Boolean).join(' · ')}
        {range || est.ratePerWeek ? '. ' : ''}Updates after each weigh-in.
      </p>
    </section>
  )
}

/** Bars or a line: two small icon buttons next to a chart's options. */
function ChartStyle({ value, onChange }) {
  return (
    <span className="chart-style" role="radiogroup" aria-label="Chart style">
      {[
        ['bars', 'chart', 'Bars'],
        ['line', 'trend', 'Line'],
      ].map(([v, icon, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} aria-label={l} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          <Icon name={icon} size={17} strokeWidth={2.2} />
        </button>
      ))}
    </span>
  )
}

function CardHead({ title, note, children }) {
  return (
    <div className="card-head">
      <h2>{title}</h2>
      {note != null && <span className="card-note num">{note}</span>}
      {children}
    </div>
  )
}

/** Weight: how far the trend moved each week, down in teal, up in orange. */
function WeeklyChange() {
  const { series, today, units } = useApp()
  const unit = weightUnit(units)
  const weeks = useMemo(() => weeklyTrendChange(series, today, 12), [series, today])
  if (series.length < 2) return null
  const conv = (kg) => Math.round(weightValue(kg, units) * 10) / 10
  const buckets = weeks.map((w) => ({ key: w.start, start: w.start, end: w.end, value: w.changeKg == null ? null : conv(w.changeKg) }))
  const have = buckets.filter((b) => b.value != null)
  if (!have.length) return null
  const down = have.filter((b) => b.value < 0).length
  const signedV = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}`
  const best = have.reduce((m, b) => (b.value < m.value ? b : m), have[0])
  return (
    <section className="card">
      <CardHead title="Week by week" note={`${down} of ${have.length} down`} />
      <p className="small muted card-sub">How far your trend moved each week, Monday to Sunday.</p>
      <TrendChart
        bars
        buckets={buckets}
        granularity="week"
        barColor={(v) => (v < 0 ? 'var(--good)' : 'var(--over)')}
        format={signedV}
        unit={unit}
        ariaLabel="Weekly change in your weight trend, last 12 weeks"
      />
      {best.value < 0 && (
        <p className="tiny muted trend-note">
          Best week: {signedV(best.value)} {unit}, week of {formatShortDate(best.start)}. Weeks without a weigh-in are left blank.
        </p>
      )}
    </section>
  )
}

const MACRO_SERIES = [
  { label: 'Protein', color: 'var(--protein)' },
  { label: 'Carbs', color: 'var(--carbs)' },
  { label: 'Fat', color: 'var(--fat)' },
]

/** Food: each week's calories split by macro, as 100% bars. */
function MacroMix({ daily }) {
  const { today, targets } = useApp()
  const weeks = useMemo(() => macroShareByWeek(daily, today, 8), [daily, today])
  if (!weeks.some((w) => w.days)) return null
  const columns = weeks.map((w) => ({
    key: w.start,
    label: formatShortDate(w.start),
    long: `Week of ${formatShortDate(w.start)} · ${w.days} day${w.days === 1 ? '' : 's'}`,
    parts: w.days ? [w.protein, w.carbs, w.fat] : null,
  }))
  const latest = [...weeks].reverse().find((w) => w.days)
  const aim = targets?.protein ? wholePercents([targets.protein * 4, targets.carbs * 4, targets.fat * 9]) : null
  return (
    <section className="card">
      <CardHead title="Macro mix" note="8 weeks" />
      <p className="small muted card-sub">Where each week’s calories came from. Tap a week to read it.</p>
      <StackedBars columns={columns} series={MACRO_SERIES} ariaLabel={`Macro split by week. Latest: protein ${latest.protein}%, carbs ${latest.carbs}%, fat ${latest.fat}%`} />
      {aim && (
        <p className="tiny muted trend-note">
          Your targets work out at protein {aim[0]}% · carbs {aim[1]}% · fat {aim[2]}%. Latest week: {latest.protein}% · {latest.carbs}% · {latest.fat}%.
        </p>
      )}
    </section>
  )
}

/** Food: calories by meal over the last 30 days. */
function MealSplitCard({ entries }) {
  const split = useMemo(() => mealSplit(entries), [entries])
  const days = useMemo(() => new Set(entries.map((e) => e.log_date)).size, [entries])
  if (!days || !split.some((m) => m.kcal)) return null
  const top = split.reduce((m, x) => (x.kcal > m.kcal ? x : m), split[0])
  return (
    <section className="card">
      <CardHead title="Meals" note="30 days" />
      <p className="small muted card-sub">
        {MEAL_LABEL[top.meal]} is your biggest meal, {top.share}% of what you eat.
      </p>
      <div className="split-bar" aria-hidden="true">
        {split.map((m, i) => m.share > 0 && <i key={m.meal} style={{ flexGrow: m.share, '--c': MEAL_COLOR[m.meal], '--i': i }} />)}
      </div>
      <div className="split-rows">
        {split.map((m) => (
          <div key={m.meal} className="split-row" style={{ '--c': MEAL_COLOR[m.meal] }}>
            <i aria-hidden="true" />
            <span className="grow">{MEAL_LABEL[m.meal]}</span>
            <span className="muted num">{fmtN(m.kcal / days)} kcal/day</span>
            <b className="num">{m.share}%</b>
          </div>
        ))}
      </div>
    </section>
  )
}

const CAL_LEVELS = {
  on: { label: 'On target', color: 'var(--brand)' },
  under: { label: 'Under', color: 'color-mix(in srgb, var(--brand) 42%, var(--card))' },
  over: { label: 'Over', color: 'var(--over)' },
  partial: { label: 'Partial', color: 'color-mix(in srgb, var(--text-3) 55%, var(--card))' },
}
const CAL_WEEKS = 15

/** Habits: every day of the last 15 weeks, coloured by how it went. */
function LoggingCalendar({ daily, workouts, loaded }) {
  const { today, targets, profile } = useApp()
  const burned = useMemo(() => {
    const m = {}
    for (const w of workouts) m[w.log_date] = (m[w.log_date] || 0) + (Number(w.calories_burned) || 0)
    return m
  }, [workouts])
  const targetFor = (d) => (targets?.calories || 0) + exerciseAllowance(burned[d] || 0, profile.exercise_eatback_pct)
  const weeks = calendarWeeks(daily, today, CAL_WEEKS, targetFor)
  const past = weeks.flat().filter((c) => !c.future)
  const logged = past.filter((c) => c.level === 'on' || c.level === 'under' || c.level === 'over').length
  const on = past.filter((c) => c.level === 'on').length
  const describe = (c) =>
    c.level === 'none'
      ? 'nothing logged'
      : `${c.kcal.toLocaleString('en-GB')} kcal of ${fmtN(targetFor(c.date))} · ${CAL_LEVELS[c.level].label.toLowerCase()}`
  return (
    <section className="card">
      <CardHead title="Logging calendar" note={loaded ? `${logged} of ${past.length} days` : '…'} />
      <p className="small muted card-sub">
        {loaded ? `${on} day${on === 1 ? '' : 's'} on target (90–100% of it) in the last ${CAL_WEEKS} weeks. Tap a day to read it.` : 'Loading…'}
      </p>
      {loaded ? <CalendarHeat weeks={weeks} levels={CAL_LEVELS} today={today} describe={describe} /> : <div className="skeleton cal-skel" />}
    </section>
  )
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** Habits: average calories for each day of the week. */
function WeekdayRhythm({ daily, loaded }) {
  const { today, targets } = useApp()
  const from = addDays(today, -84)
  const to = addDays(today, -1) // today is still going
  const days = useMemo(() => weekdayAverages(daily, from, to), [daily, from, to])
  if (!loaded) return null
  const have = days.filter((d) => d.avg != null)
  if (have.length < 3) {
    return (
      <section className="card">
        <CardHead title="Your week’s rhythm" />
        <p className="small muted" style={{ margin: 0 }}>Log full days across a couple of weeks to see which days you eat most.</p>
      </section>
    )
  }
  const target = targets?.calories || null
  const hi = have.reduce((m, d) => (d.avg > m.avg ? d : m), have[0])
  const lo = have.reduce((m, d) => (d.avg < m.avg ? d : m), have[0])
  const avgOf = (list) => (list.length ? list.reduce((s, d) => s + d.avg * d.n, 0) / list.reduce((s, d) => s + d.n, 0) : null)
  const weekend = avgOf(have.filter((d) => d.dow >= 5))
  const weekday = avgOf(have.filter((d) => d.dow < 5))
  const gap = weekend != null && weekday != null ? Math.round(weekend - weekday) : null
  const bigWeekend = have.filter((d) => d.dow >= 5).reduce((m, d) => (!m || d.avg > m.avg ? d : m), null)
  const buckets = days.map((d) => ({ key: String(d.dow), value: d.avg, n: d.n }))
  return (
    <section className="card">
      <CardHead title="Your week’s rhythm" note="12 weeks" />
      <p className="small muted card-sub">
        {hi.dow !== lo.dow
          ? `${DAY_NAMES[hi.dow]}s are your biggest day, about ${fmtN(hi.avg - lo.avg)} kcal more than ${DAY_NAMES[lo.dow]}s.`
          : 'Average calories for each day of the week.'}
      </p>
      <TrendChart
        bars
        buckets={buckets}
        labelOf={(b, long) => (long ? `${DAY_NAMES[b.key]}s · ${b.n} day${b.n === 1 ? '' : 's'}` : DAY_NAMES[b.key][0])}
        barColor={(v) => (target && v > target ? 'var(--over)' : 'var(--kcal)')}
        target={target}
        format={fmtN}
        unit="kcal"
        ariaLabel="Average calories by day of the week"
      />
      {gap != null && Math.abs(gap) >= 150 && (
        <p className="tiny muted trend-note">
          Weekends run {fmtN(Math.abs(gap))} kcal a day {gap > 0 ? 'higher' : 'lower'} than weekdays.
          {gap > 0 && target ? ` Planning ${DAY_NAMES[bigWeekend.dow]}’s meals ahead is usually the easiest win.` : ''}
        </p>
      )}
    </section>
  )
}

/** Habits: water for each of the last 14 days against the goal. */
function WaterBars() {
  const { store, today, dataVersion } = useApp()
  const waterTarget = useWaterTarget()
  const [logs, setLogs] = useState(null)
  useEffect(() => {
    let cancelled = false
    store
      .listDailyLogs(addDays(today, -13), today)
      .then((rows) => !cancelled && setLogs(rows))
      .catch(() => !cancelled && setLogs([]))
    return () => {
      cancelled = true
    }
  }, [store, today, dataVersion])
  if (!logs) return null
  const byDate = Object.fromEntries(logs.map((l) => [l.log_date, Number(l.water_ml) || 0]))
  const buckets = lastNDates(today, 14).map((d) => ({ key: d, start: d, end: d, value: byDate[d] ? Math.round(byDate[d] / 100) / 10 : null }))
  const hit = buckets.filter((b) => b.value != null && b.value * 1000 >= waterTarget).length
  const goal = Math.round(waterTarget / 100) / 10
  return (
    <section className="card">
      <CardHead title="Water" note={`${hit} of 14 days`} />
      <p className="small muted card-sub">Days you reached {goal.toFixed(1)} L are full blue.</p>
      <TrendChart
        bars
        buckets={buckets}
        granularity="day"
        target={goal}
        targetLabel="goal"
        barColor={(v) => (v >= goal ? 'var(--cyan)' : 'color-mix(in srgb, var(--cyan) 45%, var(--card))')}
        format={(v) => v.toFixed(1)}
        unit="L"
        ariaLabel="Water each day, last 14 days"
      />
    </section>
  )
}
