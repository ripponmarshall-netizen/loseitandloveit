import { useEffect, useRef, useState } from 'react'
import { useApp } from '../appContext.js'
import { supabase } from '../lib/supabase.js'
import { ACTIVITY, CONDITIONS, ageFromBirthYear, cleanConditions, cmToFtIn, displayWeight, entryTotals } from '../lib/calc.js'
import { formatShortDate } from '../lib/dates.js'
import { validateProfile } from '../lib/profileForm.js'
import { APP_VERSION } from '../config.js'
import { BUILTIN_FOODS } from '../data/foods.js'
import {
  AboutFields,
  BodyFields,
  CoachNotesField,
  DAY_START_OPTIONS,
  EATBACK_OPTIONS,
  GoalFields,
  HealthFields,
  TargetPreview,
  useProfileForm,
} from './ProfileForm.jsx'
import { Avatar, Icon, ListRow, ListSection, MenuRow, Segmented, Sheet, ToggleRow } from './ui.jsx'
import { photoToAvatar } from '../lib/image.js'
import { FREQUENCY_LABEL } from '../data/glp1.js'
import { formatDose, formatWater, glp1Plan, waterTargetMl } from '../lib/glp1.js'

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

function heightLabel(cm, units) {
  if (!cm) return '—'
  if (units === 'metric') return `${Math.round(cm)} cm`
  const { ft, in: inch } = cmToFtIn(Number(cm))
  return `${ft}′${inch}″`
}

export default function Settings() {
  const app = useApp()
  const { store, mode, session, profile, saveProfile, series, weights, targets, toast, signOut, today, bumpData, reloadWeights, units, prefs, setPrefs, openSheet } = app
  const [usage, setUsage] = useState(null)
  const [sheet, setSheet] = useState(null) // 'plan' | 'body' | 'notes' | 'password' | 'photo'
  const importRef = useRef()
  const trendKg = series.length ? series[series.length - 1].trend : null
  const latestWeighIn = weights[weights.length - 1]

  useEffect(() => {
    if (mode === 'cloud') store.getAiUsage(today).then(setUsage).catch(() => {})
  }, [store, mode, today])

  async function saveField(patch, msg = 'Saved') {
    try {
      await saveProfile({ ...profile, ...patch })
      toast(msg)
    } catch (e) {
      toast(e.message, 'error')
    }
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

  const name = profile.display_name || (mode === 'cloud' ? session?.user?.email?.split('@')[0] : 'You')
  const plan = glp1Plan(profile)
  const autoWater = waterTargetMl(trendKg ?? Number(profile.start_weight_kg))
  const WATER_OPTIONS = [
    ['', `Automatic (${formatWater(autoWater)})`, 'Auto'],
    ...[1500, 2000, 2500, 3000, 3500, 4000].map((ml) => [String(ml), formatWater(ml)]),
  ]
  const pace = Number(profile.weekly_rate_kg) || 0

  return (
    <div>
      <h1>Settings</h1>

      {/* Profile header */}
      <div className="list row" style={{ width: '100%', padding: 14, gap: 14 }}>
        <button className="avatar-btn" onClick={() => setSheet('photo')} aria-label={profile.avatar ? 'Change profile photo' : 'Add a profile photo'}>
          <Avatar profile={profile} name={name} size={60} />
          <span className="avatar-badge" aria-hidden="true">
            <Icon name="camera" strokeWidth={2.4} />
          </span>
        </button>
        <button className="grow tap" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left', color: 'inherit', cursor: 'pointer', font: 'inherit' }} onClick={() => setSheet('body')}>
          <span className="title3 ellipsis" style={{ display: 'block' }}>{name}</span>
          <span className="tiny muted ellipsis" style={{ display: 'block' }}>
            {mode === 'cloud' ? session?.user?.email : 'Local mode: data stays on this device'}
          </span>
          {targets && (
            <span className="tiny" style={{ color: 'var(--green)', fontWeight: 600 }}>
              {targets.calories.toLocaleString('en-GB')} kcal a day{targets.overridden ? ' (manual)' : ''}
            </span>
          )}
        </button>
      </div>

      <ListSection header="Plan" footer="Your calorie target updates as your trend weight changes.">
        <ListRow icon="target" color="var(--green)" label="Daily target" value={targets ? `${targets.calories.toLocaleString('en-GB')} kcal` : '—'} onClick={() => setSheet('plan')} />
        <ListRow icon="trend" color="var(--teal)" label="Goal weight" value={displayWeight(Number(profile.goal_weight_kg), units)} onClick={() => setSheet('plan')} />
        <ListRow
          icon="clock"
          color="var(--cyan)"
          label="Pace"
          value={units === 'imperial' ? `${Math.round(pace * 2.2046 * 2) / 2} lb/wk` : `${pace} kg/wk`}
          onClick={() => setSheet('plan')}
        />
        <ListRow icon="run" color="var(--orange)" label="Activity" value={ACTIVITY[profile.activity_level]?.label} onClick={() => setSheet('plan')} />
      </ListSection>

      <ListSection header="Body">
        <ListRow
          icon="person"
          color="var(--blue)"
          label="Personal details"
          sub={[profile.sex === 'female' ? 'Female' : 'Male', ageFromBirthYear(profile.birth_year), heightLabel(profile.height_cm, units)].filter(Boolean).join(' · ')}
          onClick={() => setSheet('body')}
        />
        <ListRow
          icon="scale"
          color="var(--indigo)"
          label="Current weight"
          sub={latestWeighIn ? `Trend · last weigh-in ${displayWeight(Number(latestWeighIn.weight_kg), units)} on ${formatShortDate(latestWeighIn.log_date)}` : 'From your weigh-ins'}
          value={trendKg ? displayWeight(trendKg, units) : '—'}
          onClick={() => openSheet('weight', latestWeighIn?.log_date === today ? { weight: latestWeighIn } : {})}
        />
        <ListRow icon="ruler" color="var(--purple)" label="Units">
          <div style={{ width: 140 }}>
            <Segmented label="Units" value={units} onChange={(u) => saveField({ units: u }, 'Units updated')} options={[['imperial', 'lb · ft'], ['metric', 'kg · cm']]} />
          </div>
        </ListRow>
      </ListSection>

      <ListSection header="Health" footer="Conditions a doctor has diagnosed. They adjust your targets and how Mimi coaches you.">
        <ListRow
          icon="heart"
          color="var(--pink)"
          label="Health conditions"
          value={cleanConditions(profile.conditions, profile.sex).map((c) => CONDITIONS[c].short).join(', ') || 'None'}
          onClick={() => setSheet('health')}
        />
      </ListSection>

      <ListSection
        header="GLP-1 medicine"
        footer={plan ? 'Doses, injection sites and side effects are logged from the Dashboard. Mimi tailors food, water and exercise advice to your medicine.' : 'Ozempic, Wegovy, Mounjaro, Zepbound, Saxenda and more: log doses and injection sites, and get coaching that fits.'}
      >
        <ListRow
          icon="syringe"
          color="var(--purple)"
          label={plan ? plan.name : 'Track a GLP-1 medicine'}
          sub={plan ? `${formatDose(plan.dose, plan.unit)} · ${FREQUENCY_LABEL[plan.frequency]}` : 'Off'}
          onClick={() => openSheet('medication')}
        />
      </ListSection>

      <ListSection header="Tracking" footer="Night shifts: food eaten before your day starts counts toward the day before. Water goal ≈ 30 ml per kg; drink more in the heat and on shift.">
        <MenuRow
          icon="moon"
          color="var(--indigo)"
          label="Day starts at"
          value={String(profile.day_start_hour ?? 4)}
          options={DAY_START_OPTIONS}
          onChange={(v) => saveField({ day_start_hour: Number(v) })}
        />
        <MenuRow
          icon="flame"
          color="var(--red)"
          label="Exercise calories"
          sub="Add workouts to that day’s food target"
          value={String(profile.exercise_eatback_pct ?? 0)}
          options={EATBACK_OPTIONS}
          onChange={(v) => saveField({ exercise_eatback_pct: Number(v) })}
        />
        <MenuRow
          icon="drop"
          color="var(--cyan)"
          label="Water goal"
          value={profile.water_target_ml ? String(profile.water_target_ml) : ''}
          options={WATER_OPTIONS}
          onChange={(v) => saveField({ water_target_ml: v ? Number(v) : null })}
        />
      </ListSection>

      <ListSection
        header="Food databases"
        footer={
          mode === 'cloud'
            ? 'Search and the AI use these alongside your saved foods and the built-in Jamaican list. Packaged-food data comes from labels and can contain errors.'
            : 'Online databases need an account (they are searched through the server).'
        }
      >
        <ListRow icon="leaf" color="var(--green)" label="Jamaican list" sub={`${BUILTIN_FOODS.length} built-in foods plus your saved foods`} value="Always on" />
        <ToggleRow icon="db" color="var(--indigo)" label="USDA FoodData Central" sub="Generic foods and dishes" checked={prefs.usda} onChange={(v) => setPrefs({ usda: v })} />
        <ToggleRow icon="barcode" color="var(--orange)" label="Open Food Facts" sub="Packaged products and barcodes" checked={prefs.off} onChange={(v) => setPrefs({ off: v })} />
        <ToggleRow icon="sparkles" color="var(--purple)" label="AI checks databases" sub="Estimates look foods up first" checked={prefs.aiChecks} onChange={(v) => setPrefs({ aiChecks: v })} />
      </ListSection>

      {mode === 'cloud' && (
        <ListSection
          header="Mimi · your coach"
          footer="Check-ins only run when you open the app and something has changed, at most 6 a day, using a small, cheap AI request (a fraction of a US cent each)."
        >
          <MenuRow
            icon="sparkles"
            color="var(--purple)"
            label="Mimi’s check-ins"
            sub="Tips from your log while the app is open"
            value={String(prefs.checkinHours ?? 3)}
            options={[['2', 'Every 2 hours', 'Every 2 h'], ['3', 'Every 3 hours', 'Every 3 h'], ['0', 'Off']]}
            onChange={(v) => setPrefs({ checkinHours: Number(v) })}
          />
          <ListRow icon="note" color="var(--teal)" label="Notes for Mimi" sub={profile.coach_notes ? profile.coach_notes.slice(0, 60) : 'Shifts, training, injuries, likes'} onClick={() => setSheet('notes')} />
          <ListRow
            icon="chat"
            color="var(--blue)"
            label="AI usage today"
            value={usage ? `${usage.requests} req · ${Math.round((Number(usage.input_tokens) + Number(usage.output_tokens)) / 1000)}k tokens` : 'None yet'}
            chevron={false}
          />
        </ListSection>
      )}
      {mode !== 'cloud' && (
        <ListSection header="Mimi · your coach">
          <ListRow icon="note" color="var(--teal)" label="Notes for Mimi" sub="Used when you have an account" onClick={() => setSheet('notes')} />
        </ListSection>
      )}

      <ListSection header="Appearance">
        <div className="list-row">
          <div style={{ width: '100%' }}>
            <Segmented label="Appearance" value={prefs.theme} onChange={(t) => setPrefs({ theme: t })} options={[['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']]} />
          </div>
        </div>
      </ListSection>

      <ListSection header="Your data" footer={mode === 'local' ? 'Local mode: if iOS clears website data, it’s gone. Export regularly or create an account.' : 'Imports add entries; they don’t merge.'}>
        <ListRow icon="download" color="var(--blue)" label="Export backup (JSON)" onClick={exportJson} />
        <ListRow icon="table" color="var(--green)" label="Export food log (CSV)" onClick={exportCsv} />
        <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={importJson} />
        <ListRow icon="share" color="var(--orange)" label="Import backup" onClick={() => importRef.current.click()} />
        {mode === 'local' && <ListRow icon="trash" color="var(--red)" label="Delete all data on this device" className="destructive" onClick={wipeLocal} />}
      </ListSection>

      <ListSection header="Account">
        {mode === 'cloud' && <ListRow icon="lock" color="var(--text-2)" label="Change password" onClick={() => setSheet('password')} />}
        <ListRow icon="logout" color="var(--red)" label={mode === 'cloud' ? 'Sign out' : 'Leave local mode'} className="destructive" chevron={false} onClick={signOut} />
      </ListSection>

      <ListSection header="About" footer="Estimates, not medical advice. Talk to your doctor before big diet changes, especially with diabetes, blood pressure medication or pregnancy.">
        <ListRow icon="phone" color="var(--text-2)" label="Install on iPhone" sub="Safari → Share → Add to Home Screen" />
        <ListRow icon="info" color="var(--text-2)" label="Version" value={APP_VERSION} chevron={false} />
      </ListSection>

      {sheet === 'plan' && (
        <ProfileSheet title="Your plan" groups={['goal', 'targets']} currentWeightKg={trendKg} onClose={() => setSheet(null)}>
          {(form) => (
            <>
              <GoalFields form={form} advanced />
              <TargetPreview values={form.values} currentWeightKg={trendKg} />
            </>
          )}
        </ProfileSheet>
      )}
      {sheet === 'body' && (
        <ProfileSheet title="Personal details" groups={['about', 'body']} onClose={() => setSheet(null)}>
          {(form) => (
            <>
              <AboutFields form={form} />
              <BodyFields form={form} hasWeighIns={series.length > 0} />
            </>
          )}
        </ProfileSheet>
      )}
      {sheet === 'health' && (
        <ProfileSheet title="Health" groups={[]} onClose={() => setSheet(null)}>
          {(form) => (
            <>
              <HealthFields form={form} />
              <TargetPreview values={form.values} currentWeightKg={trendKg} />
            </>
          )}
        </ProfileSheet>
      )}
      {sheet === 'notes' && (
        <ProfileSheet title="Notes for Mimi" groups={[]} onClose={() => setSheet(null)}>
          {(form) => (
            <>
              <CoachNotesField form={form} />
              <p className="list-footer" style={{ marginTop: -6, marginBottom: 14 }}>Mimi reads these with every message.</p>
            </>
          )}
        </ProfileSheet>
      )}
      {sheet === 'password' && <ChangePassword onClose={() => setSheet(null)} />}
      {sheet === 'photo' && <PhotoSheet name={name} onClose={() => setSheet(null)} />}
    </div>
  )
}

/** A sheet that edits part of the profile and saves the whole thing. */
function ProfileSheet({ title, groups, children, onClose }) {
  const { profile, saveProfile, toast, store, weights, reloadWeights } = useApp()
  const form = useProfileForm(profile)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function save(e) {
    e.preventDefault()
    const problem = validateProfile(form.values, groups)
    if (problem) return setErr(problem)
    setBusy(true)
    // The first weigh-in is created from the starting weight at sign-up. If it
    // still matches the old starting weight, keep the two in step: otherwise
    // correcting the starting weight looks like it did nothing.
    const oldStart = Number(profile.start_weight_kg)
    const newStart = form.values.start_weight_kg
    const first = weights[0]
    const syncFirst = first && newStart && Math.abs(newStart - oldStart) >= 0.05 && Math.abs(Number(first.weight_kg) - oldStart) < 0.06
    try {
      await saveProfile(form.values)
      if (syncFirst) {
        await store.updateWeight(first.id, { log_date: first.log_date, weight_kg: newStart, note: first.note })
        await reloadWeights()
      }
      toast(syncFirst ? `Saved. Your first weigh-in (${formatShortDate(first.log_date)}) was updated too.` : 'Saved')
      onClose()
    } catch (ex) {
      setErr(ex.message)
      setBusy(false)
    }
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <form onSubmit={save}>
        {children(form)}
        {err && (
          <p className="small danger-text" role="alert">
            {err}
          </p>
        )}
        <button className="btn block" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </form>
    </Sheet>
  )
}

function ChangePassword({ onClose }) {
  const { toast } = useApp()
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(e) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return toast(error.message, 'error')
    toast('Password updated')
    onClose()
  }
  return (
    <Sheet title="Change password" onClose={onClose}>
      <form onSubmit={save}>
        <label className="field">
          <span>New password</span>
          <input className="input" type="password" autoComplete="new-password" minLength={8} placeholder="8+ characters" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        </label>
        <button className="btn block" disabled={busy || pw.length < 8}>Save</button>
      </form>
    </Sheet>
  )
}

/** Add, change or remove the profile photo. */
function PhotoSheet({ name, onClose }) {
  const { profile, saveProfile, toast } = useApp()
  const [preview, setPreview] = useState(profile.avatar || null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef()

  async function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      setPreview(await photoToAvatar(file))
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function save(avatar) {
    setBusy(true)
    try {
      await saveProfile({ ...profile, avatar })
      toast(avatar ? 'Photo saved' : 'Photo removed')
      onClose()
    } catch (err) {
      toast(err.message, 'error')
      setBusy(false)
    }
  }

  const changed = preview !== (profile.avatar || null)
  return (
    <Sheet title="Profile photo" onClose={onClose}>
      <div className="photo-hero">
        <Avatar profile={{ ...profile, avatar: preview }} name={name} size={144} />
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
      <div className="stack">
        <button className="btn secondary block" type="button" disabled={busy} onClick={() => fileRef.current.click()}>
          <Icon name="camera" size={18} /> {preview ? 'Choose another photo' : 'Choose a photo'}
        </button>
        {changed && preview && (
          <button className="btn block" type="button" disabled={busy} onClick={() => save(preview)}>
            {busy ? 'Saving…' : 'Use this photo'}
          </button>
        )}
        {profile.avatar && (
          <button className="btn destructive block" type="button" disabled={busy} onClick={() => save(null)}>
            Remove photo
          </button>
        )}
      </div>
      <p className="list-footer" style={{ marginTop: 12 }}>
        Cropped to a square and shrunk to a small image. It’s stored with your profile{' '}
        {profile.id === 'local' ? 'on this device' : 'in your account'} and only you can see it.
      </p>
    </Sheet>
  )
}
