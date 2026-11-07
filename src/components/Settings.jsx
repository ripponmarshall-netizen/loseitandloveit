import { useEffect, useRef, useState } from 'react'
import { useApp } from '../appContext.js'
import { supabase } from '../lib/supabase.js'
import { entryTotals } from '../lib/calc.js'
import { APP_VERSION } from '../config.js'
import ProfileForm from './ProfileForm.jsx'

async function shareOrDownload(filename, text, type) {
  const blob = new Blob([text], { type })
  try {
    const file = new File([blob], filename, { type })
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: filename })
      return
    }
  } catch (e) {
    if (e.name === 'AbortError') return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function Settings() {
  const { store, mode, session, profile, saveProfile, series, toast, signOut, today, bumpData, reloadWeights } = useApp()
  const [usage, setUsage] = useState(null)
  const importRef = useRef()

  useEffect(() => {
    if (mode === 'cloud') store.getAiUsage(today).then(setUsage).catch(() => {})
  }, [store, mode, today])

  async function onSave(values) {
    await saveProfile(values)
    toast('Saved')
  }

  async function exportJson() {
    try {
      const data = await store.exportAll()
      await shareOrDownload(`loseitandloveit-${today}.json`, JSON.stringify(data, null, 2), 'application/json')
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  async function exportCsv() {
    try {
      const { entries } = await store.exportAll()
      const head = ['date', 'meal', 'food', 'serving', 'servings', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'source']
      const rows = entries.map((e) => {
        const t = entryTotals(e)
        return [e.log_date, e.meal, e.name, e.serving, Number(e.servings), t.calories, t.protein, t.carbs, t.fat, e.source]
      })
      const csv = [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
      await shareOrDownload(`food-log-${today}.csv`, csv, 'text/csv')
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  async function importJson(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const data = JSON.parse(await file.text())
      if (data.app !== 'loseitandloveit') throw new Error('That file is not a Lose It & Love It export.')
      if (!window.confirm(`Import ${data.entries?.length || 0} food entries and ${data.weights?.length || 0} weigh-ins? Entries are added, not merged, so don't import the same file twice.`)) return
      await store.importAll(data)
      const p = await store.getProfile()
      if (p) await saveProfile(p)
      await reloadWeights()
      bumpData()
      toast('Import complete')
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function wipeLocal() {
    if (!window.confirm('Delete ALL data stored on this device? Export first if you want a copy.')) return
    store.wipe()
    await signOut()
  }

  return (
    <div>
      <h1>Settings</h1>

      <section className="card">
        <h3>Account</h3>
        {mode === 'cloud' ? (
          <p>
            Signed in as <strong>{session?.user?.email}</strong>
          </p>
        ) : (
          <p className="small">
            <strong>Local mode.</strong> Data lives only in this browser on this device. If iOS clears website data, it's gone, so export
            regularly or create an account.
          </p>
        )}
        <button className="btn ghost block" onClick={signOut}>
          {mode === 'cloud' ? 'Sign out' : 'Leave local mode'}
        </button>
        {mode === 'cloud' && <ChangePassword />}
      </section>

      <h3 style={{ margin: '18px 4px 8px' }}>Profile &amp; targets</h3>
      <ProfileForm
        key={profile.updated_at || 'p'}
        initial={profile}
        currentWeightKg={series.length ? series[series.length - 1].trend : null}
        onSubmit={onSave}
        submitLabel="Save changes"
        advanced
      />

      {mode === 'cloud' && (
        <section className="card" style={{ marginTop: 12 }}>
          <h3>AI usage today</h3>
          <p className="small" style={{ margin: 0 }}>
            {usage
              ? `${usage.requests} requests · ${Number(usage.input_tokens).toLocaleString('en-GB')} input / ${Number(usage.output_tokens).toLocaleString('en-GB')} output tokens`
              : 'No AI requests yet today.'}
          </p>
        </section>
      )}

      <section className="card" style={{ marginTop: 12 }}>
        <h3>Your data</h3>
        <div className="stack">
          <button className="btn soft block" onClick={exportJson}>Export everything (JSON backup)</button>
          <button className="btn soft block" onClick={exportCsv}>Export food log (CSV for Sheets/Excel)</button>
          <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={importJson} />
          <button className="btn ghost block" onClick={() => importRef.current.click()}>Import JSON backup</button>
          {mode === 'local' && (
            <button className="btn danger block" onClick={wipeLocal}>Delete all data on this device</button>
          )}
        </div>
      </section>

      <section className="card">
        <h3>Install on iPhone</h3>
        <p className="small" style={{ margin: 0 }}>
          In Safari tap <strong>Share</strong> → <strong>Add to Home Screen</strong>. It then opens full-screen like an app and works offline for viewing.
        </p>
      </section>

      <p className="tiny muted center">
        v{APP_VERSION} · Estimates, not medical advice. Talk to your doctor before big diet changes, especially with diabetes, blood pressure
        medication or pregnancy.
      </p>
    </div>
  )
}

function ChangePassword() {
  const { toast } = useApp()
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  if (!open) {
    return (
      <p style={{ margin: '10px 0 0' }}>
        <button className="link small" onClick={() => setOpen(true)}>Change password</button>
      </p>
    )
  }
  async function save(e) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return toast(error.message, 'error')
    toast('Password updated')
    setPw('')
    setOpen(false)
  }
  return (
    <form className="row" style={{ marginTop: 10 }} onSubmit={save}>
      <input className="input grow" type="password" autoComplete="new-password" minLength={8} placeholder="New password (8+ chars)" value={pw} onChange={(e) => setPw(e.target.value)} />
      <button className="btn" disabled={busy || pw.length < 8}>Save</button>
    </form>
  )
}
