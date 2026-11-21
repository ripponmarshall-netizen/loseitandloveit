import { useEffect, useId, useMemo, useRef, useState } from 'react'
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

/** Step path: holds each value flat until the next one (dose levels). */
function stepPath(pts) {
  if (!pts.length) return ''
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 1; i < pts.length; i++) d += ` H${pts[i][0].toFixed(1)} V${pts[i][1].toFixed(1)}`
  return d
}

/**
 * Tap or drag to read a point. Shared by every chart so they all behave the
 * same: the reading stays up for a moment after the finger lifts (on touch,
 * pointerleave fires straight after pointerup, which used to hide it at once).
 * `reset` changes when the data does, so a stale index never points at a
 * different (or empty) point.
 */
function useChartCursor(reset) {
  const [hover, setHover] = useState(null)
  const hideTimer = useRef()
  useEffect(() => () => clearTimeout(hideTimer.current), [])
  useEffect(() => setHover(null), [reset])
  const linger = () => {
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setHover(null), 2200)
  }
  const handlers = (pick) => ({
    onPointerDown: (e) => {
      clearTimeout(hideTimer.current)
      pick(e)
    },
    onPointerMove: (e) => (e.pointerType === 'mouse' || e.buttons) && pick(e),
    onPointerLeave: (e) => e.pointerType === 'mouse' && setHover(null),
    onPointerUp: (e) => e.pointerType !== 'mouse' && linger(),
    onPointerCancel: linger, // the page took over to scroll
  })
  return [hover, setHover, handlers]
}

/**
 * Interactive trend chart for day / week / month buckets.
 * buckets: [{ key, start, end, value }] oldest first (value null = no data).
 * dots: optional raw values per bucket (e.g. scale weigh-ins under the trend).
 * bars: draw a bar per bucket instead of a line (always from zero; negative
 * values hang below it). barColor(value, i) picks each bar's colour.
 * labelOf(bucket, long) overrides the date labels (e.g. weekdays).
 */
export function TrendChart({
  buckets, dots, granularity = 'day', color = 'var(--brand)', color2, target, targetLabel = 'target',
  format = (v) => Math.round(v), tipFormat, tipNote, unit = '', ariaLabel = 'Trend chart', step = false, zero = false,
  bars = false, barColor, labelOf,
}) {
  const id = useId().replace(/:/g, '')
  const svgRef = useRef()
  const n = buckets.length
  const sig = `${granularity}|${n}|${buckets[0]?.key}|${bars}`
  const [hover, setHover, handlers] = useChartCursor(sig)

  const geo = useMemo(() => {
    const vals = buckets.map((b) => b.value).filter((v) => v != null)
    const dotVals = (dots || []).filter((v) => v != null)
    if (!vals.length) return null
    const fromZero = zero || bars
    let min = Math.min(...vals, ...dotVals)
    let max = Math.max(...vals, ...dotVals)
    if (fromZero) {
      min = Math.min(0, min)
      max = Math.max(0, max)
    }
    const showTarget = target != null && target > 0 && target >= min - (max - min) * 0.8 && target <= max + (max - min) * 0.8 + 1
    if (showTarget) {
      min = Math.min(min, target)
      max = Math.max(max, target)
    }
    const pad = (max - min) * 0.12 || Math.max(1, Math.abs(max) * 0.05)
    if (!fromZero || min < 0) min -= pad
    if (max > 0 || !fromZero) max += pad
    const plotW = W - PAD.l - PAD.r
    // Bars sit in slots, so the first and last aren't cut in half by the edges.
    const x = bars ? (i) => PAD.l + ((i + 0.5) / n) * plotW : (i) => PAD.l + (n === 1 ? 0.5 : i / (n - 1)) * plotW
    const y = (v) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b)
    const pts = buckets.map((b, i) => (b.value == null ? null : [x(i), y(b.value), i])).filter(Boolean)
    const line = bars ? '' : step ? stepPath(pts) : smoothPath(pts)
    const area = !bars && pts.length > 1 ? `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - PAD.b} L${pts[0][0].toFixed(1)},${H - PAD.b} Z` : ''
    const barW = Math.max(2, Math.min(26, (plotW / n) * 0.64))
    return { min, max, x, y, pts, line, area, ticks: niceTicks(min, max), showTarget, barW }
  }, [buckets, dots, target, step, zero, bars, n])

  if (!geo) return <p className="small muted chart-empty">Nothing logged in this period yet.</p>

  const { x, y, pts, line, area, ticks, showTarget, barW } = geo
  const labelIdx = labelOf && n <= 7 ? buckets.map((_, i) => i) : n <= 2 ? [0, n - 1] : [0, Math.round((n - 1) / 2), n - 1]
  const label = (b, long) => (labelOf ? labelOf(b, long) : bucketLabel(b, granularity, long))

  const pick = (e) => {
    const r = svgRef.current?.getBoundingClientRect()
    if (!r) return
    const sx = ((e.clientX - r.left) / r.width) * W
    let best = null
    for (const p of pts) if (!best || Math.abs(p[0] - sx) < Math.abs(best[0] - sx)) best = p
    if (best) setHover(best[2])
  }
  const hb = hover != null && buckets[hover]?.value != null ? buckets[hover] : null
  // Bars grow in one after another, but the whole wave takes the same short time however many there are.
  const stagger = Math.min(1, 14 / Math.max(1, buckets.length))
  const hx = hb ? x(hover) : 0
  const y0 = y(Math.max(geo.min, Math.min(geo.max, 0)))

  return (
    <div className="chart trend-chart">
      <div className={`chart-tip${hb ? ' on' : ''}`} aria-live="polite" style={hb ? { '--x': `${(hx / W) * 100}%` } : undefined}>
        {hb && (
          <>
            <strong className="num">
              {(tipFormat || format)(hb.value)}
              {unit && <span className="chart-tip-unit"> {unit}</span>}
            </strong>
            <span>{label(hb, true)}{tipNote ? ` · ${tipNote(hb)}` : ''}</span>
          </>
        )}
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} {...handlers(pick)}>
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
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--sep)" strokeWidth={t === 0 && bars ? 1.5 : 1} />
            <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end">{format(t)}</text>
          </g>
        ))}
        {bars && (
          <g key={sig} className="chart-bars">
            {buckets.map((b, i) =>
              b.value == null || b.value === 0 ? null : (
                <rect
                  key={b.key}
                  className={`chart-bar${b.value < 0 ? ' neg' : ''}${hb && hover !== i ? ' dim' : ''}`}
                  x={x(i) - barW / 2}
                  width={barW}
                  y={Math.min(y(b.value), y0)}
                  height={Math.max(1.5, Math.abs(y(b.value) - y0))}
                  rx={Math.min(5, barW / 2.5)}
                  fill={barColor ? barColor(b.value, i) : `url(#line-${id})`}
                  style={{ '--i': i * stagger }}
                />
              ),
            )}
          </g>
        )}
        {showTarget && (
          <g>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(target)} y2={y(target)} stroke="var(--text-2)" strokeDasharray="4 4" strokeOpacity="0.7" />
            <text x={W - PAD.r} y={y(target) - 5} textAnchor="end" className="chart-target">{targetLabel}</text>
          </g>
        )}
        {area && <path className="chart-area" d={area} fill={`url(#area-${id})`} />}
        {dots?.map((v, i) => (v == null ? null : <circle key={`d${i}`} cx={x(i)} cy={y(v)} r={step ? 3.6 : 2.4} className={`chart-dot${step ? ' marked' : ''}`} style={step ? { fill: color } : undefined} />))}
        {line && <path key={`${granularity}-${n}-${line.length}`} className="draw" pathLength="1" d={line} fill="none" stroke={`url(#line-${id})`} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}
        {!bars && pts.length === 1 && <circle cx={pts[0][0]} cy={pts[0][1]} r="4" fill={color} />}
        {hb && (
          <g className="chart-cursor">
            {!bars && <line x1={hx} x2={hx} y1={PAD.t} y2={H - PAD.b} stroke="var(--text-3)" />}
            {!bars && <circle cx={hx} cy={y(hb.value)} r="5.5" fill="var(--card)" stroke={color} strokeWidth="2.5" />}
          </g>
        )}
        {labelIdx.map((i, k) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={labelOf ? 'middle' : k === 0 ? 'start' : k === labelIdx.length - 1 ? 'end' : 'middle'} className={hb && hover === i ? 'on' : undefined}>
            {label(buckets[i], false)}
          </text>
        ))}
      </svg>
    </div>
  )
}

/**
 * One 100% bar per column, split into coloured parts (e.g. each week's
 * calories from protein, carbs and fat). columns: [{ key, label, long, parts: [value…] | null }],
 * series: [{ label, color }] matching the parts. Tap a column to read it.
 */
export function StackedBars({ columns, series, ariaLabel, unit = '%' }) {
  const [hover, setHover, handlers] = useChartCursor(columns.map((c) => c.key).join())
  const ref = useRef()
  const n = columns.length
  const pick = (e) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const i = Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n)))
    setHover(columns[i]?.parts ? i : null)
  }
  const hc = hover != null ? columns[hover] : null
  return (
    <div className="stacked">
      <div className="stacked-read" aria-live="polite">
        {hc ? (
          <>
            <span className="stacked-when">{hc.long}</span>
            {series.map((s, k) => (
              <span key={s.label} className="stacked-chip" style={{ '--c': s.color }}>
                <i />
                {s.label} <b className="num">{hc.parts[k]}{unit}</b>
              </span>
            ))}
          </>
        ) : (
          series.map((s) => (
            <span key={s.label} className="stacked-chip" style={{ '--c': s.color }}>
              <i />
              {s.label}
            </span>
          ))
        )}
      </div>
      <div ref={ref} className="stacked-cols" role="img" aria-label={ariaLabel} {...handlers(pick)}>
        {columns.map((c, i) => (
          <div key={c.key} className={`stacked-col${hc && hover !== i ? ' dim' : ''}`} style={{ '--i': i * Math.min(1, 8 / columns.length) }}>
            <div className="stacked-bar">
              {c.parts ? (
                c.parts.map((v, k) => <i key={k} style={{ flexGrow: v, background: series[k].color }} />)
              ) : (
                <i className="empty" />
              )}
            </div>
            <span className="stacked-label">{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const CAL_DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
const CAL_MONTH = new Intl.DateTimeFormat('en-GB', { month: 'short' })

/**
 * A logging calendar, GitHub-contributions style: one column per week
 * (Monday at the top), each day coloured by how it compared with the target.
 * weeks: from calendarWeeks(). levels: { level: { label, color } }.
 */
export function CalendarHeat({ weeks, levels, today, describe }) {
  const [picked, setPicked] = useState(null)
  const flat = weeks.flat()
  const cell = picked ? flat.find((c) => c.date === picked) : null
  const days = ['', 'M', '', 'W', '', 'F', '', 'S'] // the first sits beside the month names
  return (
    <div className="cal">
      <div className="cal-grid" style={{ '--weeks': weeks.length }}>
        <div className="cal-days" aria-hidden="true">
          {days.map((d, i) => <span key={i}>{d}</span>)}
        </div>
        {weeks.map((col, w) => {
          const firstOfMonth = col.find((c) => c.date.slice(8) === '01')
          const month = firstOfMonth || (w === 0 ? col[0] : null)
          return (
            <div key={col[0].date} className="cal-col" style={{ '--w': w }}>
              <span className="cal-month" aria-hidden="true">{month ? CAL_MONTH.format(parseISODate(month.date)) : ''}</span>
              {col.map((c) => (
                <button
                  key={c.date}
                  type="button"
                  disabled={c.future}
                  className={`cal-cell lv-${c.level}${c.date === today ? ' today' : ''}${picked === c.date ? ' picked' : ''}`}
                  style={{ '--c': levels[c.level]?.color }}
                  aria-label={`${CAL_DAY.format(parseISODate(c.date))}: ${levels[c.level]?.label || 'nothing logged'}${c.kcal ? `, ${c.kcal.toLocaleString('en-GB')} kcal` : ''}`}
                  onClick={() => setPicked((p) => (p === c.date ? null : c.date))}
                />
              ))}
            </div>
          )
        })}
      </div>
      <div className="cal-foot">
        {cell ? (
          <span className="cal-read">
            <b>{CAL_DAY.format(parseISODate(cell.date))}</b> · {describe(cell)}
          </span>
        ) : (
          <span className="cal-legend">
            {Object.entries(levels).map(([k, l]) => (
              <span key={k} className={`cal-key lv-${k}`} style={{ '--c': l.color }}>
                <i />
                {l.label}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  )
}

/** Tiny line with no axes, for dashboard and collapsed cards. */
export function Sparkline({ values, color = 'var(--brand)', width = 96, height = 32, className = '' }) {
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
