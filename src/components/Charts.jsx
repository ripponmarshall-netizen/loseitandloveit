import { daysBetween, formatShortDate } from '../lib/dates.js'
import { weightValue } from '../lib/calc.js'

const W = 340
const H = 180
const PAD = { l: 34, r: 8, t: 10, b: 22 }

function niceTicks(min, max, count = 4) {
  const span = max - min || 1
  const step = Math.pow(10, Math.floor(Math.log10(span / count)))
  const err = span / count / step
  const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1
  const s = step * mult
  const out = []
  for (let v = Math.ceil(min / s) * s; v <= max + 1e-9; v += s) out.push(Math.round(v * 100) / 100)
  return out
}

export function WeightChart({ series, goalKg, units, fromDate, toDate }) {
  const pts = series.filter((p) => p.date >= fromDate && p.date <= toDate)
  if (pts.length < 2) {
    return <p className="small muted">Log at least two weigh-ins to see your trend. Morning, after the toilet, before food works best.</p>
  }
  const conv = (kg) => weightValue(kg, units)
  const vals = pts.flatMap((p) => [conv(p.weight), conv(p.trend)])
  let min = Math.min(...vals)
  let max = Math.max(...vals)
  const goal = goalKg ? conv(goalKg) : null
  const showGoal = goal != null && goal >= min - (max - min) * 0.6
  if (showGoal) min = Math.min(min, goal)
  const padY = (max - min) * 0.08 || 1
  min -= padY
  max += padY

  const days = Math.max(1, daysBetween(pts[0].date, pts[pts.length - 1].date))
  const x = (d) => PAD.l + (daysBetween(pts[0].date, d) / days) * (W - PAD.l - PAD.r)
  const y = (v) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b)
  const trendPath = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(conv(p.trend)).toFixed(1)}`).join(' ')

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Weight and trend chart">
        {niceTicks(min, max).map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={PAD.l - 4} y={y(t) + 3} textAnchor="end">{t}</text>
          </g>
        ))}
        {showGoal && (
          <g>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(goal)} y2={y(goal)} stroke="var(--ok)" strokeDasharray="4 4" />
            <text x={W - PAD.r} y={y(goal) - 4} textAnchor="end" style={{ fill: 'var(--ok)' }}>goal</text>
          </g>
        )}
        {pts.map((p) => (
          <line key={`s${p.date}`} x1={x(p.date)} x2={x(p.date)} y1={y(conv(p.weight))} y2={y(conv(p.trend))} stroke="var(--muted)" strokeOpacity="0.35" />
        ))}
        {pts.map((p) => (
          <circle key={p.date} cx={x(p.date)} cy={y(conv(p.weight))} r="2.6" fill="var(--muted)" fillOpacity="0.7" />
        ))}
        <path d={trendPath} fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <text x={PAD.l} y={H - 6}>{formatShortDate(pts[0].date)}</text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end">{formatShortDate(pts[pts.length - 1].date)}</text>
      </svg>
      <p className="tiny muted" style={{ margin: '4px 0 0' }}>
        Dots are weigh-ins; the line is your smoothed trend. Judge progress by the line, not the dots.
      </p>
    </div>
  )
}

export function CalorieBars({ dates, daily, target }) {
  const vals = dates.map((d) => daily[d]?.calories || 0)
  const max = Math.max(target * 1.3, ...vals, 1)
  const H2 = 140
  const bw = (W - PAD.l - PAD.r) / dates.length
  const y = (v) => PAD.t + (1 - v / max) * (H2 - PAD.t - PAD.b)
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H2}`} role="img" aria-label="Daily calories chart">
        {dates.map((d, i) => {
          const v = vals[i]
          const over = v > target
          return (
            <g key={d}>
              <rect
                x={PAD.l + i * bw + bw * 0.15}
                y={v ? y(v) : y(0) - 2}
                width={bw * 0.7}
                height={v ? y(0) - y(v) : 2}
                rx="3"
                fill={!v ? 'var(--line)' : over ? 'var(--accent)' : 'var(--brand)'}
              />
              {(i === 0 || i === dates.length - 1 || i % 7 === 6) && (
                <text x={PAD.l + i * bw + bw / 2} y={H2 - 6} textAnchor="middle">{formatShortDate(d).split(' ')[0]}</text>
              )}
            </g>
          )
        })}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(target)} y2={y(target)} stroke="var(--text)" strokeOpacity="0.5" strokeDasharray="4 4" />
        <text x={PAD.l - 4} y={y(target) + 3} textAnchor="end">{target}</text>
      </svg>
    </div>
  )
}
