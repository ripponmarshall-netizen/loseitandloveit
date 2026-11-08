import { useState } from 'react'
import { useApp } from '../appContext.js'
import { validateProfile } from '../lib/profileForm.js'
import { AboutFields, BodyFields, GoalFields, LifestyleFields, TargetPreview, UnitsField, useProfileForm } from './ProfileForm.jsx'
import { Penguin } from './ui.jsx'

const STEPS = [
  { id: 'about', title: 'About you', sub: 'Used for the calorie formula. Change any of this later in Settings.' },
  { id: 'body', title: 'Your body', sub: 'Height and today’s weight.' },
  { id: 'goal', title: 'Your goal', sub: 'Where you want to get to, and how fast.' },
  { id: 'life', title: 'Your routine', sub: 'Shift work, exercise and anything the coach should know.' },
]

export default function Onboarding() {
  const { saveProfile, store, reloadWeights, today, signOut, mode } = useApp()
  const form = useProfileForm({})
  const [step, setStep] = useState(0)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
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
      await store.upsertWeight({ log_date: today, weight_kg: v.start_weight_kg })
      await reloadWeights()
      await saveProfile(v)
    } catch (ex) {
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
      {s.id === 'body' && <BodyFields form={form} />}
      {s.id === 'goal' && (
        <>
          <GoalFields form={form} />
          <TargetPreview values={form.values} />
        </>
      )}
      {s.id === 'life' && <LifestyleFields form={form} />}

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
