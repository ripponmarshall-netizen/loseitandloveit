import { useMemo, useState } from 'react'
import { ACTIVITY, computeTargets } from '../lib/calc.js'
import { PACES, convertUnits, fromForm, toForm } from '../lib/profileForm.js'
import { Segmented } from './ui.jsx'

// Field groups shared by onboarding (one step each) and the Settings sheets.

export function useProfileForm(initial) {
  const [f, setF] = useState(() => toForm(initial))
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }))
  const switchUnits = (units) => setF((s) => convertUnits(s, units))
  return { f, set, switchUnits, values: fromForm(f) }
}

export const EATBACK_OPTIONS = [
  ['0', 'Off: activity level already includes training', 'Off'],
  ['25', '25% of what I burn', '25%'],
  ['50', '50% of what I burn', '50%'],
  ['100', '100% of what I burn', '100%'],
]

export const DAY_START_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((h) => [String(h), h === 0 ? 'Midnight' : `${h}:00 am`])

export function UnitsField({ form }) {
  return (
    <label className="field">
      <span>Units</span>
      <Segmented label="Units" value={form.f.units} onChange={form.switchUnits} options={[['imperial', 'lb · ft/in'], ['metric', 'kg · cm']]} />
    </label>
  )
}

export function AboutFields({ form, withName = true }) {
  const { f, set } = form
  return (
    <>
      {withName && (
        <label className="field">
          <span>First name (optional)</span>
          <input className="input" value={f.display_name} onChange={set('display_name')} autoComplete="given-name" />
        </label>
      )}
      <label className="field">
        <span>Sex (for the calorie formula)</span>
        <Segmented label="Sex" value={f.sex} onChange={set('sex')} options={[['male', 'Male'], ['female', 'Female']]} />
      </label>
      <label className="field">
        <span>Birth year</span>
        <input className="input" inputMode="numeric" placeholder="1990" value={f.birth_year} onChange={set('birth_year')} />
      </label>
    </>
  )
}

export function BodyFields({ form, hasWeighIns }) {
  const { f, set } = form
  const wUnit = f.units === 'imperial' ? 'lb' : 'kg'
  return (
    <>
      {f.units === 'imperial' ? (
        <div className="grid2">
          <label className="field">
            <span>Height (ft)</span>
            <input className="input" inputMode="numeric" placeholder="5" value={f.ft} onChange={set('ft')} />
          </label>
          <label className="field">
            <span>(in)</span>
            <input className="input" inputMode="numeric" placeholder="10" value={f.inch} onChange={set('inch')} />
          </label>
        </div>
      ) : (
        <label className="field">
          <span>Height (cm)</span>
          <input className="input" inputMode="decimal" placeholder="178" value={f.height_cm} onChange={set('height_cm')} />
        </label>
      )}
      <label className="field">
        <span>{hasWeighIns ? 'Starting weight' : 'Current weight'} ({wUnit})</span>
        <input className="input" inputMode="decimal" value={f.start_weight} onChange={set('start_weight')} />
        {hasWeighIns && <small className="tiny muted">Your targets use your trend weight from weigh-ins, not this number.</small>}
      </label>
    </>
  )
}

export function GoalFields({ form, advanced = false }) {
  const { f, set } = form
  const wUnit = f.units === 'imperial' ? 'lb' : 'kg'
  return (
    <>
      <label className="field">
        <span>Goal weight ({wUnit})</span>
        <input className="input" inputMode="decimal" value={f.goal_weight} onChange={set('goal_weight')} />
      </label>
      <label className="field">
        <span>Pace</span>
        <Segmented label="Pace" value={f.weekly_rate_kg} onChange={set('weekly_rate_kg')} options={PACES[f.units].map(([kg, l]) => [kg, l.replace(' a week', '')])} />
        <small className="tiny muted">Per week. Slower is easier to stick to and keeps more muscle.</small>
      </label>
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
      {advanced && (
        <details className="card" style={{ padding: '12px 14px' }}>
          <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>Manual targets</summary>
          <div className="grid2" style={{ marginTop: 12 }}>
            <label className="field">
              <span>Calories</span>
              <input className="input" inputMode="numeric" placeholder="auto" value={f.calorie_target_override} onChange={set('calorie_target_override')} />
            </label>
            <label className="field">
              <span>Protein (g)</span>
              <input className="input" inputMode="numeric" placeholder="auto" value={f.protein_target_override} onChange={set('protein_target_override')} />
            </label>
          </div>
          <p className="tiny muted" style={{ margin: 0 }}>Leave blank to use the formula. Progress can also set this from your real maintenance.</p>
        </details>
      )}
    </>
  )
}

export function LifestyleFields({ form }) {
  const { f, set } = form
  return (
    <>
      <label className="field">
        <span>My day starts at</span>
        <select className="input" value={f.day_start_hour} onChange={set('day_start_hour')}>
          {DAY_START_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <small className="tiny muted">For night shifts: food eaten before this time counts toward the previous day.</small>
      </label>
      <label className="field">
        <span>Exercise calories</span>
        <select className="input" value={f.exercise_eatback_pct} onChange={set('exercise_eatback_pct')}>
          {EATBACK_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <small className="tiny muted">Logged workouts can raise that day's food target. Burn estimates run high, so 0–50% is safer.</small>
      </label>
      <CoachNotesField form={form} />
    </>
  )
}

export function CoachNotesField({ form }) {
  return (
    <label className="field">
      <span>Notes for Mimi, your coach (optional)</span>
      <textarea
        className="input"
        placeholder="e.g. Rotating 24h shifts. Gym 3×/week. Don't like fish. Bad knee."
        value={form.f.coach_notes}
        onChange={form.set('coach_notes')}
        maxLength={2000}
      />
    </label>
  )
}

export function TargetPreview({ values, currentWeightKg }) {
  const preview = useMemo(
    () => computeTargets(values, currentWeightKg || values.start_weight_kg),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(values), currentWeightKg],
  )
  if (!preview) return null
  return (
    <div className="card tinted" style={{ '--c': 'var(--green)' }}>
      <div className="row between">
        <span className="headline">Daily target</span>
        <span className="num" style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--green)' }}>
          {preview.calories.toLocaleString('en-GB')}
          <span className="small muted" style={{ fontWeight: 500 }}> kcal</span>
        </span>
      </div>
      <div className="row wrap small" style={{ gap: 12, margin: '6px 0' }}>
        <span style={{ color: 'var(--protein)', fontWeight: 600 }}>P {preview.protein} g</span>
        <span style={{ color: 'var(--carbs)', fontWeight: 600 }}>C {preview.carbs} g</span>
        <span style={{ color: 'var(--fat)', fontWeight: 600 }}>F {preview.fat} g</span>
        <span className="muted">Maintenance ≈ {preview.tdee}</span>
      </div>
      {preview.warnings.map((w) => (
        <p key={w} className="small" style={{ color: 'var(--orange)', margin: '4px 0' }}>{w}</p>
      ))}
      <p className="tiny muted" style={{ margin: 0 }}>
        Formula-based starting point (Mifflin-St Jeor). After 2–3 weeks of logging, Progress shows your real maintenance.
      </p>
    </div>
  )
}
