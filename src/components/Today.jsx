import { useRef, useState } from 'react'
import { useApp } from '../appContext.js'
import { MEALS, MEAL_COLOR, MEAL_LABEL } from '../lib/meals.js'
import { entryTotals, exerciseAllowance, kcalLooksWrong, ringsClosed, sumEntries, validServings } from '../lib/calc.js'
import { addDays, formatDayLabel, formatLongDate } from '../lib/dates.js'
import { dailyNudge, glp1Plan } from '../lib/glp1.js'
import { useDay } from '../lib/useDay.js'
import { useWater, useWaterTarget } from './Checkin.jsx'
import { LogDock } from './QuickLog.jsx'
import { Avatar, CountUp, Icon, PageHeader, PenguinFace, SectionTitle, Sheet, Stepper, useSheetClose } from './ui.jsx'
import { foodEmoji } from '../lib/foodEmoji.js'
import { RingStack, WeekBalance, WeekRecapCard, WinsCard, useRecentLog, useRingCheer } from './Motivation.jsx'
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

  const recent = useRecentLog()
  const proteinTarget = targets?.protein || 0
  const closed = ringsClosed({ kcal: totals.calories, kcalTarget: target, protein: totals.protein, proteinTarget, waterMl: water.ml, waterTarget })
  const allClosed = closed.calories && closed.protein && closed.water
  const cheer = useRingCheer({ date, active: isToday, ready: entries !== null && day?.daily !== undefined, closed })
  const over = left < 0
  // One ring, calories only, in one colour (orange once over). Protein, carbs,
  // fat and water are bars underneath, each in its own colour.
  const kcalColor = over ? 'var(--over)' : 'var(--ring-a)'
  const kcalRing = [{ key: 'calories', value: totals.calories, max: target, a: kcalColor, b: kcalColor }]
  const kcalPct = target > 0 ? Math.round((totals.calories / target) * 100) : 0
  const openMacros = () => openProgress('macros')
  const emptyMeals = entries ? MEALS.filter((m) => !entries.some((e) => e.meal === m)) : []

  // Stepping between days slides the day in from the side you moved towards.
  const shownDate = useRef(date)
  const dayDir = useRef(null)
  if (shownDate.current !== date) {
    dayDir.current = date > shownDate.current ? 'fwd' : 'back'
    shownDate.current = date
  }

  return (
    <div className="dashboard">
      <PageHeader
        title={formatDayLabel(date, today)}
        eyebrow={isToday ? formatLongDate(date) : <button className="eyebrow eyebrow-link" onClick={() => setDate(today)}>Back to today</button>}
      >
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
      </PageHeader>

      <div key={date} className="day-swap" data-dir={dayDir.current || undefined}>
      {isToday && <WinsCard recent={recent} />}

      <section className={`card hero-card rise${allClosed && isToday ? ' all-closed' : ''}`} style={{ '--i': 1 }}>
        <button className="hero" onClick={() => openSheet('meal', { date, meal: 'all', onEdit: setEditing })} aria-label={`${fmt(Math.abs(left))} kcal ${over ? 'over' : 'left'}: ${fmt(totals.calories)} eaten of ${fmt(target)}. Open the day’s nutrition breakdown`}>
          <RingStack rings={kcalRing} size={128} stroke={14} cheer={cheer}>
            {closed.calories ? (
              <span className="ring-done"><Icon name="check" size={20} strokeWidth={3.2} /></span>
            ) : (
              <>
                <span className="ring-pct num">{kcalPct}%</span>
                <span className="ring-pct-label">eaten</span>
              </>
            )}
          </RingStack>
          <div className="grow hero-stats">
            <div className="hero-left">
              <span className="hero-big num"><CountUp value={Math.abs(left)} /></span>
              <span className={`hero-unit${over ? ' over' : ''}`}>{over ? 'kcal over' : 'kcal left'}</span>
            </div>
            <span className="kcal-row"><span className="k">Eaten</span><span className="v num">{fmt(totals.calories)}</span></span>
            <span className="kcal-row"><span className="k">Goal</span><span className="v num">{fmt(target)}</span></span>
            {burned > 0 && (
              <span className="hero-burn num">
                <Icon name="flame" size={14} /> {allowance > 0 ? `+${fmt(allowance)} from exercise` : `${fmt(burned)} burned`}
              </span>
            )}
          </div>
        </button>
        {allClosed && isToday && (
          <div className="hero-cheer">
            <PenguinFace size={26} />
            <span>Calories, protein and water all on target today. Mimi’s proud of you.</span>
          </div>
        )}
        <div className="goal-bars">
          <GoalRow label="Protein" value={Math.round(totals.protein)} target={proteinTarget} unit="g" color="var(--protein)" done={closed.protein} cheer={cheer.includes('protein')} onClick={openMacros} />
          <GoalRow label="Carbs" value={Math.round(totals.carbs)} target={targets?.carbs || 0} unit="g" color="var(--carbs)" limit onClick={openMacros} />
          <GoalRow label="Fat" value={Math.round(totals.fat)} target={targets?.fat || 0} unit="g" color="var(--fat)" limit onClick={openMacros} />
          <GoalRow
            label="Water"
            value={formatLitres(water.ml)}
            frac={waterTarget > 0 ? water.ml / waterTarget : 0}
            target={formatLitres(waterTarget)}
            unit="L"
            color="var(--water)"
            done={closed.water}
            cheer={cheer.includes('water')}
            split
            onClick={() => openSheet('water', { date, daily })}
          />
        </div>
        <WeekBalance recent={recent} date={date} />
      </section>

      <LogDock date={date} className="rise" style={{ '--i': 2 }} />

      {nudge && (
        <div className={`nudge ${nudge.tone}`} role={nudge.tone === 'urgent' ? 'alert' : 'status'}>
          <Icon name={nudge.tone === 'urgent' ? 'info' : 'heart'} size={18} />
          <span>{nudge.text}</span>
        </div>
      )}

      {isToday && <WeekRecapCard recent={recent} />}

      <SectionTitle title="Food" note={totals.calories > 0 ? `${fmt(totals.calories)} kcal` : null} />
      {entries === null ? (
        <div className="list food-list skeleton-list" aria-label="Loading food">
          {[0, 1, 2].map((i) => (
            <div key={i} className="list-row skeleton-row" style={{ '--i': i }}>
              <span className="skeleton sk-icon" />
              <span className="grow">
                <span className="skeleton sk-line" />
                <span className="skeleton sk-line short" />
              </span>
            </div>
          ))}
        </div>
      ) : (
        <>
          {entries.length > 0 && (
            <div className="list food-list">
              {MEALS.filter((meal) => !emptyMeals.includes(meal)).map((meal) => {
                const list = entries.filter((e) => e.meal === meal)
                const kcal = sumEntries(list).calories
                return (
                  <div key={meal} className="meal-group">
                    <div className="list-row meal-row" style={{ '--c': MEAL_COLOR[meal] }}>
                      <button
                        className="meal-open"
                        onClick={() => openSheet('meal', { date, meal, onEdit: setEditing })}
                        aria-label={`${MEAL_LABEL[meal]} nutrition: ${fmt(kcal)} kcal`}
                      >
                        <span className="dot" />
                        <span className="label headline">{MEAL_LABEL[meal]}</span>
                        <Icon name="chart" size={16} className="meal-chart" />
                        <span className="value num">{kcal > 0 ? fmt(kcal) : ''}</span>
                      </button>
                      <button className="meal-add" onClick={() => openAdd({ meal })} aria-label={`Add to ${MEAL_LABEL[meal]}`}>
                        <Icon name="plus" strokeWidth={2.8} />
                      </button>
                    </div>
                    {list.map((e) => (
                      <button key={e.id} className="list-row entry-row" onClick={() => setEditing(e)}>
                        <span className="entry-emoji" aria-hidden="true">{foodEmoji(e.name, e.meal)}</span>
                        <span className="label">
                          <span className="ellipsis d-block">{e.name}</span>
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
          {emptyMeals.length > 0 && (
            <div className={`meal-chips${entries.length ? '' : ' alone'}`}>
              <span className="meal-chips-label">{entries.length ? 'Add' : 'Nothing logged yet. Add'}</span>
              {emptyMeals.map((meal) => (
                <button key={meal} type="button" className="meal-chip" style={{ '--c': MEAL_COLOR[meal] }} onClick={() => openAdd({ meal })}>
                  <Icon name="plus" size={14} strokeWidth={2.8} />
                  {MEAL_LABEL[meal]}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {day?.checkinError && <p className="list-footer danger-text">{day.checkinError}</p>}

      {entries && entries.length === 0 && (
        <div className="copy-day">
          <button className="btn sm gray" disabled={copying} onClick={copyYesterday}>Copy the day before</button>
        </div>
      )}
      </div>

      {editing && <EditEntry entry={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

const formatLitres = (ml) => {
  const l = (Number(ml) || 0) / 1000
  return l >= 10 ? l.toFixed(0) : l.toFixed(1)
}

/**
 * One daily goal as a bar: name, how far along, amount / goal. The last slot
 * says how it's going: a tick once a goal is hit (protein, water), an arrow
 * once a limit is passed (carbs, fat: `limit`), where a full bar alone would
 * look like success. `frac` overrides value / target when the shown numbers
 * are rounded (litres).
 */
function GoalRow({ label, value, target, unit, color, frac, done = false, limit = false, cheer = false, split = false, onClick }) {
  const f = frac ?? (Number(target) > 0 ? value / target : 0)
  const pct = Math.min(100, Math.max(0, Math.round(f * 100)))
  const over = limit && f > 1
  const state = done ? ', goal hit' : over ? ', over the goal' : ''
  const aria = `${label}: ${value} of ${target} ${unit}${state}. ${label === 'Water' ? 'Log water' : 'Open macro trends in Progress'}`
  return (
    <button type="button" className={`goal-row${done ? ' done' : ''}${over ? ' over' : ''}${cheer ? ' cheer' : ''}${split ? ' split' : ''}`} style={{ '--c': color }} onClick={onClick} aria-label={aria}>
      <span className="goal-label">{label}</span>
      <span className="goal-bar" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="goal-val num">
        {value}
        <span className="muted">
          <span className="goal-of"> / {target}</span> {unit}
        </span>
      </span>
      <span className="goal-tick" aria-hidden="true">
        {done && <Icon name="check" size={10} strokeWidth={3.4} />}
        {over && <Icon name="up" size={10} strokeWidth={3.4} />}
      </span>
    </button>
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
  const [sheetRef, dismiss] = useSheetClose(onClose)
  const set = (k) => (ev) => setE((s) => ({ ...s, [k]: ev.target.value }))
  // While the servings field is empty or 0 the total reads 0, but the breakdown
  // stays put: if it vanished, tapping Save (which tidies the field on blur)
  // would bring it back and push the button out from under the finger.
  const servings = validServings(e.servings)
  const totals = entryTotals({ ...e, servings: servings ?? 0 })
  const perServing = entryTotals({ ...e, servings: 1 })

  async function run(fn, msg, action) {
    setBusy(true)
    try {
      await fn()
      bumpData()
      toast(msg, 'info', action)
      dismiss()
    } catch (err) {
      toast(err.message, 'error')
      setBusy(false)
    }
  }

  // Deleting is one tap, so it can be undone: the entry comes back in its old place.
  const undoDelete = {
    label: 'Undo',
    run: async () => {
      try {
        await store.restoreEntries([entry])
        bumpData()
      } catch (err) {
        toast(err.message, 'error')
      }
    },
  }

  const patch = () => ({
    name: e.name.trim() || entry.name,
    meal: e.meal,
    servings: servings ?? 1,
    calories: Number(e.calories) || 0,
    protein_g: Number(e.protein_g) || 0,
    carbs_g: Number(e.carbs_g) || 0,
    fat_g: Number(e.fat_g) || 0,
  })

  return (
    <Sheet ref={sheetRef} title="Edit entry" onClose={onClose}>
      <label className="field">
        <span>Name</span>
        <input className="input" value={e.name} onChange={set('name')} />
      </label>
      <div className="amount-row mt-0">
        <div>
          <span className="field-label">Servings{entry.serving ? ` · ${entry.serving}` : ''}</span>
          <Stepper value={e.servings} onChange={(v) => setE((s) => ({ ...s, servings: v }))} />
        </div>
        <div className="amount-total">
          <span className="field-label">Total</span>
          <span className="figure"><CountUp value={totals.calories} from={totals.calories} /></span>
          <span className="figure-unit"> kcal</span>
        </div>
      </div>
      {perServing.calories > 0 && (
        <div className="card">
          <MacroSplit entries={[{ ...e, servings: servings ?? 1, id: entry.id }]} size={124} />
        </div>
      )}
      <span className="field-label">Per serving</span>
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
      <div className="btn-col">
        <button
          className="btn block"
          disabled={busy}
          onClick={() => {
            const p = patch()
            if (kcalLooksWrong(p) && !window.confirm(`${fmt(entryTotals(p).calories)} kcal for this entry. Is that right?`)) return
            run(() => store.updateEntry(entry.id, p), 'Updated')
          }}
        >
          Save
        </button>
        <button className="btn secondary block" disabled={busy} onClick={() => run(() => store.saveFood({ ...patch(), serving: entry.serving }), 'Saved to My foods')}>
          Save to My foods
        </button>
        <button className="btn destructive block" disabled={busy} onClick={() => run(() => store.deleteEntry(entry.id), `Deleted ${entry.name}`, undoDelete)}>Delete</button>
      </div>
    </Sheet>
  )
}
