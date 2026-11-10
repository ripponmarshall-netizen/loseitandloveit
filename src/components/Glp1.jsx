import { useEffect, useState } from 'react'
import { useApp } from '../appContext.js'
import { FREQUENCY_LABEL, GLP1_MEDS, INJECTION_SITES, MED_BY_ID, SITE_BY_ID } from '../data/glp1.js'
import { planDoseStatus, doseStatusLabel, doseStep, formatDose, glp1Plan, suggestSite } from '../lib/glp1.js'
import { daysBetween, formatDayLabel, formatShortDate } from '../lib/dates.js'
import { displayWeight, trendOn, weightValue, weightUnit } from '../lib/calc.js'
import { Icon, ListRow, ListSection, Sheet, Switch } from './ui.jsx'

const pad = (n) => String(n).padStart(2, '0')
const nowTime = () => {
  const d = new Date()
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const timeOf = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? nowTime() : `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---------------------------------------------------------------- body map

// Front view: the person faces you, so their left is on your right.
const ZONES = {
  'arm-r': { x: 33, y: 76, w: 22, h: 44 },
  'arm-l': { x: 145, y: 76, w: 22, h: 44 },
  'abdomen-ur': { x: 69, y: 98, w: 27, h: 25 },
  'abdomen-ul': { x: 104, y: 98, w: 27, h: 25 },
  'abdomen-lr': { x: 69, y: 133, w: 27, h: 25 },
  'abdomen-ll': { x: 104, y: 133, w: 27, h: 25 },
  'thigh-r': { x: 69, y: 182, w: 28, h: 54 },
  'thigh-l': { x: 103, y: 182, w: 28, h: 54 },
}

/**
 * Tappable injection-site diagram. `recent` is site ids newest first:
 * the last three uses are numbered so rotation is easy to see.
 */
export function BodyMap({ value, onChange, suggested, recent = [], readOnly = false }) {
  return (
    <div className="body-map">
      <svg viewBox="0 0 200 300" role={readOnly ? 'img' : 'group'} aria-label="Injection sites, front view">
        <text x="12" y="16" className="bm-side">Your right</text>
        <text x="188" y="16" className="bm-side" textAnchor="end">Your left</text>
        <g className="bm-body">
          <circle cx="100" cy="36" r="21" />
          <rect x="62" y="62" width="76" height="112" rx="28" />
          <rect x="32" y="66" width="26" height="104" rx="13" />
          <rect x="142" y="66" width="26" height="104" rx="13" />
          <rect x="66" y="168" width="32" height="122" rx="16" />
          <rect x="102" y="168" width="32" height="122" rx="16" />
        </g>
        <circle cx="100" cy="128" r="9" className="bm-keepout" />
        <circle cx="100" cy="128" r="2.2" className="bm-navel" />
        {INJECTION_SITES.map((s) => {
          const z = ZONES[s.id]
          const n = recent.slice(0, 3).indexOf(s.id)
          const cls = ['bm-zone', value === s.id && 'on', suggested === s.id && value !== s.id && 'suggested'].filter(Boolean).join(' ')
          return (
            <g
              key={s.id}
              className={cls}
              role={readOnly ? undefined : 'button'}
              tabIndex={readOnly ? undefined : 0}
              aria-label={`${s.label}${suggested === s.id ? ' (suggested)' : ''}${n >= 0 ? `, used ${n === 0 ? 'last time' : `${n + 1} doses ago`}` : ''}`}
              aria-pressed={readOnly ? undefined : value === s.id}
              onClick={readOnly ? undefined : () => onChange(s.id)}
              onKeyDown={readOnly ? undefined : (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onChange(s.id))}
            >
              <rect x={z.x} y={z.y} width={z.w} height={z.h} rx="8" />
              {n >= 0 && (
                <text x={z.x + z.w / 2} y={z.y + z.h / 2 + 4} textAnchor="middle" className="bm-n">{n + 1}</text>
              )}
            </g>
          )
        })}
      </svg>
      <div className="bm-legend caption muted">
        <span><i className="bm-key on" /> Chosen</span>
        <span><i className="bm-key suggested" /> Suggested next</span>
        <span><b>1</b> = last used</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- dose picker

function DoseChips({ med, value, onChange, unit }) {
  const doses = MED_BY_ID[med]?.doses || []
  const custom = value !== '' && value != null && !doses.some((d) => Math.abs(d - Number(value)) < 1e-6)
  return (
    <>
      {doses.length > 0 && (
        <div className="chip-wrap" style={{ marginBottom: 10 }}>
          {doses.map((d) => (
            <button
              key={d}
              type="button"
              className={`chip${Math.abs(d - Number(value)) < 1e-6 ? ' tinted' : ''}`}
              style={{ '--c': 'var(--purple)' }}
              aria-pressed={Math.abs(d - Number(value)) < 1e-6}
              onClick={() => onChange(String(d))}
            >
              {d} {unit}
            </button>
          ))}
        </div>
      )}
      <label className="field">
        <span>{doses.length ? 'Or type the dose' : 'Dose'} ({unit})</span>
        <input className="input" inputMode="decimal" value={custom || !doses.length ? value : ''} placeholder={doses.length ? 'Other dose' : 'e.g. 0.5'} onChange={(e) => onChange(e.target.value.replace(',', '.'))} />
      </label>
    </>
  )
}

function MedSelect({ value, onChange }) {
  return (
    <label className="field">
      <span>Medicine</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {GLP1_MEDS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}{m.id === 'other' ? '' : ` · ${m.generic}`}
          </option>
        ))}
      </select>
    </label>
  )
}

// ---------------------------------------------------------------- log a dose

/** Log or edit one GLP-1 dose: medicine, dose, time and injection site. */
export function DoseSheet({ date, dose: existing, preset = {}, onClose }) {
  const { store, profile, saveProfile, bumpData, toast, today } = useApp()
  const plan = glp1Plan(profile)
  const startMed = existing?.med || preset.med || plan?.id || 'mounjaro'
  const [med, setMed] = useState(startMed)
  const [name, setName] = useState(existing?.med_name || (startMed === 'other' ? plan?.name || '' : ''))
  const [amount, setAmount] = useState(() => {
    if (existing) return String(Number(existing.dose))
    if (preset.dose) return String(preset.dose)
    if (plan && plan.id === startMed && plan.dose) return String(plan.dose)
    return String(MED_BY_ID[startMed]?.doses[0] ?? '')
  })
  const [day, setDay] = useState(existing?.log_date || date)
  const [time, setTime] = useState(existing ? timeOf(existing.taken_at) : nowTime())
  const [site, setSite] = useState(existing?.site || null)
  const [siteTouched, setSiteTouched] = useState(!!existing)
  const [notes, setNotes] = useState(existing?.notes || '')
  const [recent, setRecent] = useState(null) // null until loaded
  const [busy, setBusy] = useState(false)
  const info = MED_BY_ID[med] || MED_BY_ID.other
  const unit = info.unit
  const oral = info.route === 'oral'
  const doseNum = Number(amount)
  const label = med === 'other' ? name.trim() || 'GLP-1' : info.label
  const planChanges = !existing && (!plan || plan.id !== med || Number(plan.dose) !== doseNum)
  const [updatePlan, setUpdatePlan] = useState(true)

  useEffect(() => {
    store
      .listRecentDoses(12)
      .then((rows) => setRecent(rows.filter((r) => r.id !== existing?.id)))
      .catch(() => setRecent([]))
  }, [store, existing?.id])

  // Suggest only once recent doses have loaded (an empty list would suggest
  // the first site, which may be the one used last time). Follow the
  // suggestion until the user picks a site themselves.
  const suggested = recent ? suggestSite(recent) : null
  const chosenSite = siteTouched ? site : suggested
  const pickSite = (id) => {
    setSite(id)
    setSiteTouched(true)
  }

  function changeMed(id) {
    setMed(id)
    const doses = MED_BY_ID[id]?.doses || []
    setAmount(plan?.id === id && plan.dose ? String(plan.dose) : String(doses[0] ?? ''))
  }

  async function save() {
    if (!(doseNum > 0)) return toast('Enter the dose', 'error')
    setBusy(true)
    const takenAt = new Date(`${day}T${time || '12:00'}`)
    const row = {
      log_date: day,
      taken_at: Number.isNaN(takenAt.getTime()) ? new Date().toISOString() : takenAt.toISOString(),
      med,
      med_name: label,
      dose: doseNum,
      unit,
      route: info.route,
      site: oral ? null : chosenSite,
      notes: notes.trim() || null,
    }
    try {
      if (existing) await store.updateDose(existing.id, row)
      else await store.addDose(row)
      if (planChanges && updatePlan) {
        await saveProfile({
          ...profile,
          glp1_med: med,
          glp1_name: med === 'other' ? label : null,
          glp1_dose: doseNum,
          glp1_unit: unit,
          glp1_frequency: profile.glp1_med === med && profile.glp1_frequency ? profile.glp1_frequency : info.frequency,
          glp1_started_on: plan?.startedOn || day,
        })
      }
      bumpData()
      toast(existing ? 'Dose updated' : `${label} ${formatDose(doseNum, unit)} logged`)
      onClose()
    } catch (e) {
      bumpData()
      toast(e.message, 'error')
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm('Delete this dose?')) return
    setBusy(true)
    try {
      await store.deleteDose(existing.id)
      bumpData()
      toast('Dose deleted')
      onClose()
    } catch (e) {
      toast(e.message, 'error')
      setBusy(false)
    }
  }

  const step = doseStep(med, doseNum)
  const dayLabel = formatDayLabel(day, today)

  return (
    <Sheet title={existing ? 'Edit dose' : 'Log GLP-1 dose'} onClose={onClose}>
      <MedSelect value={med} onChange={changeMed} />
      {med === 'other' && (
        <label className="field">
          <span>Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="As on the pen or box" maxLength={80} />
        </label>
      )}
      <DoseChips med={med} value={amount} onChange={setAmount} unit={unit} />
      {step && (
        <p className="list-footer" style={{ margin: '-6px 4px 14px' }}>
          Step {step.step} of {step.of} on the usual {info.label} ladder{step.isTop ? ' (top dose)' : ''}. Only change dose as your prescriber says.
        </p>
      )}

      <div className="grid2">
        <label className="field">
          <span>Date</span>
          <input className="input" type="date" max={today} value={day} onChange={(e) => setDay(e.target.value || date)} />
        </label>
        <label className="field">
          <span>Time</span>
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>

      {oral ? (
        <div className="card tinted small" style={{ '--c': 'var(--indigo)' }}>
          <Icon name="pill" size={16} /> Tablet: take on an empty stomach with a small sip of water, then wait 30 minutes before food, drink or
          other tablets.
        </div>
      ) : (
        <>
          <div className="list-header" style={{ marginTop: 6 }}>
            Injection site{chosenSite ? `: ${SITE_BY_ID[chosenSite]?.label}` : ''}
          </div>
          <BodyMap value={chosenSite} onChange={pickSite} suggested={suggested} recent={(recent || []).map((r) => r.site).filter(Boolean)} />
          <p className="list-footer" style={{ margin: '6px 4px 14px' }}>
            Rotate sites each time. On the belly, stay 5 cm (2 in) from the navel. Avoid skin that’s bruised, scarred or sore.
          </p>
        </>
      )}

      <label className="field">
        <span>Notes (optional)</span>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="New pen, felt queasy after…" maxLength={500} />
      </label>

      {planChanges && (
        <label className="list" style={{ display: 'block', marginBottom: 14 }}>
          <span className="list-row">
            <span className="label">
              {plan ? 'Update my plan' : 'Set as my plan'}
              <span className="sub">{label} {formatDose(doseNum, unit)} · {FREQUENCY_LABEL[info.frequency]}</span>
            </span>
            <Switch checked={updatePlan} onChange={setUpdatePlan} label="Update my plan" />
          </span>
        </label>
      )}

      <div className="stack">
        <button className="btn block" disabled={busy || !(doseNum > 0)} onClick={save}>
          {existing ? 'Save' : `Log dose${dayLabel === 'Today' ? '' : ` · ${dayLabel}`}`}
        </button>
        {existing && (
          <button className="btn destructive block" disabled={busy} onClick={remove}>Delete</button>
        )}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------- plan

/** Set up or change the GLP-1 plan on the profile (Settings, Today, onboarding). */
export function MedicationSheet({ onClose }) {
  const { store, profile, saveProfile, toast, today, bumpData } = useApp()
  const plan = glp1Plan(profile)
  const [med, setMed] = useState(plan?.id || 'mounjaro')
  const [name, setName] = useState(plan?.id === 'other' ? plan.name : '')
  const [amount, setAmount] = useState(plan?.dose != null ? String(plan.dose) : String(MED_BY_ID.mounjaro.doses[0]))
  const [freq, setFreq] = useState(plan?.frequency || MED_BY_ID[plan?.id || 'mounjaro'].frequency)
  const [started, setStarted] = useState(plan?.startedOn || today)
  const [busy, setBusy] = useState(false)
  // No doses logged yet: offer to record the start date as dose one, so the
  // schedule, site rotation and history start from real data.
  const [noDoses, setNoDoses] = useState(false)
  const [logFirst, setLogFirst] = useState(true)
  const info = MED_BY_ID[med]

  useEffect(() => {
    let cancelled = false
    store
      .listRecentDoses(1)
      .then((rows) => !cancelled && setNoDoses(rows.length === 0))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [store])

  function changeMed(id) {
    setMed(id)
    setAmount(String(MED_BY_ID[id].doses[0] ?? ''))
    setFreq(MED_BY_ID[id].frequency)
  }

  async function save(patch, msg) {
    setBusy(true)
    try {
      await saveProfile({ ...profile, ...patch })
      if (patch.glp1_med && noDoses && logFirst && patch.glp1_started_on) {
        await store.addDose({
          log_date: patch.glp1_started_on,
          taken_at: new Date(`${patch.glp1_started_on}T09:00`).toISOString(),
          med: patch.glp1_med,
          med_name: patch.glp1_name || info.label,
          dose: patch.glp1_dose,
          unit: patch.glp1_unit,
          route: info.route,
          site: null,
          notes: 'First dose (from plan set-up)',
        })
        bumpData()
      }
      toast(msg)
      onClose()
    } catch (e) {
      bumpData()
      toast(e.message, 'error')
      setBusy(false)
    }
  }

  return (
    <Sheet title="GLP-1 medicine" onClose={onClose}>
      <MedSelect value={med} onChange={changeMed} />
      {med === 'other' && (
        <label className="field">
          <span>Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="As on the pen or box" maxLength={80} />
        </label>
      )}
      <DoseChips med={med} value={amount} onChange={setAmount} unit={info.unit} />
      <div className="grid2">
        <label className="field">
          <span>How often</span>
          <select className="input" value={freq} onChange={(e) => setFreq(e.target.value)} disabled={med !== 'other'}>
            {Object.entries(FREQUENCY_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Started</span>
          <input className="input" type="date" max={today} value={started} onChange={(e) => setStarted(e.target.value)} />
        </label>
      </div>
      {noDoses && (
        <label className="list" style={{ display: 'block', marginBottom: 14 }}>
          <span className="list-row">
            <span className="label">
              Log my first dose on {started ? formatDayLabel(started, today) : 'the start date'}
              <span className="sub">Starts your dose history and schedule. Turn off if you haven’t taken it yet.</span>
            </span>
            <Switch checked={logFirst} onChange={setLogFirst} label="Log my first dose on the start date" />
          </span>
        </label>
      )}
      <p className="list-footer" style={{ margin: '-4px 4px 14px' }}>
        {info.note} The coach uses this to tailor food, water and exercise advice. It never changes your dose: that’s for your prescriber.
      </p>
      <div className="stack">
        <button
          className="btn block"
          disabled={busy || !(Number(amount) > 0)}
          onClick={() =>
            save(
              {
                glp1_med: med,
                glp1_name: med === 'other' ? name.trim() || 'GLP-1' : null,
                glp1_dose: Number(amount),
                glp1_unit: info.unit,
                glp1_frequency: med === 'other' ? freq : info.frequency,
                glp1_started_on: started || today,
              },
              'GLP-1 plan saved',
            )
          }
        >
          Save
        </button>
        {plan && (
          <button
            className="btn gray block"
            disabled={busy}
            onClick={() =>
              save({ glp1_med: null, glp1_name: null, glp1_dose: null, glp1_unit: null, glp1_frequency: null, glp1_started_on: null }, 'GLP-1 tracking off')
            }
          >
            I’m not taking a GLP-1 now
          </button>
        )}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------- Progress section

/** GLP-1 overview on Progress: plan, next dose, weight since starting, recent doses. */
export function Glp1Progress({ onEditDose, onSetup }) {
  const { store, profile, series, today, units, dataVersion, openSheet } = useApp()
  const plan = glp1Plan(profile)
  const [doses, setDoses] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    store
      .listRecentDoses(30)
      .then((rows) => !cancelled && (setDoses(rows), setError(null)))
      .catch((e) => !cancelled && (setDoses([]), setError(e.message)))
    return () => {
      cancelled = true
    }
  }, [store, dataVersion])

  if (!plan) {
    return (
      <ListSection header="GLP-1 medicine">
        <ListRow icon="syringe" color="var(--purple)" label="Track a GLP-1 medicine" sub="Doses, injection sites and tailored coaching" onClick={onSetup} />
      </ListSection>
    )
  }

  const status = planDoseStatus(plan, doses, today)
  const startPt = plan.startedOn ? trendOn(series, plan.startedOn) || series.find((p) => p.date >= plan.startedOn) : null
  const last = series[series.length - 1]
  const change = startPt && last && last.date > startPt.date ? last.weight - startPt.weight : null
  const weeks = plan.startedOn ? Math.max(0, Math.floor(daysBetween(plan.startedOn, today) / 7)) : null
  const signed = (kg) => {
    const v = weightValue(kg, units)
    return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} ${weightUnit(units)}`
  }

  return (
    <ListSection
      header="GLP-1 medicine"
      footer="Logged for your records and for Mimi. Dose changes are your prescriber’s call."
    >
      <ListRow
        icon="syringe"
        color="var(--purple)"
        label={`${plan.name} ${formatDose(plan.dose, plan.unit)}`}
        sub={`${FREQUENCY_LABEL[plan.frequency]}${weeks != null ? ` · week ${weeks + 1}` : ''}`}
        value={doseStatusLabel(status)}
        onClick={onSetup}
      />
      {change != null && (
        <ListRow icon="trend" color="var(--green)" label="Since starting" sub={`Now ${displayWeight(last.weight, units)}`} value={signed(change)} />
      )}
      {status.assumed && doses && (
        <ListRow
          icon="plus"
          color="var(--indigo)"
          label="Add your first dose"
          sub={`Counting from your start date (${formatShortDate(plan.startedOn)}) until you do`}
          onClick={() => openSheet('dose', { date: plan.startedOn })}
        />
      )}
      {error && <div className="list-row small danger-text">{error}</div>}
      {(doses || []).slice(0, 6).map((d) => (
        <ListRow
          key={d.id}
          label={`${formatShortDate(d.log_date)} · ${formatDose(d.dose, d.unit)}`}
          sub={d.site ? SITE_BY_ID[d.site]?.label : d.route === 'oral' ? 'Tablet' : 'Site not recorded'}
          onClick={() => onEditDose(d)}
        />
      ))}
    </ListSection>
  )
}
