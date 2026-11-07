import { useEffect, useState } from 'react'
import { useApp } from '../appContext.js'
import { MEALS, MEAL_LABEL } from '../lib/meals.js'
import { entryTotals, inputToKg, sumEntries, weightUnit } from '../lib/calc.js'
import { addDays, formatDayLabel } from '../lib/dates.js'
import { MacroBar, Ring, Sheet, Spinner, Stepper } from './ui.jsx'


export default function Today() {
  const { store, date, setDate, today, targets, weights, dataVersion, bumpData, openAdd, toast, profile } = useApp()
  const [entries, setEntries] = useState(null)
  const [editing, setEditing] = useState(null)

  useEffect(() => {
    let cancelled = false
    setEntries(null)
    store
      .listEntries(date, date)
      .then((rows) => !cancelled && setEntries(rows))
      .catch((e) => {
        if (!cancelled) {
          toast(e.message, 'error')
          setEntries([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [store, date, dataVersion, toast])

  const totals = sumEntries(entries || [])
  const target = targets?.calories || 0
  const left = target - totals.calories
  const weighedToday = weights.some((w) => w.log_date === date)

  async function copyYesterday() {
    try {
      const prev = await store.listEntries(addDays(date, -1), addDays(date, -1))
      if (!prev.length) return toast('Nothing logged the day before.')
      await store.addEntries(prev.map((e) => ({ ...e, log_date: date, source: e.source })))
      bumpData()
      toast(`Copied ${prev.length} item${prev.length > 1 ? 's' : ''}`)
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  return (
    <div>
      <div className="daynav">
        <button className="icon-btn" aria-label="Previous day" onClick={() => setDate(addDays(date, -1))}>‹</button>
        <button className="link label" onClick={() => setDate(today)} style={{ color: 'var(--text)' }}>
          {formatDayLabel(date, today)}
        </button>
        <button className="icon-btn" aria-label="Next day" disabled={date >= today} style={{ opacity: date >= today ? 0.3 : 1 }} onClick={() => setDate(addDays(date, 1))}>
          ›
        </button>
      </div>

      <section className="card">
        <div className="summary">
          <Ring value={totals.calories} max={target}>
            <span className="big num">{Math.abs(left).toLocaleString('en-GB')}</span>
            <span className="small muted">{left >= 0 ? 'kcal left' : 'kcal over'}</span>
          </Ring>
          <div className="grow">
            <div className="row between small">
              <span className="muted">Eaten</span>
              <strong className="num">{totals.calories.toLocaleString('en-GB')}</strong>
            </div>
            <div className="row between small" style={{ marginBottom: 10 }}>
              <span className="muted">Target</span>
              <strong className="num">{target.toLocaleString('en-GB')}</strong>
            </div>
            <MacroBar label="Protein" value={totals.protein} target={targets?.protein || 0} color="var(--protein)" />
            <MacroBar label="Carbs" value={totals.carbs} target={targets?.carbs || 0} color="var(--carbs)" />
            <MacroBar label="Fat" value={totals.fat} target={targets?.fat || 0} color="var(--fat)" />
          </div>
        </div>
      </section>

      {date === today && !weighedToday && <QuickWeight units={profile.units} />}

      {entries === null ? (
        <div className="center" style={{ padding: 24 }}>
          <Spinner />
        </div>
      ) : (
        MEALS.map((meal) => {
          const list = entries.filter((e) => e.meal === meal)
          const kcal = sumEntries(list).calories
          return (
            <section className="card" key={meal}>
              <div className="meal-head">
                <h2>{MEAL_LABEL[meal]}</h2>
                <div className="row">
                  {kcal > 0 && <span className="small muted num">{kcal} kcal</span>}
                  <button className="btn soft sm" onClick={() => openAdd({ meal })} aria-label={`Add to ${MEAL_LABEL[meal]}`}>
                    + Add
                  </button>
                </div>
              </div>
              {list.map((e) => (
                <button key={e.id} className="entry" onClick={() => setEditing(e)}>
                  <div className="grow">
                    <div className="ellipsis">{e.name}</div>
                    <div className="tiny muted ellipsis">
                      {Number(e.servings) !== 1 && `${Number(e.servings)} × `}
                      {e.serving || (e.source === 'quick' ? 'Quick add' : '1 serving')}
                      {e.source === 'ai' && (
                        <>
                          {' '}
                          <span className="tag">AI est.</span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className="kcal num">{entryTotals(e).calories}</span>
                </button>
              ))}
            </section>
          )
        })
      )}

      {entries && entries.length === 0 && (
        <p className="center">
          <button className="btn ghost sm" onClick={copyYesterday}>Copy the day before</button>
        </p>
      )}

      {editing && <EditEntry entry={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function QuickWeight({ units }) {
  const { store, today, reloadWeights, toast } = useApp()
  const [val, setVal] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(e) {
    e.preventDefault()
    const kg = inputToKg(val, units)
    if (!kg || kg < 30 || kg > 350) return toast('Enter a realistic weight', 'error')
    setBusy(true)
    try {
      await store.upsertWeight({ log_date: today, weight_kg: Math.round(kg * 100) / 100 })
      await reloadWeights()
      toast('Weight saved')
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="card row" onSubmit={save}>
      <span className="grow small">⚖️ Morning weigh-in</span>
      <input className="input" style={{ width: 96 }} inputMode="decimal" placeholder={weightUnit(units)} value={val} onChange={(e) => setVal(e.target.value)} aria-label="Weight" />
      <button className="btn sm" disabled={busy || !val}>Save</button>
    </form>
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
      <div className="row between" style={{ marginBottom: 12 }}>
        <div>
          <div className="small muted">Servings{entry.serving ? ` (${entry.serving})` : ''}</div>
          <Stepper value={e.servings} onChange={(v) => setE((s) => ({ ...s, servings: v }))} />
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="small muted">Total</div>
          <strong className="num" style={{ fontSize: 22 }}>{totals.calories} kcal</strong>
        </div>
      </div>
      <p className="tiny muted" style={{ marginBottom: 4 }}>Per serving</p>
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
        <button
          className="btn ghost block"
          disabled={busy}
          onClick={() => run(() => store.saveFood({ ...patch(), serving: entry.serving }), 'Saved to My foods')}
        >
          Save to My foods
        </button>
        <button className="btn danger block" disabled={busy} onClick={() => run(() => store.deleteEntry(entry.id), 'Deleted')}>Delete</button>
      </div>
    </Sheet>
  )
}
