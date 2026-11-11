import { useEffect, useMemo, useState } from 'react'
import { displayWeight, weightUnit, weightValue } from '../lib/calc.js'
import { daysBetween, formatShortDate } from '../lib/dates.js'
import { newBadges } from '../lib/milestones.js'

// ---------------------------------------------------------------- labels

const r1 = (n) => Math.round(n * 10) / 10

/** Short label under a node: "−5 lb", "5%", "Goal". */
export function milestoneLabel(m, units) {
  if (m.kind === 'goal') return 'Goal'
  if (m.kind === 'health') return `${m.pct}%`
  return `−${r1(weightValue(m.lostKg, units))} ${weightUnit(units)}`
}

function milestoneName(m, units) {
  if (m.kind === 'goal') return `your goal (${displayWeight(m.targetKg, units)})`
  if (m.kind === 'health') return `${m.pct}% lighter (${displayWeight(m.targetKg, units)})`
  return displayWeight(m.targetKg, units)
}

// ---------------------------------------------------------------- milestones card

export function MilestonesCard({ milestones, progress, goal, series, units, pcos }) {
  if (!milestones.length || !progress || !goal) return null
  const { next, last, toNextKg, fraction, reachedCount, total } = progress
  // The ring and the headline track the main goal from the profile; the mini
  // milestones are the stepping stones shown underneath.
  const goalPct = Math.round(goal.fraction * 100)
  const done = !next // the trend has reached the goal

  // A window of the path: the last two reached and the next few.
  const nextIdx = next ? milestones.indexOf(next) : milestones.length
  const from = Math.max(0, Math.min(nextIdx - 2, milestones.length - 6))
  const shown = milestones.slice(from, from + 6)
  const pct = Math.round(fraction * 100)

  return (
    <section className="card milestones" aria-labelledby="ms-title">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h2 id="ms-title" style={{ margin: 0 }}>Milestones</h2>
        <span className="small muted num">
          {reachedCount} of {total}
        </span>
      </div>

      <div className="ms-hero">
        <svg className="ms-ring" viewBox="0 0 84 84" aria-hidden="true">
          <circle cx="42" cy="42" r="34" className="ms-ring-bg" />
          <circle
            key={`goal-${goalPct}`}
            cx="42"
            cy="42"
            r="34"
            pathLength="100"
            className="ms-ring-fg"
            style={{ '--off': 100 - (done ? 100 : goalPct) }}
            transform="rotate(-90 42 42)"
          />
        </svg>
        <div className="ms-ring-label num" aria-hidden="true">
          {done ? '🏆' : `${goalPct}%`}
        </div>
        <div className="grow">
          {done ? (
            <>
              <div className="ms-next">Goal reached</div>
              <div className="small muted">Every milestone done. Time to set a maintenance plan.</div>
            </>
          ) : (
            <>
              <div className="small muted">Your goal: {displayWeight(goal.goalKg, units)}</div>
              <div className="ms-next num">
                {goal.reached ? 'At your goal weight' : `${displayWeight(goal.toGoalKg, units)} to go`}
              </div>
              <div className="small">
                {goal.reached ? (
                  <span className="muted">It counts once your trend gets there too.</span>
                ) : (
                  <>
                    Next milestone: <strong className="num">{milestoneLabel(next, units)}</strong>
                    {next.kind !== 'goal' && <span className="muted num"> · {displayWeight(toNextKg, units)} away</span>}
                  </>
                )}
                {last && <span className="muted"> · last: {milestoneLabel(last, units)} on {formatShortDate(last.reachedOn)}</span>}
              </div>
            </>
          )}
        </div>
      </div>

      <ol className="ms-path" aria-label="Milestone path">
        {shown.map((m, i) => {
          const isNext = m === next
          const prevReached = i === 0 ? true : shown[i - 1].reached
          const fill = m.reached ? 1 : isNext && prevReached ? fraction : 0
          return (
            <li key={m.id} className={`ms-node ${m.kind}${m.reached ? ' done' : ''}${isNext ? ' next' : ''}`} style={{ '--i': i }}>
              {i > 0 && (
                <span className="ms-link" aria-hidden="true">
                  <i style={{ '--p': fill }} />
                </span>
              )}
              <span className="ms-dot" aria-hidden="true">
                {m.reached ? '✓' : m.kind === 'goal' ? '★' : m.kind === 'health' ? '♥' : ''}
              </span>
              <span className="ms-label num">{milestoneLabel(m, units)}</span>
              <span className="sr-only">
                {milestoneName(m, units)}: {m.reached ? `reached ${formatShortDate(m.reachedOn)}` : isNext ? `next, ${pct}% of the way` : 'ahead'}
              </span>
            </li>
          )
        })}
      </ol>

      <MilestoneChart series={series} milestones={milestones} next={next} units={units} />

      <p className="tiny muted" style={{ margin: '10px 0 0' }}>
        Milestones count when your <strong>trend</strong> gets there, so one heavy morning can't take one away.{' '}
        {pcos
          ? 'With PCOS, the 5% and 10% marks (♥) can bring back regular cycles and help fertility, even while the goal is far off.'
          : 'The 5% and 10% marks (♥) already lower blood pressure and blood sugar.'}
      </p>
    </section>
  )
}

// ---------------------------------------------------------------- chart

const W = 340
const H = 170
const PAD = { l: 14, r: 50, t: 12, b: 22 }

/** Trend line since the start, milestone lines, and a marker where each was reached. */
export function MilestoneChart({ series, milestones, next, units }) {
  const geo = useMemo(() => {
    if (series.length < 2) return null
    const conv = (kg) => weightValue(kg, units)
    const pts = series.map((p) => ({ date: p.date, v: conv(p.trend) }))
    const reached = milestones.filter((m) => m.reached)
    // Show the reached milestones in range plus the next one ahead.
    const lines = milestones.filter((m) => m.reached || m === next)
    const vals = [...pts.map((p) => p.v), ...lines.map((m) => conv(m.targetKg))]
    let min = Math.min(...vals)
    let max = Math.max(...vals)
    const pad = (max - min) * 0.1 || 1
    min -= pad
    max += pad
    const first = pts[0].date
    const span = Math.max(1, daysBetween(first, pts[pts.length - 1].date))
    const x = (d) => PAD.l + (daysBetween(first, d) / span) * (W - PAD.l - PAD.r)
    const y = (v) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b)
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
    // Too many labelled lines get cramped: label every other step when crowded.
    const crowded = lines.length > 6
    return { x, y, line, lines, reached, conv, crowded, first, last: pts[pts.length - 1] }
  }, [series, milestones, next, units])

  if (!geo) return <p className="small muted" style={{ marginTop: 12 }}>Log a few more weigh-ins to see your milestone chart.</p>
  const { x, y, line, lines, reached, conv, crowded, first, last } = geo

  return (
    <div className="chart ms-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Weight trend with ${reached.length} milestones reached`}>
        {lines.map((m, i) => {
          const yy = y(conv(m.targetKg))
          const showLabel = !crowded || m.kind !== 'step' || m === next || i % 2 === 0
          return (
            <g key={m.id} className={`ms-line ${m.kind}${m.reached ? ' done' : ''}`}>
              <line x1={PAD.l} x2={W - PAD.r} y1={yy} y2={yy} />
              {showLabel && (
                <text x={W - PAD.r + 10} y={yy + 3}>
                  {milestoneLabel(m, units)}
                </text>
              )}
            </g>
          )
        })}
        <path className="draw" pathLength="1" d={line} fill="none" stroke="var(--indigo)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {reached.map((m, i) => (
          <g key={m.id} className="ms-marker" style={{ '--i': i }} transform={`translate(${x(m.reachedOn).toFixed(1)} ${y(conv(m.targetKg)).toFixed(1)})`}>
            <circle r="7" />
            <path d="M-3 0.2 L-0.8 2.4 L3.2 -2.2" />
          </g>
        ))}
        <circle cx={x(last.date)} cy={y(last.v)} r="4.5" className="ms-now" />
        <text x={PAD.l} y={H - 5}>{formatShortDate(first)}</text>
        <text x={W - PAD.r} y={H - 5} textAnchor="end">{formatShortDate(last.date)}</text>
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------- badges

export function BadgeGrid({ badges, fresh = [], units, onOpen }) {
  const earned = badges.filter((b) => b.earned).length
  return (
    <section className="card" aria-labelledby="badges-title">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h2 id="badges-title" style={{ margin: 0 }}>Badges</h2>
        <span className="small muted num">
          {earned} of {badges.length}
        </span>
      </div>
      <div className="award-grid">
        {badges.map((b, i) => (
          <button
            key={b.id}
            type="button"
            className={`award rise${b.earned ? ' earned' : ''}${fresh.includes(b.id) ? ' fresh' : ''}`}
            style={{ '--i': i, '--c': b.color }}
            onClick={() => onOpen(b)}
            aria-label={`${b.title}: ${b.earned ? 'earned' : `locked, ${progressText(b, units)}`}`}
          >
            <span className="award-medal">
              <span className="award-emoji" aria-hidden="true">{b.emoji}</span>
              {!b.earned && <AwardRing value={b.goal ? b.value / b.goal : 0} />}
            </span>
            <span className="award-title">{b.title}</span>
            <span className="award-sub num">{b.earned ? (b.earnedOn ? formatShortDate(b.earnedOn) : 'Earned') : progressText(b, units)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function progressText(b, units) {
  if (b.weightBased) return `${r1(weightValue(b.value, units))} / ${r1(weightValue(b.goal, units))} ${weightUnit(units)}`
  return `${Math.floor(b.value)} / ${b.goal}`
}

function AwardRing({ value }) {
  return (
    <svg className="award-ring" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="29" pathLength="100" style={{ '--off': 100 - Math.round(Math.max(0, Math.min(1, value)) * 100) }} transform="rotate(-90 32 32)" />
    </svg>
  )
}

const CONFETTI = Array.from({ length: 14 }, (_, i) => i)

/** Full-screen moment for newly earned badges, one at a time. */
export function BadgeCelebration({ badges, units, onDone }) {
  const [i, setI] = useState(0)
  const b = badges[i]
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onDone()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDone])
  if (!b) return null
  const more = badges.length - i - 1
  const next = () => (more > 0 ? setI(i + 1) : onDone())
  return (
    <div className="celebrate" role="dialog" aria-modal="true" aria-label={`New badge: ${b.title}`} onClick={next}>
      <div className="celebrate-card" key={b.id} style={{ '--c': b.color }} onClick={(e) => e.stopPropagation()}>
        <div className="celebrate-burst" aria-hidden="true" />
        <div className="confetti" aria-hidden="true">
          {CONFETTI.map((k) => (
            <i key={k} style={{ '--k': k }} />
          ))}
        </div>
        <div className="celebrate-medal" aria-hidden="true">
          <span>{b.emoji}</span>
        </div>
        <div className="eyebrow" style={{ color: 'var(--c)' }}>New badge</div>
        <h2 className="celebrate-title">{b.title}</h2>
        <p className="muted">{b.desc}{b.weightBased ? ` (${displayWeight(b.goal, units)})` : ''}</p>
        <button className="btn block" autoFocus onClick={next}>
          {more > 0 ? `Nice! Next (${more} more)` : 'Nice!'}
        </button>
      </div>
    </div>
  )
}

/** One badge's details, from a tap in the grid. */
export function BadgeDetail({ badge, units, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="celebrate quiet" role="dialog" aria-modal="true" aria-label={badge.title} onClick={onClose}>
      <div className="celebrate-card" style={{ '--c': badge.color }} onClick={(e) => e.stopPropagation()}>
        <div className={`celebrate-medal${badge.earned ? '' : ' locked'}`} aria-hidden="true">
          <span>{badge.emoji}</span>
        </div>
        <h2 className="celebrate-title">{badge.title}</h2>
        <p className="muted">{badge.desc}</p>
        <p className="small">
          {badge.earned
            ? badge.earnedOn
              ? `Earned ${formatShortDate(badge.earnedOn)}`
              : 'Earned'
            : `Progress: ${progressText(badge, units)}`}
        </p>
        <button className="btn gray block" autoFocus onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- seen badges

const seenKey = (who) => `lili:badges-seen:${who || 'local'}`

function readSeen(who) {
  try {
    const raw = localStorage.getItem(seenKey(who))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeSeen(who, ids) {
  try {
    localStorage.setItem(seenKey(who), JSON.stringify(ids))
  } catch {
    /* private mode: badges may celebrate again next time */
  }
}

/**
 * Which earned badges are new on this device. The first time, everything
 * already earned is marked as seen quietly (no flood of celebrations).
 * Only call with `ready` once all the data the badges use has loaded.
 */
export function useNewBadges(badges, ready, who) {
  const [fresh, setFresh] = useState([])
  const [queue, setQueue] = useState([])
  const [kept, setKept] = useState(() => readSeen(who) || [])
  useEffect(() => {
    if (!ready) return
    const seen = readSeen(who)
    const earnedIds = badges.filter((b) => b.earned).map((b) => b.id)
    if (seen == null) {
      writeSeen(who, earnedIds)
      setKept(earnedIds)
      return
    }
    const found = newBadges(badges, seen)
    if (!found.length) return
    const all = [...new Set([...seen, ...earnedIds])]
    writeSeen(who, all)
    setKept(all)
    setFresh(found.map((b) => b.id))
    setQueue(found)
  }, [badges, ready, who])
  return { fresh, queue, kept, dismiss: () => setQueue([]) }
}

/**
 * Once earned, always earned: a badge stays even if its numbers later dip
 * (a higher protein target, old logs leaving the one-year window).
 */
export function keepEarned(badges, keptIds) {
  const kept = new Set(keptIds)
  return badges.map((b) => (!b.earned && kept.has(b.id) ? { ...b, earned: true, value: b.goal } : b))
}
