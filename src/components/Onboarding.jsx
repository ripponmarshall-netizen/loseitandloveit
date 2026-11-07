import { useApp } from '../appContext.js'
import ProfileForm from './ProfileForm.jsx'

export default function Onboarding() {
  const { saveProfile, store, reloadWeights, today, signOut, mode } = useApp()

  async function onSubmit(values) {
    // Save the profile last: it flips the app from onboarding to the main screens.
    await store.upsertWeight({ log_date: today, weight_kg: values.start_weight_kg })
    await reloadWeights()
    await saveProfile(values)
  }

  return (
    <div>
      <h1>Let's set you up</h1>
      <p className="muted">
        A few details to work out your calorie target. You can change any of this later in Settings.
      </p>
      <ProfileForm onSubmit={onSubmit} submitLabel="Start tracking" />
      <p className="center" style={{ marginTop: 16 }}>
        <button className="link small" onClick={signOut}>
          {mode === 'local' ? 'Back' : 'Sign out'}
        </button>
      </p>
    </div>
  )
}
