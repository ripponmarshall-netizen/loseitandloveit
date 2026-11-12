import { useState } from 'react'
import { useApp } from '../appContext.js'
import { MEALS, MEAL_COLOR, MEAL_LABEL } from '../lib/meals.js'
import { entryTotals, exerciseAllowance, sumEntries } from '../lib/calc.js'
import { addDays, formatDayLabel, formatLongDate } from '../lib/dates.js'
import { dailyNudge, glp1Plan } from '../lib/glp1.js'
import { useDay } from '../lib/useDay.js'
import { useWater, useWaterTarget } from './Checkin.jsx'
import { LogDock } from './QuickLog.jsx'
import { Avatar, Icon, Ring, Sheet, Spinner, Stepper } from './ui.jsx'
import { MacroSplit } from './MealBreakdown.jsx'

const fmt = (n) => Math.round(n).toLocaleString('en-GB')

export default function Today() {
  const { store, date, setDate, today, targets, bumpData, openAdd, openSheet, openProgress, toast, profile, setTab } = useApp()
  const day = useDay(date)
  const [editing, setEditing] = useState(null)
  const [copying, setCopying] = useState(false)
  const entries = day?.entries ?? null
  const workouts = day?.workouts || []
  const daily = day?.daily || null

  const totals = sumEntries(entries || [])
  const burned = workouts.reduce((s, w) => s + (Number(w.calories_burned) || 0), 0)
  const allowance = exerciseAllowance(burned, profile.exercise_eatback_pct)
  const target = (targets?.calories || 0) + allowance
  const left = target - totals.calories
  const isToday = date === today

  const plan = glp1Plan(profile)
  const waterTarget = useWaterTarget()
  const water = useWater(date, daily)
  const now = new Date()
  const nudge = isToday
    ? dailyNudge({
        onGlp1: !!plan,
        hour: now.getHours() + now.getMinutes() / 60,
        eatenKcal: totals.calories,
        proteinG: totals.protein,
        targets,
        sex: profile.sex,
        waterMl: water.ml,
        waterTarget,
        symptoms: daily?.symptoms || [],
      })
    : null

  async function copyYesterday() {
    if (copying) return
    setCopying(true)
    try {
      const prev = await store.listEntries(addDays(date, -1), addDays(date, -1))
      if (!prev.length) return toast('Nothing logged the day before.')
      const added = await store.addEntries(prev.map((e) => ({ ...e, log_date: date })))
      bumpData()
      toast(`Copied ${prev.length} item${prev.length > 1 ? 's' : ''}`, 'info', {
        label: 'Undo',
        run: async () => {
          try {
            for (const e of added || []) await store.deleteEntry(e.id)
            bumpData()
          } catch (err) {
            toast(err.message, 'error')
          }
        },
      })
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setCopying(false)
    }
  }

  return (
    <div className="dashboard">
      <header className="page-head">
        <div className="grow">
          {isToday ? (
            <div className="eyebrow">{formatLongDate(date)}</div>
          ) : (
            <button className="eyebrow eyebrow-link" onClick={() => setDate(today)}>Back to today</button>
          )}
          <h1>{formatDayLabel(date, today)}</h1>
        </div>
        <div className="day-nav">
          <button className="icon-btn" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>
            <Icon name="left" />
          </button>
          <button className="icon-btn" aria-label="Next day" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>
            <Icon name="right" />
          </button>
        </div>
        <button className="head-avatar" aria-label="Your profile and settings" onClick={() => setTab('settings')}>
          <Avatar profile={profile} size={38} />
        </button>
      </header>

      <section className="card hero-card rise" style={{ '--i': 0 }}>
        <button className="hero" onClick={() => openSheet('meal', { date, meal: 'all', onEdit: setEditing })} aria-label="Today’s nutrition breakdown">
          <Ring value={totals.calories} max={target} size={132} stroke={13}>
            <span className="big num">{fmt(Math.abs(left))}</span>
            <span className="tiny muted">{left >= 0 ? 'kcal left' : 'kcal over'}</span>
          </Ring>
          <div className="grow hero-stats">
            <div className="kv"><span className="k">Eaten</span><span className="v">{fmt(totals.calories)}</span></div>
            <div className="kv"><span className="k">Target</span><span className="v">{fmt(target)}</span></div>
            {burned > 0 && (
              <div className="kv">
                <span className="k">Exercise</span>
                <span className="v" style={{ color: 'var(--orange)' }}>{allowance > 0 ? `+${fmt(allowance)}` : fmt(burned)}</span>
              </div>
            )}
          </div>
        </button>
        <button className="macro-strip" onClick={() => openProgress('macros')} aria-label="Macros: open trends in Progress">
          <MacroMini label="Protein" value={totals.protein} target={targets?.protein || 0} color="var(--protein)" />
          <MacroMini label="Carbs" value={totals.carbs} target={targets?.carbs || 0} color="var(--carbs)" />
          <MacroMini label="Fat" value={totals.fat} target={targets?.fat || 0} color="var(--fat)" />
        </button>
      </section>

      <LogDock date={date} className="rise" style={{ '--i': 1 }} />

      {nudge && (
        <div className={`nudge ${nudge.tone}`} role={nudge.tone === 'urgent' ? 'alert' : 'status'}>
          <Icon name={nudge.tone === 'urgent' ? 'info' : 'heart'} size={18} />
          <span>{nudge.text}</span>
        </div>
      )}

      <div className="list-header big">
        Food<span className="list-header-note">{totals.calories > 0 ? `${fmt(totals.calories)} kcal` : ''}</span>
      </div>
      {entries === null ? (
        <div className="center" style={{ padding: 32, color: 'var(--text-3)' }}>
          <Spinner />
        </div>
      ) : (
        <div className="list food-list">
          {MEALS.map((meal) => {
            const list = entries.filter((e) => e.meal === meal)
            const kcal = sumEntries(list).calories
            return (
              <div key={meal} className="meal-group">
                <div className="list-row meal-row" style={{ '--c': MEAL_COLOR[meal] }}>
                  <button
                    className="meal-open"
                    onClick={() => (list.length ? openSheet('meal', { date, meal, onEdit: setEditing }) : openAdd({ meal }))}
                    aria-label={list.length ? `${MEAL_LABEL[meal]} nutrition: ${fmt(kcal)} kcal` : `Add to ${MEAL_LABEL[meal]}`}
                  >
                    <span className="dot" />
                    <span className="label headline">{MEAL_LABEL[meal]}</span>
                    {list.length > 0 && <Icon name="chart" size={16} className="meal-chart" />}
                    <span className="value num">{kcal > 0 ? fmt(kcal) : ''}</span>
                  </button>
                  <button className="meal-add" onClick={() => openAdd({ meal })} aria-label={`Add to ${MEAL_LABEL[meal]}`}>
                    <Icon name="plus" strokeWidth={2.8} />
                  </button>
                </div>
                {list.map((e) => (
                  <button key={e.id} className="list-row entry-row" onClick={() => setEditing(e)}>
                    <span className="label">
                      <span className="ellipsis" style={{ display: 'block' }}>{e.name}</span>
                      <span className="sub ellipsis">
                        {Number(e.servings) !== 1 && `${Number(e.servings)} × `}
                        {e.serving || (e.source === 'quick' ? 'Quick add' : '1 serving')}
                        {e.source === 'ai' && (
                          <>
                            {' '}
                            <span className="badge ai">AI</span>
                          </>
                        )}
                      </span>
                    </span>
                    <span className="entry-kcal">{fmt(entryTotals(e).calories)}</span>
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {day?.checkinError && <p className="list-footer danger-text">{day.checkinError}</p>}

      {entries && entries.length === 0 && (
        <p className="center" style={{ marginTop: 24 }}>
          <button className="btn sm gray" disabled={copying} onClick={copyYesterday}>Copy the day before</button>
        </p>
      )}

      {editing && <EditEntry entry={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

/** One macro as a slim bar with grams eaten and the target. */
function MacroMini({ label, value, target, color }) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0
  return (
    <span className="macro-mini" style={{ '--c': color }}>
      <span className="macro-mini-label">{label}</span>
      <span className="macro-mini-val num">
        {Math.round(value)}
        <span className="muted"> / {target} g</span>
      </span>
      <span className="macro-mini-bar" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </span>
    </span>
  )
}

function EditEntry({ entry, onClose }) {
  const { store, bumpData, toast } = useApp()
  const [e, setE] = useState({
    name: entry.name,
    meal: entry.meal,
    servings: Number(entry.servings),
    calories: String(Number(entry.calories)),
    protein_g: String(Number(entry.protein_g)),
    carbs_g: String(Number(entry.carbs_g)),
    fat_g: String(Number(entry.fat_g)),
  })
  const [busy, setBusy] = useState(false)
  const set = (k) => (ev) => setE((s) => ({ ...s, [k]: ev.target.value }))
  const totals = entryTotals(e)

  async function run(fn, msg, action) {
    setBusy(true)
    try {
      await fn()
      bumpData()
      toast(msg, 'info', action)
      onClose()
    } catch (err) {
      toast(err.message, 'error')
      setBusy(false)
    }
  }

  // Deleting is one tap, so it can be undone: re-add the same entry.
  const undoDelete = {
    label: 'Undo',
    run: async () => {
      try {
        await store.addEntries([entry])
        bumpData()
      } catch (err) {
        toast(err.message, 'error')
      }
    },
  }

  const patch = () => ({
    name: e.name.trim() || entry.name,
    meal: e.meal,
    servings: Number(e.servings) || 1,
    calories: Number(e.calories) || 0,
    protein_g: Number(e.protein_g) || 0,
    carbs_g: Number(e.carbs_g) || 0,
    fat_g: Number(e.fat_g) || 0,
  })

  return (
    <Sheet title="Edit entry" onClose={onClose}>
      <label className="field">
        <span>Name</span>
        <input className="input" value={e.name} onChange={set('name')} />
      </label>
      <div className="row between" style={{ marginBottom: 16 }}>
        <div>
          <div className="tiny muted" style={{ marginBottom: 6 }}>Servings{entry.serving ? ` · ${entry.serving}` : ''}</div>
          <Stepper value={e.servings} onChange={(v) => setE((s) => ({ ...s, servings: v }))} />
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="tiny muted">Total</div>
          <strong className="num" style={{ fontSize: 28, letterSpacing: '-0.02em' }}>{fmt(totals.calories)}</strong>
          <span className="muted"> kcal</span>
        </div>
      </div>
      {totals.calories > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <MacroSplit entries={[{ ...e, id: entry.id }]} size={124} />
        </div>
      )}
      <div className="tiny muted" style={{ margin: '0 4px 6px' }}>Per serving</div>
      <div className="grid4">
        <label className="field"><span>kcal</span><input className="input" inputMode="decimal" value={e.calories} onChange={set('calories')} /></label>
        <label className="field"><span>Protein</span><input className="input" inputMode="decimal" value={e.protein_g} onChange={set('protein_g')} /></label>
        <label className="field"><span>Carbs</span><input className="input" inputMode="decimal" value={e.carbs_g} onChange={set('carbs_g')} /></label>
        <label className="field"><span>Fat</span><input className="input" inputMode="decimal" value={e.fat_g} onChange={set('fat_g')} /></label>
      </div>
      <label className="field">
        <span>Meal</span>
        <select className="input" value={e.meal} onChange={set('meal')}>
          {MEALS.map((m) => (
            <option key={m} value={m}>{MEAL_LABEL[m]}</option>
          ))}
        </select>
      </label>
      <div className="stack">
        <button className="btn block" disabled={busy} onClick={() => run(() => store.updateEntry(entry.id, patch()), 'Updated')}>Save</button>
        <button className="btn secondary block" disabled={busy} onClick={() => run(() => store.saveFood({ ...patch(), serving: entry.serving }), 'Saved to My foods')}>
          Save to My foods
        </button>
        <button className="btn destructive block" disabled={busy} onClick={() => run(() => store.deleteEntry(entry.id), `Deleted ${entry.name}`, undoDelete)}>Delete</button>
      </div>
    </Sheet>
  )
}
