import { useMemo, useRef, useState } from 'react'
import { useApp } from '../appContext.js'
import { GROUPS, matchesWorkout, readAppleWorkouts } from '../lib/appleHealth.js'
import { addDays } from '../lib/dates.js'
import { workoutDetail } from './Workouts.jsx'
import { Icon, Segmented, Sheet } from './ui.jsx'

const RANGES = [
  ['30', '30 days'],
  ['90', '90 days'],
  ['365', 'Year'],
  ['all', 'All'],
]
const SHOW_MAX = 150
const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' })
const parse = (iso) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

/**
 * Apple Fitness import. The Health app's export is read on the phone (never
 * uploaded); then search, filter and pick which workouts to add.
 */
export function AppleImportSheet({ onClose }) {
  const { store, profile, currentWeightKg, units, today, toast, bumpData, prefs, setPrefs } = useApp()
  const [phase, setPhase] = useState('intro') // intro | reading | results
  const [progress, setProgress] = useState({ p: 0, n: 0 })
  const [error, setError] = useState(null)
  const [found, setFound] = useState([])
  const [have, setHave] = useState(() => new Set())
  const [picked, setPicked] = useState(() => new Set())
  const [query, setQuery] = useState('')
  const [range, setRange] = useState('90')
  const [group, setGroup] = useState('all')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef()

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setPhase('reading')
    setProgress({ p: 0, n: 0 })
    let last = 0
    try {
      const list = await readAppleWorkouts(file, {
        dayStartHour: profile.day_start_hour ?? 4,
        weightKg: currentWeightKg || Number(profile.start_weight_kg) || null,
        onProgress: (p, n) => {
          // Keep re-renders to a few a second on a big file.
          const now = Date.now()
          if (p >= 1 || now - last > 120) {
            last = now
            setProgress({ p, n })
          }
        },
      })
      const recent = list.filter((w) => w.log_date <= today)
      const oldest = recent[recent.length - 1]?.log_date
      const existing = oldest ? await store.listWorkouts(oldest, today) : []
      const ids = new Set(existing.map((w) => w.id))
      // New since the last import: ready to add with one tap.
      const since = prefs.appleLatest
      setPicked(new Set(since ? recent.filter((w) => w.log_date > since && !ids.has(w.id)).map((w) => w.id) : []))
      setHave(ids)
      setFound(recent)
      setPhase('results')
      if (!recent.length) setError('No workouts in that export.')
    } catch (err) {
      setError(err.message || 'Couldn’t read that file.')
      setPhase('intro')
    }
  }

  const groups = useMemo(() => {
    const count = {}
    for (const w of found) count[w.group] = (count[w.group] || 0) + 1
    return Object.entries(count).sort((a, b) => b[1] - a[1]).map(([g]) => g)
  }, [found])

  const shown = useMemo(() => {
    const from = range === 'all' ? '' : addDays(today, -Number(range) + 1)
    return found.filter((w) => w.log_date >= from && (group === 'all' || w.group === group) && matchesWorkout(w, query))
  }, [found, range, group, query, today])

  const selectable = shown.filter((w) => !have.has(w.id))
  const allPicked = selectable.length > 0 && selectable.every((w) => picked.has(w.id))
  const chosen = found.filter((w) => picked.has(w.id))
  const chosenKcal = chosen.reduce((s, w) => s + w.calories_burned, 0)

  const toggle = (id) =>
    setPicked((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  const toggleAll = () =>
    setPicked((s) => {
      const n = new Set(s)
      for (const w of selectable) allPicked ? n.delete(w.id) : n.add(w.id)
      return n
    })

  async function add() {
    if (!chosen.length) return
    setBusy(true)
    try {
      const { added } = await store.importWorkouts(chosen)
      setPrefs({ appleImportAt: Date.now(), appleLatest: found[0]?.log_date || prefs.appleLatest || null })
      bumpData()
      toast(added ? `Added ${added} workout${added === 1 ? '' : 's'} from Apple Fitness` : 'Those were already added')
      onClose()
    } catch (err) {
      toast(err.message, 'error')
      setBusy(false)
    }
  }

  // Month headers between rows.
  const rows = []
  let month = null
  for (const w of shown.slice(0, SHOW_MAX)) {
    const m = w.log_date.slice(0, 7)
    if (m !== month) {
      month = m
      rows.push(<div key={m} className="fit-month">{MONTH.format(parse(w.log_date))}</div>)
    }
    const done = have.has(w.id)
    const on = picked.has(w.id)
    const g = GROUPS[w.group] || GROUPS.other
    rows.push(
      <button key={w.id} type="button" className={`list-row has-icon fit-row${done ? ' done' : ''}${on ? ' on' : ''}`} disabled={done} aria-pressed={on} onClick={() => toggle(w.id)}>
        <span className="fit-check" aria-hidden="true">{(on || done) && <Icon name="check" size={14} strokeWidth={3} />}</span>
        <span className="row-icon" style={{ '--c': g.color }} aria-hidden="true">
          <Icon name={g.icon} strokeWidth={2.2} />
        </span>
        <span className="label">
          <span className="ellipsis" style={{ display: 'block' }}>{w.name}</span>
          <span className="sub ellipsis">
            {DAY.format(parse(w.log_date))} · {w.started_at.slice(11, 16)} · {workoutDetail(w, units)}
          </span>
        </span>
        <span className="fit-kcal">
          {done ? <span className="badge recent">Added</span> : <>{w.calories_burned}<span className="muted"> kcal</span></>}
        </span>
      </button>,
    )
  }

  return (
    <Sheet title="Apple Fitness" onClose={onClose} tall={phase === 'results'}>
      <input ref={fileRef} type="file" accept=".zip,.xml,application/zip,text/xml,application/xml" hidden onChange={onFile} />

      {phase === 'intro' && (
        <>
          <div className="fit-hero">
            <span className="fit-hero-icon" aria-hidden="true"><Icon name="heart" size={28} strokeWidth={2.4} /></span>
            <div>
              <div className="headline">Bring in your workouts</div>
              <p className="small muted" style={{ margin: '2px 0 0' }}>Walks, runs, strength, classes: with Apple’s own calories.</p>
            </div>
          </div>
          <ol className="fit-steps">
            <li>Open the <b>Health</b> app and tap your picture, top right.</li>
            <li>Tap <b>Export All Health Data</b>, then <b>Export</b>. It can take a few minutes.</li>
            <li>Choose <b>Save to Files</b>, then pick that <b>export.zip</b> below.</li>
          </ol>
          {error && <p className="small danger-text" role="alert">{error}</p>}
          <button className="btn block" onClick={() => fileRef.current?.click()}>
            Choose export.zip
          </button>
          <p className="list-footer" style={{ marginTop: 10 }}>
            Read on this phone and never uploaded. Only the workouts you pick are saved.
            {prefs.appleImportAt ? ` Last import ${new Date(prefs.appleImportAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}; newer workouts will be ticked for you.` : ''}
          </p>
        </>
      )}

      {phase === 'reading' && (
        <div className="fit-reading" role="status">
          <div className="headline">Reading your export…</div>
          <div className="tile-bar" style={{ '--c': 'var(--pink)' }}>
            <i style={{ width: `${Math.round(progress.p * 100)}%` }} />
          </div>
          <p className="small muted">{progress.n ? `${progress.n.toLocaleString('en-GB')} workouts found` : 'Looking for workouts'} · {Math.round(progress.p * 100)}%</p>
          <p className="tiny muted">Keep the app open. Years of data can take a minute.</p>
        </div>
      )}

      {phase === 'results' && (
        <>
          <div className="search-field" style={{ marginBottom: 10 }}>
            <Icon name="search" />
            <input className="input" type="search" placeholder="Search: run, cycle, March, Saturday…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search workouts" />
          </div>
          <div style={{ marginBottom: 10 }}>
            <Segmented value={range} onChange={setRange} options={RANGES} label="Period" />
          </div>
          {groups.length > 1 && (
            <div className="chips" style={{ marginBottom: 6 }}>
              <button type="button" className={`chip${group === 'all' ? ' tinted' : ''}`} onClick={() => setGroup('all')}>All</button>
              {groups.map((g) => (
                <button key={g} type="button" className={`chip${group === g ? ' tinted' : ''}`} style={{ '--c': GROUPS[g]?.color }} onClick={() => setGroup(group === g ? 'all' : g)}>
                  {GROUPS[g]?.label || g}
                </button>
              ))}
            </div>
          )}

          <div className="list-header row between" style={{ marginRight: 4 }}>
            <span>{shown.length.toLocaleString('en-GB')} workout{shown.length === 1 ? '' : 's'}</span>
            {selectable.length > 0 && (
              <button type="button" className="link small no-caps" onClick={toggleAll}>{allPicked ? 'Clear' : `Select ${selectable.length > SHOW_MAX ? 'all' : selectable.length}`}</button>
            )}
          </div>
          {shown.length ? (
            <div className="list fit-list">{rows}</div>
          ) : (
            <p className="list-footer">{error || 'Nothing matches. Try another word or a longer period.'}</p>
          )}
          {shown.length > SHOW_MAX && <p className="list-footer">Showing the newest {SHOW_MAX}. Search or narrow the period to see others.</p>}
          <button type="button" className="link small" style={{ margin: '14px 4px 0' }} onClick={() => fileRef.current?.click()}>Choose a different file</button>

          <div className="fit-footer">
            <button className="btn block" disabled={busy || !chosen.length} onClick={add}>
              {chosen.length ? `Add ${chosen.length} workout${chosen.length === 1 ? '' : 's'} · ${chosenKcal.toLocaleString('en-GB')} kcal` : 'Tap workouts to add them'}
            </button>
          </div>
        </>
      )}
    </Sheet>
  )
}
