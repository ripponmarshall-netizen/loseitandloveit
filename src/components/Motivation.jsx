// What keeps you going, on the Today screen: the wins strip (streak, the
// week's dots, weight since start, next milestone), the three rings, the
// weekly calorie balance, the ring-closed cheer and the Sunday recap.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useApp } from '../appContext.js'
import {
  dailyTotals, exerciseAllowance, goalProgress, loggingStreak, weekBalance, weekDots, weekRecap,
  weekStart, weightUnit, weightValue,
} from '../lib/calc.js'
import { addDays, formatShortDate, parseISODate } from '../lib/dates.js'
import { buildMilestones, milestoneProgress } from '../lib/milestones.js'
import { milestoneText } from './Milestones.jsx'
import { CardHeader, Icon, PenguinFace } from './ui.jsx'

const fmt = (n) => Math.round(n).toLocaleString('en-GB')
const NARROW_DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'narrow' })
const LONG_DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long' })

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
    /* private mode: worst case a cheer or the recap shows again */
  }
}

// ---------------------------------------------------------------- data

const HISTORY_DAYS = 120

/** Food totals by day and workouts for the last few months (read from the copy on the phone). */
export function useRecentLog() {
  const { store, today, dataVersion } = useApp()
  const [state, setState] = useState(null)
  useEffect(() => {
    let alive = true
    const from = addDays(today, -(HISTORY_DAYS - 1))
    Promise.all([store.listEntries(from, today), store.listWorkouts(from, today).catch(() => [])])
      .then(([entries, workouts]) => alive && setState({ from, daily: dailyTotals(entries), workouts }))
      .catch(() => alive && setState({ from, daily: {}, workouts: [] }))
    return () => {
      alive = false
    }
  }, [store, today, dataVersion])
  return state
}

/** Each day's calorie target: the base target plus that day's exercise allowance. */
function targetFor(date, workouts, targets, eatbackPct) {
  const burned = workouts.filter((w) => w.log_date === date).reduce((s, w) => s + (Number(w.calories_burned) || 0), 0)
  return (targets?.calories || 0) + exerciseAllowance(burned, eatbackPct)
}

// ---------------------------------------------------------------- wins strip

export function WinsCard({ recent }) {
  const { today, series, profile, units, openProgress } = useApp()
  const startKg = Number(profile.start_weight_kg)
  const goalKg = Number(profile.goal_weight_kg)
  const last = series[series.length - 1]
  const ms = useMemo(() => buildMilestones({ startKg, goalKg, series, units }), [startKg, goalKg, series, units])

  if (!recent) return <section className="card wins wins-loading" aria-hidden="true" />

  const streak = loggingStreak(recent.daily, today)
  const rest = new Set(streak.restDays)
  const dots = weekDots(recent.daily, today)
  const goal = goalProgress(startKg, goalKg, last?.weight)
  const next = milestoneProgress(ms, startKg, last?.weight)?.next
  const lostKg = last ? startKg - last.weight : null
  const loggedThisWeek = dots.filter((d) => d.logged).length

  const n = streak.days
  const title = n ? `${n}-day streak` : 'Start a streak'
  const yesterdayRest = rest.has(addDays(today, -1)) && !streak.todayLogged
  const sub = !n
    ? 'Log today to start one'
    : streak.todayLogged
      ? 'Today’s logged ✓'
      : yesterdayRest
        ? 'Rest day yesterday. Log today to keep it'
        : `Log today to make it ${n + 1}`

  const chips = []
  if (lostKg != null && Math.abs(weightValue(lostKg, units)) >= 0.1) {
    const v = weightValue(Math.abs(lostKg), units).toFixed(1)
    chips.push(lostKg > 0 ? `−${v} ${weightUnit(units)} since start` : `+${v} ${weightUnit(units)} since start`)
  }
  if (goal && !goal.reached) chips.push(`${Math.round(goal.fraction * 100)}% to goal`)
  if (goal?.reached) chips.push('Goal reached 🏆')
  if (next && next.kind !== 'goal') chips.push(`Next: ${milestoneText(next, units)}`)
  if (!last) chips.push('Weigh in to track your progress')

  return (
    <button
      type="button"
      className="card wins rise"
      style={{ '--i': 0 }}
      onClick={() => openProgress('awards')}
      aria-label={`${title}. ${loggedThisWeek} of the last 7 days logged. ${chips.join('. ')}. Open milestones and awards.`}
    >
      <div className="wins-top">
        <span className={`wins-flame${n ? ' lit' : ''}${streak.todayLogged ? ' today' : ''}`} aria-hidden="true">
          <Icon name="flame" size={22} strokeWidth={2.2} />
          {n > 0 && <b className="num">{n}</b>}
        </span>
        <span className="wins-text">
          <span className="wins-title">{title}</span>
          <span className="wins-sub">{sub}</span>
        </span>
        <span className="wins-dots" aria-hidden="true">
          {dots.map((d) => (
            <span key={d.date} className={`wins-dot${d.logged ? ' on' : ''}${d.today ? ' now' : ''}${rest.has(d.date) ? ' rest' : ''}`}>
              <i />
              <small>{NARROW_DAY.format(parseISODate(d.date))}</small>
            </span>
          ))}
        </span>
      </div>
      {chips.length > 0 && (
        <span className="wins-chips" aria-hidden="true">
          <span className="wins-chip-list">
            {chips.map((c) => (
              <span key={c} className="wins-chip num">{c}</span>
            ))}
          </span>
          <Icon name="right" size={16} className="wins-more" />
        </span>
      )}
    </button>
  )
}

// ---------------------------------------------------------------- three rings

/**
 * Concentric rings, Apple Activity style. rings: [{ key, value, max, a, b }],
 * outermost first. A ring in `cheer` pulses once (it just closed).
 */
export function RingStack({ rings, size = 128, stroke = 12, gap = 3, cheer = [] }) {
  const id = useId().replace(/:/g, '')
  const [shown, setShown] = useState(() => rings.map(() => 0))
  const fracs = rings.map((r) => (r.max > 0 ? Math.min(1, Math.max(0, r.value / r.max)) : 0))
  const fracKey = fracs.map((f) => f.toFixed(3)).join('|')
  useEffect(() => {
    const t = requestAnimationFrame(() => setShown(fracs))
    return () => cancelAnimationFrame(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fracKey])
  const c = size / 2
  return (
    // Drawn at `size`; CSS may scale it down on small phones (the viewBox keeps it sharp).
    <div className="ring-stack" style={{ '--rs': `${size}px` }}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          {rings.map((r) => (
            <linearGradient key={r.key} id={`rs-${id}-${r.key}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={r.a} />
              <stop offset="1" stopColor={r.b} />
            </linearGradient>
          ))}
        </defs>
        {rings.map((r, i) => {
          const rad = c - stroke / 2 - i * (stroke + gap)
          const len = 2 * Math.PI * rad
          const p = shown[i] ?? 0
          return (
            <g key={r.key} className={`rs-ring${cheer.includes(r.key) ? ' cheer' : ''}`} style={{ '--glow': r.b }}>
              <circle cx={c} cy={c} r={rad} fill="none" stroke={r.a} strokeOpacity="0.16" strokeWidth={stroke} />
              <circle
                className="ring-arc"
                cx={c}
                cy={c}
                r={rad}
                fill="none"
                stroke={`url(#rs-${id}-${r.key})`}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={len}
                strokeDashoffset={len * (1 - p)}
                transform={`rotate(-90 ${c} ${c})`}
                opacity={p > 0 ? 1 : 0}
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

const CHEER = {
  calories: '🎯 Calories on target',
  protein: '💪 Protein ring closed',
  water: '💧 Water ring closed',
}

/**
 * Cheer once when a ring closes while you watch: a pulse on the ring and a
 * toast. What's already closed when the day first loads is noted quietly, so
 * opening the app never replays old cheers.
 * Returns the keys of the rings pulsing right now.
 */
export function useRingCheer({ date, active, ready, closed }) {
  const { toast } = useApp()
  const [cheer, setCheer] = useState([])
  const timer = useRef()
  const key = `lili:rings:${date}`
  const now = ['calories', 'protein', 'water'].filter((k) => closed[k])
  const sig = now.join(',')
  useEffect(() => {
    if (!active || !ready) return
    const seen = readJson(key)
    if (!Array.isArray(seen)) return writeJson(key, now)
    const fresh = now.filter((k) => !seen.includes(k))
    if (!fresh.length) return
    writeJson(key, [...new Set([...seen, ...now])])
    setCheer(fresh)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCheer([]), 1600)
    toast(now.length === 3 ? '🏆 All three rings closed. Great day!' : CHEER[fresh[fresh.length - 1]])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, active, ready, key])
  useEffect(() => () => clearTimeout(timer.current), [])
  return cheer
}

// ---------------------------------------------------------------- weekly balance

/** "This week: 900 kcal under" for Monday to the shown day. */
export function WeekBalance({ recent, date }) {
  const { targets, profile } = useApp()
  if (!recent || !targets?.calories || date < recent.from) return null
  const start = weekStart(date)
  const days = []
  for (let d = start; d <= date; d = addDays(d, 1)) {
    days.push({ date: d, eaten: recent.daily[d]?.calories || 0, target: targetFor(d, recent.workouts, targets, profile.exercise_eatback_pct) })
  }
  const b = weekBalance(days, date)
  const counted = b.logged + ((recent.daily[date]?.calories || 0) > 0 ? 1 : 0)
  if (!counted) return null
  const under = b.balance >= 0
  return (
    <div className={`week-balance${under ? ' under' : ' over'}`}>
      <Icon name="calendar" size={16} />
      <span className="grow">
        This week: <strong className="num">{fmt(Math.abs(b.balance))} kcal {under ? 'under' : 'over'}</strong>
      </span>
      <span className="tiny muted num">{counted} day{counted === 1 ? '' : 's'}</span>
    </div>
  )
}

// ---------------------------------------------------------------- Sunday recap

/**
 * On Sundays: the week so far. On Mondays: last week. Dismissed per week.
 * Mimi's take is one tap away in cloud mode.
 */
export function WeekRecapCard({ recent }) {
  const { today, targets, series, units, mode, askCoach, profile } = useApp()
  const dow = (parseISODate(today).getDay() + 6) % 7 // 0 = Monday
  const isSunday = dow === 6
  const isMonday = dow === 0
  const start = isSunday ? weekStart(today) : addDays(weekStart(today), -7)
  const key = `lili:recap:${start}`
  const [hidden, setHidden] = useState(() => !!readJson(key))
  useEffect(() => setHidden(!!readJson(key)), [key])
  if ((!isSunday && !isMonday) || hidden || !recent || start < recent.from) return null

  const r = weekRecap({ start, daily: recent.daily, targets, series, workouts: recent.workouts, until: isSunday ? today : undefined })
  if (!r.logged && !r.workouts && r.trendChangeKg == null) return null

  const change = r.trendChangeKg == null ? null : weightValue(r.trendChangeKg, units)
  const changeText = change == null ? '—' : `${change < 0 ? '−' : change > 0 ? '+' : ''}${Math.abs(change).toFixed(1)} ${weightUnit(units)}`
  const range = `${formatShortDate(r.start)} – ${formatShortDate(r.end)}`
  const dismiss = () => {
    writeJson(key, true)
    setHidden(true)
  }
  const ask = () =>
    askCoach(
      `Here's my week (${range}): I logged food on ${r.logged} of ${r.days} days` +
        (r.avgKcal ? `, averaging ${fmt(r.avgKcal)} kcal against a ${fmt(targets?.calories || 0)} kcal target` : '') +
        `, hit my protein target on ${r.proteinDays} day${r.proteinDays === 1 ? '' : 's'}, my trend moved ${changeText} and I did ${r.workouts} workout${r.workouts === 1 ? '' : 's'}.` +
        ` What went well, and what's the one thing I should focus on next week?`,
    )

  return (
    <section className="card recap rise" style={{ '--i': 2 }} aria-labelledby="recap-title">
      <CardHeader id="recap-title" lead={<PenguinFace size={34} />} eyebrow={range} title={isSunday ? 'Your week so far' : 'Last week'}>
        <button type="button" className="icon-btn quiet" aria-label="Hide this week’s recap" onClick={dismiss}>
          <Icon name="close" />
        </button>
      </CardHeader>
      <div className="recap-grid">
        <RecapStat label="Days logged" value={`${r.logged}/${r.days}`} />
        <RecapStat label="Avg kcal" value={r.avgKcal ? fmt(r.avgKcal) : '—'} sub={targets?.calories ? `target ${fmt(targets.calories)}` : null} />
        <RecapStat label="Protein days" value={r.proteinDays} />
        <RecapStat label="Trend" value={changeText} good={change != null && change < 0} />
        <RecapStat label="Workouts" value={r.workouts} />
        <RecapStat label="On target" value={`${r.onTarget} day${r.onTarget === 1 ? '' : 's'}`} />
      </div>
      {r.bestDay && <p className="small recap-best">⭐ Best day: <strong>{LONG_DAY.format(parseISODate(r.bestDay))}</strong></p>}
      {mode === 'cloud' && (
        <button type="button" className="btn secondary sm block mt-4" onClick={ask}>
          Ask Mimi for next week’s focus
        </button>
      )}
      {mode !== 'cloud' && profile && <p className="tiny muted mt-3">Sign in to ask Mimi what to focus on next week.</p>}
    </section>
  )
}

function RecapStat({ label, value, sub, good }) {
  return (
    <div className="recap-stat">
      <div className="tiny muted">{label}</div>
      <div className={`recap-v num${good ? ' good' : ''}`}>{value}</div>
      {sub && <div className="tiny muted num">{sub}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- sky

/** The tint behind the Today header follows the time of day. */
export function skyFor(hour) {
  if (hour >= 5 && hour < 8) return 'dawn'
  if (hour >= 8 && hour < 17) return 'day'
  if (hour >= 17 && hour < 20) return 'dusk'
  return 'night'
}

