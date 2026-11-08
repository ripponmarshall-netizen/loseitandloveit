import { useState } from 'react'
import { useApp } from '../appContext.js'
import { displayWeight, inputToKg, isValidWeightKg, weightUnit, weightValue } from '../lib/calc.js'
import { addDays, formatDayLabel } from '../lib/dates.js'
import { Sheet } from './ui.jsx'

const r1 = (n) => Math.round(n * 10) / 10
const toInput = (kg, units) => String(r1(weightValue(Number(kg), units)))

// "−1.2 lb" style change between two weights in kg.
export function weightDelta(kg, prevKg, units) {
  if (prevKg == null) return null
  const v = weightValue(Number(kg) - Number(prevKg), units)
  if (Math.abs(v) < 0.05) return `±0 ${weightUnit(units)}`
  return `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} ${weightUnit(units)}`
}

const previousWeighIn = (weights, date) => [...weights].reverse().find((w) => w.log_date < date) || null

/** Add a weigh-in on any past date, or edit/delete an existing one. */
export function WeightSheet({ weight, date: initialDate, onClose }) {
  const { store, today, units, weights, reloadWeights, toast } = useApp()
  const editing = Boolean(weight)
  const [date, setDate] = useState(weight?.log_date || initialDate || today)
  const [val, setVal] = useState(weight ? toInput(weight.weight_kg, units) : '')
  const [note, setNote] = useState(weight?.note || '')
  const [busy, setBusy] = useState(false)

  const kg = inputToKg(val, units)
  const future = date > today
  const clash = weights.find((w) => w.log_date === date && w.id !== weight?.id)
  const valid = Boolean(date) && !future && kg != null && isValidWeightKg(kg) && !(editing && clash)
  const prev = previousWeighIn(weights, date)

  async function run(fn, msg) {
    setBusy(true)
    try {
      await fn()
      await reloadWeights()
      toast(msg)
      onClose()
    } catch (e) {
      toast(e.message, 'error')
      setBusy(false)
    }
  }

  function save(e) {
    e.preventDefault()
    if (!valid) return
    const row = { log_date: date, weight_kg: kg, note }
    run(() => (editing ? store.updateWeight(weight.id, row) : store.upsertWeight(row)), editing ? 'Weigh-in updated' : 'Weight saved')
  }

  function remove() {
    if (!window.confirm(`Delete the weigh-in for ${formatDayLabel(weight.log_date, today)}?`)) return
    run(() => store.deleteWeight(weight.id), 'Weigh-in deleted')
  }

  const quickDates = [
    [today, 'Today'],
    [addDays(today, -1), 'Yesterday'],
  ]

  return (
    <Sheet title={editing ? 'Edit weigh-in' : 'Log weight'} onClose={onClose}>
      <form onSubmit={save}>
        <label className="field">
          <span>Date</span>
          <input className="input" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <div className="chips" style={{ margin: '-4px 0 12px' }}>
          {quickDates.map(([d, label]) => (
            <button key={d} type="button" className={`chip ${date === d ? 'on' : ''}`} onClick={() => setDate(d)}>
              {label}
            </button>
          ))}
        </div>
        {future && <p className="small" style={{ color: 'var(--danger)' }}>That date is in the future.</p>}

        <label className="field">
          <span>Weight ({weightUnit(units)})</span>
          <input
            className="input big-input num"
            inputMode="decimal"
            placeholder={units === 'imperial' ? 'e.g. 185.4' : 'e.g. 84.1'}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            autoFocus={!editing}
          />
        </label>
        {val && kg != null && !isValidWeightKg(kg) && <p className="small" style={{ color: 'var(--danger)' }}>That doesn't look like a realistic adult weight.</p>}
        {val && kg == null && <p className="small" style={{ color: 'var(--danger)' }}>Numbers only, e.g. 185.4</p>}
        {prev && kg != null && isValidWeightKg(kg) && (
          <p className="small muted">
            {weightDelta(kg, prev.weight_kg, units)} vs {formatDayLabel(prev.log_date, today).toLowerCase()} ({displayWeight(Number(prev.weight_kg), units)})
          </p>
        )}

        <label className="field">
          <span>Note (optional)</span>
          <input className="input" maxLength={300} placeholder="e.g. after night shift, salty dinner, period week" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        {clash && (
          <p className="small" style={{ color: editing ? 'var(--danger)' : 'var(--muted)' }}>
            {editing
              ? `You already have ${displayWeight(Number(clash.weight_kg), units)} on that date. Pick another date or edit that one.`
              : `This replaces ${displayWeight(Number(clash.weight_kg), units)} already logged on that date.`}
          </p>
        )}

        <div className="stack">
          <button className="btn block" disabled={busy || !valid}>
            {editing ? 'Save changes' : clash ? 'Replace weigh-in' : 'Save weigh-in'}
          </button>
          {editing && (
            <button type="button" className="btn danger block" disabled={busy} onClick={remove}>
              Delete
            </button>
          )}
        </div>
        <p className="tiny muted" style={{ margin: '10px 0 0' }}>
          One weigh-in per day. Same time each morning, after the toilet and before food, gives the cleanest trend.
        </p>
      </form>
    </Sheet>
  )
}

/** Today screen: weigh-in for the day being viewed, with quick entry or edit. */
export function WeighInCard({ date }) {
  const { store, weights, units, today, reloadWeights, toast } = useApp()
  const [val, setVal] = useState('')
  const [busy, setBusy] = useState(false)
  const [sheet, setSheet] = useState(null) // { weight } to edit, {} for another date
  if (date > today) return null

  const existing = weights.find((w) => w.log_date === date)
  const prev = previousWeighIn(weights, date)
  const label = date === today ? 'Morning weigh-in' : `Weigh-in · ${formatDayLabel(date, today)}`

  async function quickSave(e) {
    e.preventDefault()
    const kg = inputToKg(val, units)
    if (kg == null || !isValidWeightKg(kg)) return toast('Enter a realistic weight, e.g. 185.4', 'error')
    setBusy(true)
    try {
      await store.upsertWeight({ log_date: date, weight_kg: kg })
      await reloadWeights()
      setVal('')
      toast('Weight saved')
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {existing ? (
        <button className="card weigh-card" onClick={() => setSheet({ weight: existing })} aria-label={`Edit weigh-in, ${displayWeight(Number(existing.weight_kg), units)}`}>
          <span aria-hidden="true" style={{ fontSize: 20 }}>⚖️</span>
          <span className="grow" style={{ textAlign: 'left' }}>
            <span className="small muted" style={{ display: 'block' }}>{label}</span>
            <strong className="num">{displayWeight(Number(existing.weight_kg), units)}</strong>
            {prev && <span className="small muted num"> · {weightDelta(existing.weight_kg, prev.weight_kg, units)}</span>}
          </span>
          <span className="link small">Edit</span>
        </button>
      ) : (
        <form className="card" onSubmit={quickSave}>
          <div className="row">
            <span className="grow small">⚖️ {label}</span>
            <input className="input" style={{ width: 104 }} inputMode="decimal" placeholder={weightUnit(units)} value={val} onChange={(e) => setVal(e.target.value)} aria-label="Weight" />
            <button className="btn sm" disabled={busy || !val}>Save</button>
          </div>
          <button type="button" className="link tiny" style={{ marginTop: 6 }} onClick={() => setSheet({})}>
            Different date or add a note…
          </button>
        </form>
      )}
      {sheet && <WeightSheet weight={sheet.weight} date={date} onClose={() => setSheet(null)} />}
    </>
  )
}
