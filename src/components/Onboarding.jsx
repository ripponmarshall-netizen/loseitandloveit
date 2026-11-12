import { useState } from 'react'
import { useApp } from '../appContext.js'
import { validateProfile, exactWeightKg } from '../lib/profileForm.js'
import { AboutFields, BodyFields, GoalFields, HealthFields, LifestyleFields, TargetPreview, UnitsField, useProfileForm } from './ProfileForm.jsx'
import { Penguin, Segmented } from './ui.jsx'
import { GLP1_MEDS, MED_BY_ID } from '../data/glp1.js'

const STEPS = [
  { id: 'about', title: 'About you', sub: 'Used for the calorie formula. Change any of this later in Settings.' },
  { id: 'body', title: 'Your body', sub: 'Height and today’s weight.' },
  { id: 'goal', title: 'Your goal', sub: 'Where you want to get to, and how fast.' },
  { id: 'life', title: 'Your routine', sub: 'Shift work, exercise, medicines and anything Mimi, your penguin coach, should know.' },
]

export default function Onboarding() {
  const { saveProfile, store, reloadWeights, today, signOut, mode, toast, weights } = useApp()
  const form = useProfileForm({})
  const [step, setStep] = useState(0)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [glp1, setGlp1] = useState({ on: false, med: 'mounjaro', dose: '2.5' })
  const s = STEPS[step]

  async function next(e) {
    e.preventDefault()
    const v = form.values
    const problem = validateProfile(v, s.id === 'life' ? ['targets'] : [s.id])
    if (problem) return setErr(problem)
    setErr(null)
    if (step < STEPS.length - 1) {
      setStep(step + 1)
      window.scrollTo({ top: 0 })
      return
    }
    setBusy(true)
    try {
      // Save the profile last: it flips the app from onboarding to the main screens.
      // The first weigh-in is the weight as typed (weigh-ins keep 0.01 kg), so 230 lb doesn't become 229.9.
      // A retry after a failed save mustn't log the same weigh-in twice.
      const kg = Math.round(exactWeightKg(v.start_weight_kg, v.units) * 100) / 100
      if (!weights.some((w) => w.log_date === today && Math.abs(Number(w.weight_kg) - kg) < 0.01)) {
        await store.addWeight({ log_date: today, weight_kg: kg })
        await reloadWeights()
      }
      const med = MED_BY_ID[glp1.med]
      await saveProfile(
        glp1.on && Number(glp1.dose) > 0
          ? { ...v, glp1_med: med.id, glp1_dose: Number(glp1.dose), glp1_unit: med.unit, glp1_frequency: med.frequency, glp1_started_on: today }
          : v,
      )
    } catch (ex) {
      if (ex.saved) return toast(ex.message, 'error') // saved; only the GLP-1 columns are missing
      setErr(ex.message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={next} className="page" key={step} style={{ paddingTop: 8 }}>
      {step === 0 && (
        <div className="center">
          <Penguin kind="workout" size={120} />
        </div>
      )}
      <div className="steps" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((x, i) => (
          <i key={x.id} className={i <= step ? 'done' : ''} />
        ))}
      </div>
      <h1 style={{ marginBottom: 4 }}>{s.title}</h1>
      <p className="muted" style={{ marginBottom: 20 }}>{s.sub}</p>

      {s.id === 'about' && (
        <>
          <AboutFields form={form} />
          <UnitsField form={form} />
        </>
      )}
      {s.id === 'body' && (
        <>
          <BodyFields form={form} />
          <HealthFields form={form} />
        </>
      )}
      {s.id === 'goal' && (
        <>
          <GoalFields form={form} />
          <TargetPreview values={form.values} />
        </>
      )}
      {s.id === 'life' && (
        <>
          <div className="field">
            <span>Are you taking a GLP-1 medicine?</span>
            <Segmented label="GLP-1" value={glp1.on} onChange={(on) => setGlp1((g) => ({ ...g, on }))} options={[[false, 'No'], [true, 'Yes']]} />
            <small className="tiny muted">Ozempic, Wegovy, Mounjaro, Zepbound, Saxenda… You can add it later in Settings.</small>
          </div>
          {glp1.on && (
            <div className="grid2">
              <label className="field">
                <span>Medicine</span>
                <select
                  className="input"
                  value={glp1.med}
                  onChange={(e) => setGlp1((g) => ({ ...g, med: e.target.value, dose: String(MED_BY_ID[e.target.value].doses[0] ?? '') }))}
                >
                  {GLP1_MEDS.filter((m) => m.id !== 'other').map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Current dose ({MED_BY_ID[glp1.med].unit})</span>
                <select className="input" value={glp1.dose} onChange={(e) => setGlp1((g) => ({ ...g, dose: e.target.value }))}>
                  {MED_BY_ID[glp1.med].doses.map((d) => (
                    <option key={d} value={String(d)}>{d} {MED_BY_ID[glp1.med].unit}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <LifestyleFields form={form} />
        </>
      )}

      {err && (
        <p className="small danger-text" role="alert">
          {err}
        </p>
      )}
      <button className="btn block" disabled={busy} style={{ marginTop: 6 }}>
        {busy ? 'Saving…' : step < STEPS.length - 1 ? 'Continue' : 'Start tracking'}
      </button>
      <p className="center" style={{ marginTop: 14 }}>
        {step > 0 ? (
          <button type="button" className="link small" onClick={() => setStep(step - 1)}>Back</button>
        ) : (
          <button type="button" className="link small" onClick={signOut}>{mode === 'local' ? 'Back' : 'Sign out'}</button>
        )}
      </p>
    </form>
  )
}
