import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { exactProfile } from './lib/profileForm.js'
import { AppCtx } from './appContext.js'
import { supabase } from './lib/supabase.js'
import { createCloudStore, createLocalStore } from './lib/db.js'
import { computeTargets, trendSeries, latestWeight } from './lib/calc.js'
import { logicalToday } from './lib/dates.js'
import Auth from './components/Auth.jsx'
import Onboarding from './components/Onboarding.jsx'
import Today from './components/Today.jsx'
import Progress from './components/Progress.jsx'
import Coach from './components/Coach.jsx'
import Settings from './components/Settings.jsx'
import AddFood from './components/AddFood.jsx'
import LogSheet from './components/LogSheet.jsx'
import { MealBreakdownSheet } from './components/MealBreakdown.jsx'
import { WorkoutSheet } from './components/Workouts.jsx'
import { MoodSheet, WaterSheet, WeightSheet } from './components/Checkin.jsx'
import { DoseSheet, MedicationSheet } from './components/Glp1.jsx'
import { MimiBubble, MimiProvider } from './components/MimiCheckin.jsx'
import { Icon, PenguinFace, PenguinLoader } from './components/ui.jsx'
import { applyTheme, readPrefs, writePrefs } from './lib/prefs.js'
import { guessMeal } from './lib/quicklog.js'
import { watchKeyboard } from './lib/viewport.js'
import { buildMilestones } from './lib/milestones.js'
import { milestoneLabel } from './components/Milestones.jsx'

const MODE_KEY = 'lili:mode'
const readMode = () => {
  try {
    return localStorage.getItem(MODE_KEY)
  } catch {
    return null
  }
}
const writeMode = (m) => {
  try {
    if (m) localStorage.setItem(MODE_KEY, m)
    else localStorage.removeItem(MODE_KEY)
  } catch {
    /* private mode: fine, just won't persist */
  }
}

// Who was last signed in on this device. With no signal Supabase can't
// refresh an expired session, but their data is on the device and anything
// they log waits in the outbox, so the app opens for them anyway.
const USER_KEY = 'lili:user'
const readUser = () => {
  try {
    return localStorage.getItem(USER_KEY)
  } catch {
    return null
  }
}
const writeUser = (id) => {
  try {
    if (id) localStorage.setItem(USER_KEY, id)
    else localStorage.removeItem(USER_KEY)
  } catch {
    /* private mode */
  }
}

// Every bottom sheet the app opens from more than one place.
const SHEETS = {
  log: LogSheet,
  food: AddFood,
  workout: WorkoutSheet,
  water: WaterSheet,
  mood: MoodSheet,
  weight: WeightSheet,
  dose: DoseSheet,
  medication: MedicationSheet,
  meal: MealBreakdownSheet,
}

/**
 * Safari-style tab bar: slides away while you scroll down to read, and
 * comes back when you scroll up, reach the top or bottom, or touch the
 * bottom edge of the screen.
 */
function useAutoHideTabBar(enabled, resetKey) {
  const [hidden, setHidden] = useState(false)
  const holdUntil = useRef(0)
  // Switching tabs (and the smooth scroll that can follow, e.g. Dashboard →
  // a Progress chart) must never hide the bar: only the user's own scrolling does.
  useEffect(() => {
    setHidden(false)
    holdUntil.current = Date.now() + 1200
  }, [resetKey])
  useEffect(() => {
    if (!enabled) {
      setHidden(false)
      return
    }
    let lastY = window.scrollY
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const y = window.scrollY
        if (Date.now() < holdUntil.current) {
          lastY = y
          return
        }
        const atBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 24
        if (y < 40 || atBottom) setHidden(false)
        else if (y > lastY + 6) setHidden(true)
        else if (y < lastY - 6) setHidden(false)
        lastY = y
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
    }
  }, [enabled])
  return [hidden, setHidden]
}

export default function App() {
  const [authReady, setAuthReady] = useState(false)
  const [session, setSession] = useState(null)
  const [knownUser, setKnownUser] = useState(readUser)
  const [loadError, setLoadError] = useState(null)
  const [loadTry, setLoadTry] = useState(0)
  const [sync, setSync] = useState(null) // cloud mode: { pending, syncing, offline, syncedAt, error }
  const [localMode, setLocalMode] = useState(() => readMode() === 'local')
  const [rawProfile, setProfile] = useState(undefined) // undefined = loading, null = none yet
  // Start and goal weights as they were entered (see exactWeightKg).
  const profile = useMemo(() => exactProfile(rawProfile), [rawProfile])
  const [weights, setWeights] = useState([])
  const [tab, setTab] = useState('today')
  const [selectedDate, setSelectedDate] = useState(null)
  const [sheet, setSheet] = useState(null) // { type, props }
  const [coachAsk, setCoachAsk] = useState(null) // { text, id } handed to the Coach tab
  const [dataVersion, setDataVersion] = useState(0)
  const [toastMsg, setToastMsg] = useState(null)
  const [progressFocus, setProgressFocus] = useState(null) // { section, id } from a Dashboard card
  const [clock, setClock] = useState(() => Date.now())
  const [prefs, setPrefsState] = useState(readPrefs)
  // Tabs stay mounted once visited, so a coach reply keeps streaming and
  // scroll positions survive when you switch tabs.
  const [visited, setVisited] = useState(() => new Set(['today']))
  const toastTimer = useRef()

  // Keep sheets and the composer above the iPhone keyboard.
  useEffect(() => watchKeyboard(), [])

  useEffect(() => {
    applyTheme(prefs.theme)
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme(prefs.theme)
    mq?.addEventListener?.('change', onChange)
    return () => mq?.removeEventListener?.('change', onChange)
  }, [prefs.theme])

  const setPrefs = useCallback((patch) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch }
      writePrefs(next)
      return next
    })
  }, [])

  const tabRef = useRef('today')
  const scrollPos = useRef({})
  const goTab = useCallback((t) => {
    if (t === tabRef.current) return window.scrollTo({ top: 0, behavior: 'smooth' }) // tap again: back to top
    scrollPos.current[tabRef.current] = window.scrollY
    tabRef.current = t
    setTab(t)
    setVisited((v) => (v.has(t) ? v : new Set(v).add(t)))
    requestAnimationFrame(() => window.scrollTo({ top: scrollPos.current[t] || 0 }))
  }, [])

  useEffect(() => {
    const remember = (id) => {
      writeUser(id)
      setKnownUser(id)
    }
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        setSession(data.session)
        if (data.session) remember(data.session.user.id)
        else if (!error) remember(null) // really signed out, not just offline
      })
      .catch(() => {})
      .finally(() => setAuthReady(true))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (s) remember(s.user.id)
      else if (event === 'SIGNED_OUT') remember(null)
      // Arrived from a password-reset email: send them to Settings to set a new one.
      if (event === 'PASSWORD_RECOVERY') {
        goTab('settings')
        setTimeout(() => toast('Choose a new password under Account → Change password'), 500)
      }
    })
    return () => sub.subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-evaluate "today" when the app comes back to the foreground and once a minute.
  useEffect(() => {
    const tick = () => setClock(Date.now())
    const id = setInterval(tick, 60000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])

  const userId = session?.user?.id ?? knownUser
  const store = useMemo(() => {
    if (localMode) return createLocalStore()
    if (userId) return createCloudStore(userId)
    return null
  }, [localMode, userId])

  // toast('Saved') · toast(e.message, 'error') · toast('Deleted', 'info', { label: 'Undo', run })
  const dismissToast = useCallback(() => {
    clearTimeout(toastTimer.current)
    setToastMsg((t) => t && { ...t, leaving: true })
    toastTimer.current = setTimeout(() => setToastMsg(null), 260)
  }, [])
  const toast = useCallback((msg, kind = 'info', action = null) => {
    clearTimeout(toastTimer.current)
    setToastMsg({ msg, kind, action, id: Date.now() })
    // Slide out, then unmount (it used to vanish mid-frame). An Undo stays a little longer.
    toastTimer.current = setTimeout(dismissToast, action ? 5000 : kind === 'error' ? 5000 : 2500)
  }, [dismissToast])

  const reloadWeights = useCallback(async () => {
    if (!store) return
    try {
      setWeights(await store.listWeights())
    } catch (e) {
      toast(e.message, 'error')
    }
  }, [store, toast])

  useEffect(() => {
    setLoadError(null)
    if (!store) {
      setProfile(undefined)
      setWeights([])
      return
    }
    let cancelled = false
    setProfile(undefined)
    Promise.all([store.getProfile(), store.listWeights()])
      .then(([p, w]) => {
        if (cancelled) return
        setProfile(p ?? null)
        setWeights(w)
      })
      .catch((e) => {
        // Never fall through to onboarding here: "couldn't load" is not "no profile".
        if (!cancelled) setLoadError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [store, loadTry])

  // Cloud mode: the store syncs in the background. Refresh the screens when
  // the account brought changes, and keep the sync status for the UI.
  useEffect(() => {
    if (!store?.subscribe) {
      setSync(null)
      return
    }
    setSync(store.syncStatus())
    return store.subscribe((event) => {
      if (event.type === 'status') setSync(store.syncStatus())
      else if (event.type === 'error') toast(event.message, 'error')
      else if (event.type === 'change') {
        Promise.all([store.getProfile(), store.listWeights()])
          .then(([p, w]) => {
            setProfile((cur) => (cur === undefined ? cur : p ?? null))
            setWeights(w)
            setDataVersion((v) => v + 1)
          })
          .catch(() => {})
      }
    })
  }, [store, toast])

  const saveProfile = useCallback(
    async (p) => {
      try {
        const saved = await store.saveProfile(p)
        setProfile(saved)
        return saved
      } catch (e) {
        if (e.saved) setProfile(e.saved) // saved apart from columns a migration adds
        throw e
      }
    },
    [store],
  )

  const series = useMemo(() => trendSeries(weights), [weights])
  const currentWeight = latestWeight(series) ?? (Number(profile?.start_weight_kg) || null)
  const targets = useMemo(
    () => (profile ? computeTargets(profile, currentWeight) : null),
    [profile, currentWeight],
  )
  const today = useMemo(() => logicalToday(profile?.day_start_hour ?? 4, new Date(clock)), [profile, clock])

  // A weigh-in that moves the trend past a milestone gets a cheer straight away.
  // The baseline resets when the plan (start, goal, units) changes, so editing
  // the profile never announces milestones.
  const msUnits = profile?.units || 'imperial'
  const msPlan = profile ? `${profile.start_weight_kg}|${profile.goal_weight_kg}|${msUnits}` : null
  const reachedMs = useMemo(
    () => (msPlan ? buildMilestones({ startKg: profile.start_weight_kg, goalKg: profile.goal_weight_kg, series, units: msUnits }).filter((m) => m.reached) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [msPlan, series],
  )
  const msBaseline = useRef({ plan: null, ids: null })
  useEffect(() => {
    if (!reachedMs) return
    const base = msBaseline.current
    const ids = reachedMs.map((m) => m.id)
    if (base.plan !== msPlan || !base.ids) {
      msBaseline.current = { plan: msPlan, ids }
      return
    }
    const added = reachedMs.filter((m) => !base.ids.includes(m.id))
    msBaseline.current = { plan: msPlan, ids }
    if (added.length) {
      const m = added[added.length - 1]
      const msg = m.kind === 'goal' ? '🏆 Goal reached! Amazing work.' : `🎉 Milestone reached: ${m.kind === 'health' ? `${m.pct}% lighter` : milestoneLabel(m, msUnits)}`
      // After the sheet's own "Weight saved" toast, which would otherwise replace this one.
      setTimeout(() => toast(msg), 1400)
    }
  }, [reachedMs, msPlan, msUnits, toast])
  const date = selectedDate ?? today

  const signOut = useCallback(async () => {
    if (localMode) {
      writeMode(null)
      setLocalMode(false)
    } else {
      // Offline, Supabase can't end the session on the server; forget it here regardless.
      await supabase.auth.signOut().catch(() => {})
      writeUser(null)
      setKnownUser(null)
      setSession(null)
    }
    setTab('today')
    tabRef.current = 'today'
    setVisited(new Set(['today']))
    setSelectedDate(null)
    setSheet(null)
    setCoachAsk(null)
    setProgressFocus(null)
  }, [localMode])

  const openSheet = useCallback((type, props = {}) => setSheet({ type, props, id: Date.now() }), [])
  const closeSheet = useCallback(() => setSheet(null), [])
  const askCoach = useCallback(
    (text) => {
      setCoachAsk({ text: String(text || '').trim(), id: Date.now() })
      goTab('coach')
    },
    [goTab],
  )
  const openProgress = useCallback(
    (section) => {
      setProgressFocus({ section, id: Date.now() })
      goTab('progress')
    },
    [goTab],
  )
  const [tabbarHidden, setTabbarHidden] = useAutoHideTabBar(tab !== 'coach' && !!store && !!profile, tab)

  const enterLocalMode = useCallback(() => {
    writeMode('local')
    setLocalMode(true)
  }, [])

  const ctx = {
    store,
    mode: store?.mode,
    session,
    profile,
    saveProfile,
    weights,
    series,
    currentWeightKg: currentWeight,
    targets,
    today,
    date,
    setDate: (d) => setSelectedDate(d === today ? null : d),
    units: profile?.units || 'imperial',
    reloadWeights,
    toast,
    dataVersion,
    bumpData: () => setDataVersion((v) => v + 1),
    openAdd: (opts = {}) => openSheet('food', { date, ...opts, meal: opts.meal || (date === today ? guessMeal() : 'dinner') }),
    openSheet,
    askCoach,
    coachAsk,
    clearCoachAsk: () => setCoachAsk(null),
    signOut,
    setTab: goTab,
    openProgress,
    progressFocus,
    prefs,
    setPrefs,
    sync,
  }

  let body
  if (store && loadError) {
    body = (
      <div className="load-error">
        <PenguinFace size={72} />
        <h2>Couldn’t load your data</h2>
        <p>{loadError}</p>
        <button type="button" className="btn" onClick={() => setLoadTry((n) => n + 1)}>Try again</button>
        <button type="button" className="link small" onClick={signOut}>Sign out</button>
      </div>
    )
  } else if ((!authReady && !store) || (store && profile === undefined)) {
    body = <PenguinLoader />
  } else if (!store) {
    body = <Auth onUseLocal={enterLocalMode} />
  } else if (profile === null) {
    body = <Onboarding />
  } else {
    const show = (id) => (visited.has(id) || tab === id) && (
      <div key={id} hidden={tab !== id} className={tab === id ? 'page' : undefined}>
        {id === 'today' && <Today />}
        {id === 'progress' && <Progress />}
        {id === 'coach' && <Coach active={tab === 'coach'} />}
        {id === 'settings' && <Settings />}
      </div>
    )
    body = (
      <MimiProvider>
        <SyncPill sync={sync} />
        {['today', 'progress', 'coach', 'settings'].map(show)}
        {(tab === 'today' || tab === 'progress') && <MimiBubble lowered={tabbarHidden} />}
        {/* Touching the bottom edge brings a hidden tab bar back. */}
        {tabbarHidden && <div className="tabbar-reveal" onTouchStart={() => setTabbarHidden(false)} onClick={() => setTabbarHidden(false)} aria-hidden="true" />}
        <nav className={`tabbar${tabbarHidden ? ' hidden' : ''}`} aria-label="Main">
          <div className="tabbar-inner">
            <TabBtn id="today" icon="grid" label="Dashboard" tab={tab} setTab={goTab} />
            <TabBtn id="progress" icon="trend" label="Progress" tab={tab} setTab={goTab} />
            <button className="tab-add" aria-label="Log food, drink, water, exercise, mood or a dose" onClick={() => openSheet('log', { date })}>
              <Icon name="plus" strokeWidth={2.8} />
            </button>
            <TabBtn id="coach" label="Mimi" tab={tab} setTab={goTab} face />
            <TabBtn id="settings" icon="gear" label="Settings" tab={tab} setTab={goTab} />
          </div>
        </nav>
        {sheet && SHEETS[sheet.type] && (() => {
          const S = SHEETS[sheet.type]
          return <S key={sheet.id} date={date} {...sheet.props} onClose={closeSheet} />
        })()}
      </MimiProvider>
    )
  }

  return (
    <AppCtx.Provider value={ctx}>
      <main className={`app${store && profile ? '' : ' bare'}`}>{body}</main>
      {toastMsg && (
        <div
          key={toastMsg.id}
          className={`toast${toastMsg.kind === 'error' ? ' error' : ''}${toastMsg.leaving ? ' leaving' : ''}`}
          role={toastMsg.kind === 'error' ? 'alert' : 'status'}
        >
          <span>{toastMsg.msg}</span>
          {toastMsg.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                dismissToast()
                toastMsg.action.run()
              }}
            >
              {toastMsg.action.label}
            </button>
          )}
        </div>
      )}
    </AppCtx.Provider>
  )
}

// Shown only when there's something to know: no signal, or changes still
// waiting to reach the account. Silent when everything is in step.
function SyncPill({ sync }) {
  const [late, setLate] = useState(false)
  const waiting = !!sync && sync.pending > 0 && !sync.offline
  // A normal save syncs within a second or two; only mention it if it drags.
  useEffect(() => {
    if (!waiting) return setLate(false)
    const id = setTimeout(() => setLate(true), 6000)
    return () => clearTimeout(id)
  }, [waiting])
  if (!sync) return null
  const n = sync.pending
  const offline = sync.offline || (typeof navigator !== 'undefined' && navigator.onLine === false)
  if (!offline && !(waiting && late)) return null
  const text = offline
    ? n ? `Offline · ${n} change${n === 1 ? '' : 's'} saved on this phone` : 'Offline · showing what’s on this phone'
    : `Syncing ${n} change${n === 1 ? '' : 's'}…`
  return (
    <div className={`sync-pill${offline ? ' offline' : ''}`} role="status">
      <Icon name={offline ? 'cloudOff' : 'cloud'} size={15} strokeWidth={2} />
      {text}
    </div>
  )
}

function TabBtn({ id, icon, label, tab, setTab, face }) {
  return (
    <button className={`tab${tab === id ? ' on' : ''}${face ? ' tab-face' : ''}`} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
      {face ? <PenguinFace size={28} /> : <Icon name={icon} strokeWidth={tab === id ? 2.3 : 1.8} />}
      {label}
    </button>
  )
}
