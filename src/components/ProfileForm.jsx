import { useMemo, useState } from 'react'
import { ACTIVITY, cmToFtIn, computeTargets, ftInToCm, kgToLb, lbToKg } from '../lib/calc.js'
import { Segmented } from './ui.jsx'

const PACES = {
  metric: [0.25, 0.5, 0.75, 1].map((kg) => [kg, `${kg} kg/week`]),
  imperial: [0.5, 1, 1.5, 2].map((lb) => [Math.round(lbToKg(lb) * 100) / 100, `${lb} lb/week`]),
}

const r1 = (n) => Math.round(n * 10) / 10

// Snap a stored kg/week pace to the closest option for the chosen units.
const snapPace = (kg, units) =>
  PACES[units].reduce((best, [v]) => (Math.abs(v - kg) < Math.abs(best - kg) ? v : best), PACES[units][1][0])

function toForm(p) {
  const units = p.units || 'imperial'
  const ftin = p.height_cm ? cmToFtIn(Number(p.height_cm)) : { ft: '', in: '' }
  const w = (kg) => (kg ? String(r1(units === 'imperial' ? kgToLb(Number(kg)) : Number(kg))) : '')
  return {
    display_name: p.display_name || '',
    sex: p.sex || 'male',
    birth_year: p.birth_year ? String(p.birth_year) : '',
    units,
    height_cm: p.height_cm ? String(p.height_cm) : '',
    ft: String(ftin.ft),
    inch: String(ftin.in),
    start_weight: w(p.start_weight_kg),
    goal_weight: w(p.goal_weight_kg),
    activity_level: p.activity_level || 'light',
    weekly_rate_kg: p.weekly_rate_kg != null ? snapPace(Number(p.weekly_rate_kg), units) : PACES[units][1][0],
    day_start_hour: p.day_start_hour ?? 4,
    coach_notes: p.coach_notes || '',
    calorie_target_override: p.calorie_target_override ? String(p.calorie_target_override) : '',
    protein_target_override: p.protein_target_override ? String(p.protein_target_override) : '',
    exercise_eatback_pct: String(p.exercise_eatback_pct ?? 0),
  }
}

function fromForm(f) {
  const toKg = (v) => (v ? r1(f.units === 'imperial' ? lbToKg(Number(v)) : Number(v)) : null)
  const height = f.units === 'imperial' ? (f.ft ? r1(ftInToCm(f.ft, f.inch || 0)) : null) : f.height_cm ? Number(f.height_cm) : null
  return {
    display_name: f.display_name.trim() || null,
    sex: f.sex,
    birth_year: f.birth_year ? Number(f.birth_year) : null,
    units: f.units,
    height_cm: height,
    start_weight_kg: toKg(f.start_weight),
    goal_weight_kg: toKg(f.goal_weight),
    activity_level: f.activity_level,
    weekly_rate_kg: Number(f.weekly_rate_kg),
    day_start_hour: Number(f.day_start_hour),
    coach_notes: f.coach_notes.trim() || null,
    calorie_target_override: f.calorie_target_override ? Number(f.calorie_target_override) : null,
    protein_target_override: f.protein_target_override ? Number(f.protein_target_override) : null,
    exercise_eatback_pct: Number(f.exercise_eatback_pct) || 0,
  }
}

// A plain card during onboarding; a collapsible one in Settings so the page stays short.
function Section({ title, collapsible, children }) {
  if (!collapsible) return <div className="card">{children}</div>
  return (
    <details className="card fold">
      <summary>{title}</summary>
      <div className="fold-body">{children}</div>
    </details>
  )
}

export default function ProfileForm({ initial = {}, currentWeightKg, onSubmit, submitLabel = 'Save', advanced = false }) {
  const [f, setF] = useState(() => toForm(initial))
  const [saved, setSaved] = useState(() => JSON.stringify(toForm(initial)))
  const dirty = JSON.stringify(f) !== saved
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }))

  const switchUnits = (units) => {
    if (units === f.units) return
    const p = fromForm(f)
    setF(toForm({ ...p, units }))
  }

  const values = fromForm(f)
  const preview = useMemo(
    () => computeTargets(values, currentWeightKg || values.start_weight_kg),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(values), currentWeightKg],
  )
  const wUnit = f.units === 'imperial' ? 'lb' : 'kg'
  const thisYear = new Date().getFullYear()

  async function submit(e) {
    e.preventDefault()
    setErr(null)
    const v = fromForm(f)
    if (!v.height_cm || !v.birth_year || !v.start_weight_kg || !v.goal_weight_kg) {
      setErr('Fill in height, birth year, current weight and goal weight.')
      return
    }
    if (v.birth_year > thisYear - 18) {
      setErr('This app is for adults (18+). Please talk to a doctor about weight goals for teens.')
      return
    }
    setBusy(true)
    try {
      await onSubmit(v)
      setSaved(JSON.stringify(f))
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <Section title="About you" collapsible={advanced}>
        <label className="field">
          <span>Name (optional)</span>
          <input className="input" value={f.display_name} onChange={set('display_name')} autoComplete="given-name" />
        </label>
        <label className="field">
          <span>Units</span>
          <Segmented value={f.units} onChange={switchUnits} options={[['imperial', 'lb · ft/in'], ['metric', 'kg · cm']]} />
        </label>
        <div className="grid2">
          <label className="field">
            <span>Sex (for BMR)</span>
            <select className="input" value={f.sex} onChange={set('sex')}>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </label>
          <label className="field">
            <span>Birth year</span>
            <input className="input" inputMode="numeric" placeholder="1990" value={f.birth_year} onChange={set('birth_year')} />
          </label>
        </div>
        {f.units === 'imperial' ? (
          <div className="grid2">
            <label className="field">
              <span>Height (ft)</span>
              <input className="input" inputMode="numeric" value={f.ft} onChange={set('ft')} />
            </label>
            <label className="field">
              <span>Height (in)</span>
              <input className="input" inputMode="numeric" value={f.inch} onChange={set('inch')} />
            </label>
          </div>
        ) : (
          <label className="field">
            <span>Height (cm)</span>
            <input className="input" inputMode="decimal" value={f.height_cm} onChange={set('height_cm')} />
          </label>
        )}
        <div className="grid2">
          <label className="field">
            <span>{currentWeightKg ? 'Starting weight' : 'Current weight'} ({wUnit})</span>
            <input className="input" inputMode="decimal" value={f.start_weight} onChange={set('start_weight')} />
          </label>
          <label className="field">
            <span>Goal weight ({wUnit})</span>
            <input className="input" inputMode="decimal" value={f.goal_weight} onChange={set('goal_weight')} />
          </label>
        </div>
      </Section>

      <Section title="Plan & targets" collapsible={advanced}>
        <label className="field">
          <span>Activity level</span>
          <select className="input" value={f.activity_level} onChange={set('activity_level')}>
            {Object.entries(ACTIVITY).map(([k, a]) => (
              <option key={k} value={k}>
                {a.label}: {a.desc}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Pace</span>
          <select className="input" value={f.weekly_rate_kg} onChange={set('weekly_rate_kg')}>
            {PACES[f.units].map(([kg, label]) => (
              <option key={kg} value={kg}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Eat back exercise calories</span>
          <select className="input" value={f.exercise_eatback_pct} onChange={set('exercise_eatback_pct')}>
            <option value="0">No: my activity level already includes training</option>
            <option value="25">25% of what I burn</option>
            <option value="50">50% of what I burn</option>
            <option value="100">100% of what I burn</option>
          </select>
          <small className="muted tiny">
            Logged workouts can raise that day's food target. Burn estimates run high, so 0–50% is safer for fat loss.
          </small>
        </label>
        <label className="field">
          <span>My day starts at</span>
          <select className="input" value={f.day_start_hour} onChange={set('day_start_hour')}>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((h) => (
              <option key={h} value={h}>
                {h === 0 ? 'Midnight' : `${h}:00 am`}
              </option>
            ))}
          </select>
          <small className="muted tiny">Night shifts: food eaten before this time counts toward the previous day.</small>
        </label>
        <label className="field">
          <span>Notes for the coach (optional)</span>
          <textarea
            className="input"
            placeholder="e.g. Rotating 24h shifts. Gym 3×/week. Don't like fish. Bad knee."
            value={f.coach_notes}
            onChange={set('coach_notes')}
            maxLength={2000}
          />
        </label>
        {advanced && (
          <div className="grid2">
            <label className="field">
              <span>Calorie override</span>
              <input className="input" inputMode="numeric" placeholder="auto" value={f.calorie_target_override} onChange={set('calorie_target_override')} />
            </label>
            <label className="field">
              <span>Protein override (g)</span>
              <input className="input" inputMode="numeric" placeholder="auto" value={f.protein_target_override} onChange={set('protein_target_override')} />
            </label>
          </div>
        )}
      </Section>

      {preview && (
        <div className="card flat" style={{ background: 'var(--brand-soft)' }}>
          <div className="row between">
            <strong>Daily target</strong>
            <strong className="num">{preview.calories} kcal</strong>
          </div>
          <p className="small muted" style={{ marginTop: 4 }}>
            Maintenance ≈ {preview.tdee} kcal · Protein {preview.protein} g · Carbs {preview.carbs} g · Fat {preview.fat} g
          </p>
          {preview.warnings.map((w) => (
            <p key={w} className="small warn-text">
              {w}
            </p>
          ))}
          <p className="tiny muted" style={{ margin: 0 }}>
            Formula-based starting point (Mifflin-St Jeor). After 2–3 weeks of logging, Progress shows your real maintenance.
          </p>
        </div>
      )}

      {err && (
        <p className="small" style={{ color: 'var(--danger)' }} role="alert">
          {err}
        </p>
      )}
      {/* In Settings the button only appears once something changed, and sticks above the nav. */}
      {(!advanced || dirty) && (
        <div className={advanced ? 'savebar' : undefined}>
          <button className="btn block" disabled={busy}>
            {busy ? 'Saving…' : submitLabel}
          </button>
        </div>
      )}
    </form>
  )
}
