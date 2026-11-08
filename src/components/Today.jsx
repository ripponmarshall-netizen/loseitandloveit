import { useState } from 'react'
import { useApp } from '../appContext.js'
import { MEALS, MEAL_COLOR, MEAL_LABEL } from '../lib/meals.js'
import { displayWeight, entryTotals, exerciseAllowance, sumEntries } from '../lib/calc.js'
import { addDays, formatDayLabel, formatLongDate } from '../lib/dates.js'
import { MOOD_BY_V } from '../data/glp1.js'
import { GLASS_ML, dailyNudge, doseStatus, doseStatusLabel, formatDose, formatWater, glp1Plan } from '../lib/glp1.js'
import { useDay } from '../lib/useDay.js'
import { useWater, useWaterTarget } from './Checkin.jsx'
import { Avatar, Icon, MacroBar, PenguinFace, Ring, Sheet, Spinner, Stepper } from './ui.jsx'
import { ExerciseCard } from './Workouts.jsx'
import { MacroSplit } from './MealBreakdown.jsx'
import MimiCheckin from './MimiCheckin.jsx'

const fmt = (n) => Math.round(n).toLocaleString('en-GB')

export default function Today() {
  const { store, date, setDate, today, targets, weights, series, units, bumpData, openAdd, openSheet, toast, profile, setTab } = useApp()
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
  const dose = plan ? doseStatus({ doses: day?.doses || [], frequency: plan.frequency, today: date }) : null
  const waterTarget = useWaterTarget()
  const water = useWater(date, daily)
  const mood = MOOD_BY_V[daily?.mood]
  const weighIn = weights.find((w) => w.log_date === date)
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
      await store.addEntries(prev.map((e) => ({ ...e, log_date: date })))
      bumpData()
      toast(`Copied ${prev.length} item${prev.length > 1 ? 's' : ''}`)
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setCopying(false)
    }
  }

  return (
    <div>
      <header className="page-head">
        <div className="grow">
          <div className="eyebrow">{formatLongDate(date)}</div>
          <h1>{formatDayLabel(date, today)}</h1>
        </div>
        <div className="day-nav">
          <button className="head-avatar" aria-label="Your profile and settings" onClick={() => setTab('settings')}>
            <Avatar profile={profile} size={34} />
          </button>
          <button className="icon-btn" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>
            <Icon name="left" />
          </button>
          {!isToday && (
            <button className="btn sm secondary" onClick={() => setDate(today)}>Today</button>
          )}
          <button className="icon-btn" aria-label="Next day" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>
            <Icon name="right" />
          </button>
        </div>
      </header>

      <section className="card summary-card">
        <div className="summary">
          <Ring value={totals.calories} max={target}>
            <span className="big num">{fmt(Math.abs(left))}</span>
            <span className="tiny muted">{left >= 0 ? 'kcal left' : 'kcal over'}</span>
          </Ring>
          <div className="grow">
            <div className="kv"><span className="k">Eaten</span><span className="v">{fmt(totals.calories)}</span></div>
            <div className="kv"><span className="k">Target</span><span className="v">{fmt(target)}</span></div>
            {burned > 0 && (
              <div className="kv">
                <span className="k">Exercise</span>
                <span className="v" style={{ color: 'var(--red)' }}>{allowance > 0 ? `+${fmt(allowance)}` : fmt(burned)}</span>
              </div>
            )}
          </div>
        </div>
        <button className="grid3 macros macros-btn" onClick={() => openSheet('meal', { date, meal: 'all', onEdit: setEditing })} aria-label="Today’s nutrition breakdown">
          <MacroBar label="Protein" value={totals.protein} target={targets?.protein || 0} color="var(--protein)" />
          <MacroBar label="Carbs" value={totals.carbs} target={targets?.carbs || 0} color="var(--carbs)" />
          <MacroBar label="Fat" value={totals.fat} target={targets?.fat || 0} color="var(--fat)" />
        </button>
      </section>

      <div className="tiles">
        <Tile
          icon="drop"
          color="var(--cyan)"
          value={formatWater(water.ml)}
          sub={`of ${formatWater(waterTarget)}`}
          pct={water.ml / waterTarget}
          label="Water"
          onClick={() => openSheet('water', { date, daily })}
          onPlus={() => water.add(GLASS_ML)}
          plusLabel="Add a glass of water"
        />
        <Tile
          icon={mood ? null : 'smile'}
          emoji={mood?.emoji}
          color={mood?.color || 'var(--yellow)'}
          value={mood ? mood.label : 'Check in'}
          sub={daily?.symptoms?.length ? `${daily.symptoms.length} symptom${daily.symptoms.length > 1 ? 's' : ''}` : 'Mood'}
          label="Mood"
          onClick={() => openSheet('mood', { date, daily })}
        />
        {plan ? (
          <Tile
            icon={plan.route === 'oral' ? 'pill' : 'syringe'}
            color="var(--purple)"
            value={doseStatusLabel(dose)}
            sub={`${plan.name} ${formatDose(plan.dose, plan.unit)}`}
            label="GLP-1"
            alert={dose.state === 'due' || dose.state === 'overdue'}
            done={dose.state === 'taken'}
            onClick={() => openSheet('dose', { date })}
          />
        ) : (
          <Tile
            icon="scale"
            color="var(--indigo)"
            value={weighIn ? displayWeight(Number(weighIn.weight_kg), units) : 'Weigh in'}
            sub={series.length ? `Trend ${displayWeight(series[series.length - 1].trend, units)}` : 'Morning is best'}
            label="Weight"
            done={!!weighIn}
            onClick={() => openSheet('weight')}
          />
        )}
      </div>

      {isToday && <MimiCheckin />}

      {nudge && (
        <div className={`nudge ${nudge.tone}`} role={nudge.tone === 'urgent' ? 'alert' : 'status'}>
          <Icon name={nudge.tone === 'urgent' ? 'info' : 'heart'} size={18} />
          <span>{nudge.text}</span>
        </div>
      )}

      <AskCoach />

      <div className="list-header">
        Food{totals.calories > 0 ? ` · ${fmt(totals.calories)} kcal` : ''}
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

      <ExerciseCard
        workouts={workouts}
        error={day?.workoutError}
        allowance={allowance}
        onAdd={() => openSheet('workout', { date })}
        onEdit={(w) => openSheet('workout', { date, workout: w })}
      />

      {day?.checkinError && <p className="list-footer danger-text">{day.checkinError}</p>}

      {entries && entries.length === 0 && (
        <p className="center" style={{ marginTop: 22 }}>
          <button className="btn sm gray" disabled={copying} onClick={copyYesterday}>Copy the day before</button>
        </p>
      )}

      {editing && <EditEntry entry={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

/** One of the three "essentials" on Today. The + adds without opening anything. */
function Tile({ icon, emoji, color, value, sub, label, pct, onClick, onPlus, plusLabel, alert, done }) {
  return (
    <div className={`tile${alert ? ' alert' : ''}${done ? ' done' : ''}`} style={{ '--c': color }}>
      <button className="tile-main" onClick={onClick} aria-label={`${label}: ${value}, ${sub}`}>
        <span className="tile-icon" aria-hidden="true">
          {emoji ? <span className="tile-emoji">{emoji}</span> : <Icon name={icon} strokeWidth={2.2} />}
        </span>
        <span className="tile-value">{value}</span>
        <span className="tile-sub ellipsis">{sub}</span>
        {pct != null && (
          <span className="tile-bar" aria-hidden="true">
            <i style={{ width: `${Math.min(100, Math.round(pct * 100))}%` }} />
          </span>
        )}
      </button>
      {onPlus && (
        <button className="tile-plus" aria-label={plusLabel} onClick={onPlus}>
          <Icon name="plus" strokeWidth={3} />
        </button>
      )}
    </div>
  )
}

/** "Ask Mimi anything": one tap from Today to an answer. */
function AskCoach() {
  const { askCoach, profile } = useApp()
  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  const ideas = glp1Plan(profile)
    ? ['What should I eat on dose day?', 'Help with nausea', 'Am I getting enough protein?']
    : ['What should I eat tonight?', 'Review my week', 'High-protein Jamaican breakfast']
  const send = (text) => {
    askCoach(text)
    setQ('')
  }
  return (
    <div className="ask-wrap">
      <form
        className="ask-bar"
        onSubmit={(e) => {
          e.preventDefault()
          send(q)
        }}
      >
        <button type="button" className="ask-face" aria-label="Open Mimi" onClick={() => send('')}>
          <PenguinFace size={36} />
        </button>
        <input
          className="ask-input"
          placeholder="Ask Mimi anything…"
          value={q}
          enterKeyHint="send"
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          aria-label="Ask Mimi"
        />
        <button className="send-btn" disabled={!q.trim()} aria-label="Ask">
          <Icon name="up" strokeWidth={2.6} />
        </button>
      </form>
      {focused && !q && (
        <div className="chips" style={{ marginTop: 10 }}>
          {ideas.map((t) => (
            <button key={t} type="button" className="chip tinted" style={{ '--c': 'var(--indigo)' }} onMouseDown={(e) => e.preventDefault()} onClick={() => send(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
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

  async function run(fn, msg) {
    setBusy(true)
    try {
      await fn()
      bumpData()
      toast(msg)
      onClose()
    } catch (err) {
      toast(err.message, 'error')
      setBusy(false)
    }
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
        <button className="btn destructive block" disabled={busy} onClick={() => run(() => store.deleteEntry(entry.id), 'Deleted')}>Delete</button>
      </div>
    </Sheet>
  )
}
