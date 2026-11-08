import { useState } from 'react'
import { useApp } from '../appContext.js'
import { macroBreakdown } from '../lib/calc.js'
import { formatDayLabel } from '../lib/dates.js'
import { MEALS, MEAL_COLOR, MEAL_LABEL } from '../lib/meals.js'
import { useDay } from '../lib/useDay.js'
import { Icon, MacroBar, Sheet, Spinner } from './ui.jsx'

const fmt = (n) => Math.round(n).toLocaleString('en-GB')
const MACROS = [
  { key: 'protein', label: 'Protein', color: 'var(--protein)', perG: 4 },
  { key: 'carbs', label: 'Carbs', color: 'var(--carbs)', perG: 4 },
  { key: 'fat', label: 'Fat', color: 'var(--fat)', perG: 9 },
]

/**
 * Donut of where the calories come from. Tap a segment (or its legend row)
 * to read it in the middle; tap again to go back to the total.
 * parts: [{ key, label, value, color }]
 */
export function MacroDonut({ parts, size = 150, stroke = 22, center, active, onActive }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const total = parts.reduce((s, p) => s + p.value, 0)
  const shown = parts.filter((p) => p.value > 0)
  const gap = shown.length > 1 ? 2.5 : 0 // a thin surface gap between segments
  let offset = 0
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Calories by macronutrient">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fill)" strokeWidth={stroke} />
        {total > 0 &&
          shown.map((p) => {
            const len = (p.value / total) * c
            const seg = (
              <circle
                key={p.key}
                className="donut-seg"
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={p.color}
                strokeWidth={active === p.key ? stroke + 6 : stroke}
                strokeDasharray={`${Math.max(0.5, len - gap)} ${c}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                opacity={active && active !== p.key ? 0.35 : 1}
                onClick={() => onActive?.(active === p.key ? null : p.key)}
              >
                <title>{`${p.label}: ${p.text || Math.round(p.value)}`}</title>
              </circle>
            )
            offset += len
            return seg
          })}
      </svg>
      <div className="donut-center">{center}</div>
    </div>
  )
}

/** Donut + legend for a set of entries: the core of the breakdown sheet. */
export function MacroSplit({ entries, size = 150 }) {
  const { targets } = useApp()
  const [active, setActive] = useState(null)
  const b = macroBreakdown(entries, targets)
  const parts = MACROS.map((m) => ({
    ...m,
    value: b.kcalFrom[m.key],
    text: `${fmt(b.totals[m.key])} g · ${b.split[m.key]}%`,
  }))
  const a = MACROS.find((m) => m.key === active)
  return (
    <div className="macro-split">
      <MacroDonut
        parts={parts}
        size={size}
        active={active}
        onActive={setActive}
        center={
          a ? (
            <>
              <span className="donut-big num">{b.split[a.key]}%</span>
              <span className="caption muted">{a.label.toLowerCase()} · {fmt(b.kcalFrom[a.key])} kcal</span>
            </>
          ) : (
            <>
              <span className="donut-big num">{fmt(b.totals.calories)}</span>
              <span className="caption muted">kcal</span>
            </>
          )
        }
      />
      <div className="macro-legend grow">
        {MACROS.map((m) => (
          <button
            key={m.key}
            type="button"
            className={`legend-row${active && active !== m.key ? ' dim' : ''}`}
            onClick={() => setActive(active === m.key ? null : m.key)}
            aria-pressed={active === m.key}
          >
            <span className="legend-key" style={{ background: m.color }} aria-hidden="true" />
            <span className="grow">
              <span className="legend-label">{m.label}</span>
              <span className="caption muted">{fmt(b.kcalFrom[m.key])} kcal</span>
            </span>
            <span className="legend-value num">
              {fmt(b.totals[m.key])} g
              <span className="caption muted">{b.split[m.key]}%</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Nutrition for one logged meal (or meal = 'all' for the whole day):
 * calories, macro split chart, share of the day's targets and each food.
 */
export function MealBreakdownSheet({ date, meal = 'all', onClose, onEdit }) {
  const { today, targets, openAdd } = useApp()
  const day = useDay(date)
  const [which, setWhich] = useState(meal)
  const all = day?.entries ?? null
  const entries = all ? (which === 'all' ? all : all.filter((e) => e.meal === which)) : null
  const b = entries ? macroBreakdown(entries, targets) : null
  const dayLabel = formatDayLabel(date, today)
  const title = `${which === 'all' ? 'Day' : MEAL_LABEL[which]} nutrition${dayLabel === 'Today' ? '' : ` · ${dayLabel}`}`
  const maxKcal = b?.items[0]?.calories || 1
  const mealsWithFood = MEALS.filter((m) => all?.some((e) => e.meal === m))

  return (
    <Sheet title={title} onClose={onClose}>
      {mealsWithFood.length > 0 && (
        <div className="chips" style={{ marginBottom: 14 }}>
          {[['all', 'Whole day'], ...mealsWithFood.map((m) => [m, MEAL_LABEL[m]])].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`chip${which === id ? ' tinted' : ''}`}
              style={{ '--c': id === 'all' ? 'var(--tint)' : MEAL_COLOR[id] }}
              aria-pressed={which === id}
              onClick={() => setWhich(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {!b ? (
        <div className="center" style={{ padding: 32 }}>
          <Spinner />
        </div>
      ) : entries.length === 0 ? (
        <div className="card center">
          <p className="muted small">Nothing logged for {which === 'all' ? 'this day' : MEAL_LABEL[which].toLowerCase()} yet.</p>
          <button
            className="btn secondary sm"
            onClick={() => {
              onClose()
              openAdd({ meal: which === 'all' ? undefined : which })
            }}
          >
            <Icon name="plus" size={16} /> Add food
          </button>
        </div>
      ) : (
        <>
          <section className="card">
            <MacroSplit entries={entries} />
            <p className="caption muted" style={{ margin: '10px 0 0' }}>
              Where the calories come from: protein and carbs 4 kcal per gram, fat 9. Tap a colour for details.
            </p>
          </section>

          {targets && (
            <>
              <div className="list-header">
                Share of your day{b.ofDay.calories != null ? ` · ${b.ofDay.calories}% of ${fmt(targets.calories)} kcal` : ''}
              </div>
              <div className="card">
                <div className="grid3">
                  {MACROS.map((m) => (
                    <MacroBar key={m.key} label={`${m.label} · ${b.ofDay[m.key] ?? 0}%`} value={b.totals[m.key]} target={targets[m.key] || 0} color={m.color} />
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="list-header">By food</div>
          <div className="list">
            {b.items.map((it) => {
              const e = entries.find((x) => x.id === it.id)
              return (
                <button key={it.id} className="list-row food-bar-row" onClick={() => e && onEdit?.(e)}>
                  <span className="label">
                    <span className="row between" style={{ gap: 8 }}>
                      <span className="ellipsis">{it.name}</span>
                      <span className="entry-kcal">{fmt(it.calories)}</span>
                    </span>
                    <span className="food-bar" aria-hidden="true">
                      <i style={{ width: `${Math.max(2, (it.calories / maxKcal) * 100)}%` }} />
                    </span>
                    <span className="sub num">
                      {it.share}% · P {fmt(it.protein)} g · C {fmt(it.carbs)} g · F {fmt(it.fat)} g
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
          <p className="list-footer">Tap a food to change or delete it. Values are estimates.</p>
        </>
      )}
    </Sheet>
  )
}
