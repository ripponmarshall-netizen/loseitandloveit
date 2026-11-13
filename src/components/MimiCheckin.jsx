import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useApp } from '../appContext.js'
import { requestCheckin } from '../lib/ai.js'
import { dailyTotals, weeklyRate } from '../lib/calc.js'
import { buildCheckinContext, checkinDue, checkinFingerprint, MAX_PER_DAY } from '../lib/checkins.js'
import { addDays } from '../lib/dates.js'
import { planDoseStatus, doseStatusLabel, glp1Plan } from '../lib/glp1.js'
import { useDay } from '../lib/useDay.js'
import { useWaterTarget } from './Checkin.jsx'
import { Icon, PenguinFace } from './ui.jsx'

const FAIL_KEY = 'lili:checkin:failedAt'
const readFail = () => {
  try {
    return Number(localStorage.getItem(FAIL_KEY)) || null
  } catch {
    return null
  }
}
const writeFail = (v) => {
  try {
    if (v) localStorage.setItem(FAIL_KEY, String(v))
    else localStorage.removeItem(FAIL_KEY)
  } catch {
    /* private mode */
  }
}

// One request at a time across the app (React StrictMode runs effects twice).
let inflight = false

const SEEN_KEY = 'lili:checkin:seen'
const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY)
  } catch {
    return null
  }
}
const writeSeen = (id) => {
  try {
    localStorage.setItem(SEEN_KEY, id)
  } catch {
    /* private mode */
  }
}

const MimiCtx = createContext({ enabled: false })
export const useMimi = () => useContext(MimiCtx)

const KIND = {
  food: { icon: 'fork', color: 'var(--orange)' },
  protein: { icon: 'fork', color: 'var(--pink)' },
  water: { icon: 'drop', color: 'var(--cyan)' },
  move: { icon: 'run', color: 'var(--red)' },
  weight: { icon: 'scale', color: 'var(--indigo)' },
  mood: { icon: 'smile', color: 'var(--yellow)' },
  dose: { icon: 'syringe', color: 'var(--purple)' },
  praise: { icon: 'heart', color: 'var(--green)' },
  rest: { icon: 'moon', color: 'var(--indigo)' },
}

const timeLabel = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })

/**
 * Mimi's check-ins: every few hours (while the app is open) the AI reads a
 * small snapshot of today's log and leaves 1–3 next steps. This provider runs
 * them for the whole app; the floating penguin bubble shows when one is new,
 * and the card itself lives at the top of the Mimi section.
 */
export function MimiProvider({ children }) {
  const { store, mode, today, prefs, profile, targets, series, weights } = useApp()
  const day = useDay(today)
  const waterTarget = useWaterTarget()
  const [insight, setInsight] = useState(undefined) // undefined = loading
  const [busy, setBusy] = useState(false)
  const [off, setOff] = useState(false) // migration missing: stay quiet
  const [tick, setTick] = useState(0)
  const everyHours = Number(prefs.checkinHours ?? 3)
  const cloud = mode === 'cloud'
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (!cloud) return
    store
      .latestInsight()
      .then((i) => alive.current && setInsight(i))
      .catch((e) => {
        if (!alive.current) return
        setInsight(null)
        if (e.missingMigration) setOff(true)
      })
  }, [store, cloud])

  // Re-check every 10 minutes and whenever the app comes back to the front.
  useEffect(() => {
    const bump = () => document.visibilityState !== 'hidden' && setTick((t) => t + 1)
    const id = setInterval(bump, 10 * 60e3)
    document.addEventListener('visibilitychange', bump)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', bump)
    }
  }, [])

  useEffect(() => {
    if (!cloud || off || insight === undefined || !day || inflight || !everyHours) return
    const plan = glp1Plan(profile)
    const dose = planDoseStatus(plan, day.doses, today)
    const weighed = weights.some((w) => w.log_date === today)
    const fingerprint = checkinFingerprint({
      entries: day.entries,
      waterMl: day.daily?.water_ml || 0,
      mood: day.daily?.mood,
      workouts: day.workouts,
      weighed,
      dosesToday: dose?.takenToday || 0,
    })
    if (!checkinDue({ today, last: insight, fingerprint, everyHours, failedAt: readFail() })) return

    inflight = true
    setBusy(true)
    ;(async () => {
      try {
        const recent = await store.listInsights(MAX_PER_DAY)
        if (recent.filter((i) => i.log_date === today).length >= MAX_PER_DAY) return
        const prior = await store.listEntries(addDays(today, -3), addDays(today, -1)).catch(() => [])
        const last = series[series.length - 1]
        const rate = weeklyRate(series)
        const context = buildCheckinContext({
          today,
          profile,
          targets,
          entries: day.entries,
          waterMl: day.daily?.water_ml || 0,
          waterTarget,
          daily: day.daily,
          workouts: day.workouts,
          weighedToday: weighed,
          recentDaily: dailyTotals(prior),
          currentKg: last?.weight ?? null,
          trendKg: last?.trend ?? null,
          weeklyChangeKg: rate == null ? null : Math.round(rate * 100) / 100,
          glp1: plan ? { medicine: plan.name, next_dose: doseStatusLabel(dose) } : null,
          previous: insight?.log_date === today ? insight : null,
        })
        const res = await requestCheckin({ context })
        if (!res.tips?.length) return
        const saved = await store.addInsight({ log_date: today, headline: res.headline, tips: res.tips, fingerprint })
        writeFail(null)
        if (alive.current) setInsight(saved)
      } catch (e) {
        // Quiet by design: a missed check-in isn't worth an error toast.
        writeFail(Date.now())
        if (e.missingMigration && alive.current) setOff(true)
        console.warn('[mimi] check-in skipped:', e.message)
      } finally {
        inflight = false
        if (alive.current) setBusy(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud, off, insight, day, today, everyHours, tick])

  const [seen, setSeen] = useState(readSeen)
  const enabled = cloud && !off && !!everyHours
  const show = enabled && !!insight && insight.log_date === today && !insight.dismissed
  const unseen = show && seen !== insight.id

  const markSeen = useCallback(() => {
    if (!insight?.id) return
    writeSeen(insight.id)
    setSeen(insight.id)
  }, [insight?.id])

  const dismiss = useCallback(async () => {
    if (!insight) return
    const id = insight.id
    setInsight((i) => ({ ...i, dismissed: true }))
    try {
      await store.dismissInsight(id)
    } catch {
      /* hidden locally either way */
    }
  }, [insight, store])

  const value = { enabled, insight: show ? insight : null, busy: enabled && busy, unseen, markSeen, dismiss }
  return <MimiCtx.Provider value={value}>{children}</MimiCtx.Provider>
}

/** Floating penguin on the Dashboard: opens the Mimi section. A dot means a new check-in. */
export function MimiBubble() {
  const { setTab } = useApp()
  const { insight, busy, unseen } = useMimi()
  const [peek, setPeek] = useState(false)
  const peekedFor = useRef(null)

  // Say hello once when a new check-in lands, then tuck the label away.
  useEffect(() => {
    if (!unseen || peekedFor.current === insight.id) return
    peekedFor.current = insight.id
    setPeek(true)
    const t = setTimeout(() => setPeek(false), 5000)
    return () => clearTimeout(t)
  }, [unseen, insight?.id])

  const label = unseen ? `Mimi has a new check-in: ${insight.headline}` : busy ? 'Mimi is looking over your day' : 'Open Mimi, your AI coach'
  return (
    <div className="mimi-fab-wrap">
      {peek && unseen && (
        <button className="mimi-peek" onClick={() => setTab('coach')} tabIndex={-1} aria-hidden="true">
          <span className="ellipsis">{insight.headline}</span>
        </button>
      )}
      <button className={`mimi-fab${busy ? ' busy' : ''}${unseen ? ' unseen' : ''}`} onClick={() => setTab('coach')} aria-label={label}>
        <PenguinFace size={40} />
        {unseen && <span className="mimi-dot" aria-hidden="true" />}
      </button>
    </div>
  )
}

/** Mimi's latest check-in, shown at the bottom of the chat in the Mimi section. */
export default function MimiCheckin() {
  const { today, profile, openSheet, openAdd, askCoach } = useApp()
  const { enabled, insight, busy, dismiss } = useMimi()
  const day = useDay(today)
  if (!enabled || (!insight && !busy)) return null

  function act(kind) {
    switch (kind) {
      case 'food':
      case 'protein': return openAdd({ date: today })
      case 'water': return openSheet('water', { date: today, daily: day?.daily })
      case 'move': return openSheet('workout', { date: today })
      case 'weight': return openSheet('weight', { date: today })
      case 'mood': return openSheet('mood', { date: today, daily: day?.daily })
      case 'dose': return glp1Plan(profile) ? openSheet('dose', { date: today }) : null
      default: return null
    }
  }
  const actionable = (k) => ['food', 'protein', 'water', 'move', 'weight', 'mood'].includes(k) || (k === 'dose' && glp1Plan(profile))

  if (!insight) {
    return (
      <div className="mimi-card loading" role="status">
        <PenguinFace size={34} />
        <span className="small muted">Mimi is looking over your day…</span>
      </div>
    )
  }

  return (
    <section className="mimi-card" aria-label="Mimi’s check-in">
      <div className="mimi-head">
        <PenguinFace size={36} />
        <div className="grow">
          <div className="eyebrow">Check-in · {timeLabel(insight.created_at)}</div>
          <div className="mimi-headline">{insight.headline}</div>
        </div>
        <button className="icon-btn" aria-label="Dismiss Mimi’s check-in" onClick={dismiss}>
          <Icon name="close" size={18} strokeWidth={2.4} />
        </button>
      </div>
      <div className="mimi-tips">
        {insight.tips.map((t, i) => {
          const k = KIND[t.kind] || KIND.food
          const Tag = actionable(t.kind) ? 'button' : 'div'
          return (
            <Tag key={i} className="mimi-tip" style={{ '--c': k.color, '--i': i }} onClick={actionable(t.kind) ? () => act(t.kind) : undefined}>
              <span className="mimi-tip-icon" aria-hidden="true">
                <Icon name={k.icon} strokeWidth={2.2} />
              </span>
              <span className="grow">{t.text}</span>
              {Tag === 'button' && <Icon name="right" size={14} className="mimi-chev" />}
            </Tag>
          )
        })}
      </div>
      <button className="btn sm secondary" style={{ marginTop: 12 }} onClick={() => askCoach(`About your check-in (“${insight.headline}”): what should I do next?`)}>
        Ask Mimi more
      </button>
    </section>
  )
}
