import { useId, useMemo, useRef, useState } from 'react'
import { parseISODate } from '../lib/dates.js'

const W = 340
const H = 190
const PAD = { l: 38, r: 10, t: 14, b: 24 }

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

const fmtDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const fmtDayLong = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const fmtMonth = new Intl.DateTimeFormat('en-GB', { month: 'short' })
const fmtMonthLong = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' })

/** Axis label for a bucket. */
export function bucketLabel(b, granularity, long = false) {
  const d = parseISODate(b.start)
  if (granularity === 'month') return long ? fmtMonthLong.format(d) : fmtMonth.format(d)
  if (granularity === 'week') return long ? `Week of ${fmtDay.format(d)}` : fmtDay.format(d)
  return long ? fmtDayLong.format(d) : fmtDay.format(d)
}

/** Smooth path through points (monotone-ish Catmull-Rom → Bézier, no overshoot past neighbours). */
function smoothPath(pts) {
  if (!pts.length) return ''
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1] || pts[i]
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[i + 1]
    const [x3, y3] = pts[i + 2] || pts[i + 1]
    const t = 0.18
    let c1y = y1 + (y2 - y0) * t
    let c2y = y2 - (y3 - y1) * t
    const lo = Math.min(y1, y2)
    const hi = Math.max(y1, y2)
    c1y = Math.min(hi, Math.max(lo, c1y))
    c2y = Math.min(hi, Math.max(lo, c2y))
    d += ` C${(x1 + (x2 - x0) * t).toFixed(1)},${c1y.toFixed(1)} ${(x2 - (x3 - x1) * t).toFixed(1)},${c2y.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`
  }
  return d
}

/**
 * Interactive trend line for day / week / month buckets.
 * buckets: [{ key, start, end, value }] oldest first (value null = no data).
 * dots: optional raw values per bucket (e.g. scale weigh-ins under the trend).
 * Drag across it to read any point.
 */
export function TrendChart({ buckets, dots, granularity = 'day', color = 'var(--blue)', color2, target, targetLabel = 'target', format = (v) => Math.round(v), tipFormat, unit = '', ariaLabel = 'Trend chart' }) {
  const id = useId().replace(/:/g, '')
  const svgRef = useRef()
  const [hover, setHover] = useState(null)

  const geo = useMemo(() => {
    const vals = buckets.map((b) => b.value).filter((v) => v != null)
    const dotVals = (dots || []).filter((v) => v != null)
    if (!vals.length) return null
    let min = Math.min(...vals, ...dotVals)
    let max = Math.max(...vals, ...dotVals)
    const showTarget = target != null && target > 0 && target >= min - (max - min) * 0.8 && target <= max + (max - min) * 0.8 + 1
    if (showTarget) {
      min = Math.min(min, target)
      max = Math.max(max, target)
    }
    const pad = (max - min) * 0.12 || Math.max(1, Math.abs(max) * 0.05)
    min -= pad
    max += pad
    const n = buckets.length
    const x = (i) => PAD.l + (n === 1 ? 0.5 : i / (n - 1)) * (W - PAD.l - PAD.r)
    const y = (v) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b)
    const pts = buckets.map((b, i) => (b.value == null ? null : [x(i), y(b.value), i])).filter(Boolean)
    const line = smoothPath(pts)
    const area = pts.length > 1 ? `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - PAD.b} L${pts[0][0].toFixed(1)},${H - PAD.b} Z` : ''
    return { min, max, x, y, pts, line, area, ticks: niceTicks(min, max), showTarget }
  }, [buckets, dots, target])

  if (!geo) return <p className="small muted chart-empty">Nothing logged in this period yet.</p>

  const { x, y, pts, line, area, ticks, showTarget } = geo
  const n = buckets.length
  const labelIdx = n <= 2 ? [0, n - 1] : [0, Math.round((n - 1) / 2), n - 1]

  function pick(clientX) {
    const r = svgRef.current?.getBoundingClientRect()
    if (!r) return
    const sx = ((clientX - r.left) / r.width) * W
    let best = null
    for (const p of pts) if (!best || Math.abs(p[0] - sx) < Math.abs(best[0] - sx)) best = p
    if (best) setHover(best[2])
  }
  const hb = hover != null ? buckets[hover] : null
  const hx = hb ? x(hover) : 0

  return (
    <div className="chart trend-chart">
      <div className={`chart-tip${hb ? ' on' : ''}`} aria-live="polite" style={hb ? { '--x': `${(hx / W) * 100}%` } : undefined}>
        {hb && (
          <>
            <strong className="num">
              {(tipFormat || format)(hb.value)}
              {unit && <span className="chart-tip-unit"> {unit}</span>}
            </strong>
            <span>{bucketLabel(hb, granularity, true)}</span>
          </>
        )}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={ariaLabel}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerMove={(e) => (e.pointerType === 'mouse' || e.buttons) && pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
        onPointerUp={(e) => e.pointerType !== 'mouse' && setTimeout(() => setHover(null), 1600)}
      >
        <defs>
          <linearGradient id={`line-${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={color} />
            <stop offset="1" stopColor={color2 || color} />
          </linearGradient>
          <linearGradient id={`area-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color2 || color} stopOpacity="0.22" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--sep)" />
            <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end">{format(t)}</text>
          </g>
        ))}
        {showTarget && (
          <g>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(target)} y2={y(target)} stroke="var(--text-2)" strokeDasharray="4 4" strokeOpacity="0.7" />
            <text x={W - PAD.r} y={y(target) - 5} textAnchor="end" className="chart-target">{targetLabel}</text>
          </g>
        )}
        {area && <path className="chart-area" d={area} fill={`url(#area-${id})`} />}
        {dots?.map((v, i) => (v == null ? null : <circle key={`d${i}`} cx={x(i)} cy={y(v)} r="2.4" className="chart-dot" />))}
        <path key={`${granularity}-${n}-${line.length}`} className="draw" pathLength="1" d={line} fill="none" stroke={`url(#line-${id})`} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {pts.length === 1 && <circle cx={pts[0][0]} cy={pts[0][1]} r="4" fill={color} />}
        {hb && (
          <g className="chart-cursor">
            <line x1={hx} x2={hx} y1={PAD.t} y2={H - PAD.b} stroke="var(--text-3)" />
            <circle cx={hx} cy={y(hb.value)} r="5.5" fill="var(--card)" stroke={color} strokeWidth="2.5" />
          </g>
        )}
        {labelIdx.map((i, k) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={k === 0 ? 'start' : k === labelIdx.length - 1 ? 'end' : 'middle'}>
            {bucketLabel(buckets[i], granularity)}
          </text>
        ))}
      </svg>
    </div>
  )
}

/** Tiny line with no axes, for dashboard and collapsed cards. */
export function Sparkline({ values, color = 'var(--blue)', width = 96, height = 32, className = '' }) {
  const id = useId().replace(/:/g, '')
  const vals = values.map((v, i) => [i, v]).filter(([, v]) => v != null)
  if (vals.length < 2) return <span className={`sparkline empty ${className}`} style={{ width, height }} aria-hidden="true" />
  const ys = vals.map(([, v]) => v)
  const min = Math.min(...ys)
  const max = Math.max(...ys)
  const n = values.length
  const pts = vals.map(([i, v]) => [2 + (i / (n - 1)) * (width - 4), 3 + (1 - (v - min) / (max - min || 1)) * (height - 6)])
  const line = smoothPath(pts)
  const last = pts[pts.length - 1]
  return (
    <svg className={`sparkline ${className}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <defs>
        <linearGradient id={`sp-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.25" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${last[0]},${height} L${pts[0][0]},${height} Z`} fill={`url(#sp-${id})`} />
      <path className="draw" pathLength="1" d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={color} />
    </svg>
  )
}
