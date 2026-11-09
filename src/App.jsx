import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppCtx } from './appContext.js'
import { supabase } from './lib/supabase.js'
import { createCloudStore, createLocalStore } from './lib/db.js'
import { computeTargets, trendSeries } from './lib/calc.js'
import { logicalToday } from './lib/dates.js'
import Auth from './components/Auth.jsx'
import Onboarding from './components/Onboarding.jsx'
import Today from './components/Today.jsx'
import Progress from './components/Progress.jsx'
import Coach from './components/Coach.jsx'
import Settings from './components/Settings.jsx'
import AddFood from './components/AddFood.jsx'
import { Icon, Loading } from './components/ui.jsx'

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

function guessMeal(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60
  if (h >= 4 && h < 10.5) return 'breakfast'
  if (h >= 10.5 && h < 15) return 'lunch'
  if (h >= 17 && h < 21.5) return 'dinner'
  return 'snack'
}

export default function App() {
  const [authReady, setAuthReady] = useState(false)
  const [session, setSession] = useState(null)
  const [localMode, setLocalMode] = useState(() => readMode() === 'local')
  const [profile, setProfile] = useState(undefined) // undefined = loading, null = none yet
  const [weights, setWeights] = useState([])
  const [tab, setTab] = useState('today')
  const [selectedDate, setSelectedDate] = useState(null)
  const [addFor, setAddFor] = useState(null)
  const [dataVersion, setDataVersion] = useState(0)
  const [toastMsg, setToastMsg] = useState(null)
  const [clock, setClock] = useState(() => Date.now())
  const toastTimer = useRef()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      // Arrived from a password-reset email: send them to Settings to set a new one.
      if (event === 'PASSWORD_RECOVERY') {
        setTab('settings')
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

  const userId = session?.user?.id
  const store = useMemo(() => {
    if (localMode) return createLocalStore()
    if (userId) return createCloudStore(userId)
    return null
  }, [localMode, userId])

  // toast('Saved') · toast(err.message, 'error') · toast('Deleted', 'info', { label: 'Undo', run })
  const toast = useCallback((msg, kind = 'info', action = null) => {
    clearTimeout(toastTimer.current)
    setToastMsg({ msg, kind, action, id: Date.now() })
    toastTimer.current = setTimeout(() => setToastMsg(null), action ? 5000 : kind === 'error' ? 5000 : 2500)
  }, [])

  // Each tab starts at the top, like a native tab bar.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [tab])

  const reloadWeights = useCallback(async () => {
    if (!store) return
    try {
      setWeights(await store.listWeights())
    } catch (e) {
      toast(e.message, 'error')
    }
  }, [store, toast])

  useEffect(() => {
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
        if (cancelled) return
        toast(e.message, 'error')
        setProfile(null)
      })
    return () => {
      cancelled = true
    }
  }, [store, toast])

  const saveProfile = useCallback(
    async (p) => {
      const saved = await store.saveProfile(p)
      setProfile(saved)
      return saved
    },
    [store],
  )

  const series = useMemo(() => trendSeries(weights), [weights])
  const currentWeight = series.length ? series[series.length - 1].trend : Number(profile?.start_weight_kg) || null
  const targets = useMemo(
    () => (profile ? computeTargets(profile, currentWeight) : null),
    [profile, currentWeight],
  )
  const today = useMemo(() => logicalToday(profile?.day_start_hour ?? 4, new Date(clock)), [profile, clock])
  const date = selectedDate ?? today

  const signOut = useCallback(async () => {
    if (localMode) {
      writeMode(null)
      setLocalMode(false)
    } else {
      await supabase.auth.signOut()
    }
    setTab('today')
    setSelectedDate(null)
  }, [localMode])

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
    targets,
    today,
    date,
    setDate: (d) => setSelectedDate(d === today ? null : d),
    units: profile?.units || 'imperial',
    reloadWeights,
    toast,
    dataVersion,
    bumpData: () => setDataVersion((v) => v + 1),
    // From Today, add to the day being viewed; from any other tab, add to today.
    openAdd: (opts = {}) => setAddFor({ date: tab === 'today' ? date : today, meal: opts.meal || guessMeal(), tab: opts.tab }),
    signOut,
    setTab,
  }

  let body
  if (!authReady && !localMode) {
    body = <Loading page />
  } else if (!store) {
    body = <Auth onUseLocal={enterLocalMode} />
  } else if (profile === undefined) {
    body = <Loading page />
  } else if (profile === null) {
    body = (
      <div className="screen">
        <Onboarding />
      </div>
    )
  } else {
    body = (
      <>
        <div className="screen" key={tab}>
          {tab === 'today' && <Today />}
          {tab === 'progress' && <Progress />}
          {tab === 'coach' && <Coach />}
          {tab === 'settings' && <Settings />}
        </div>
        <nav className="nav" aria-label="Main">
          <div className="nav-inner">
            <NavBtn id="today" icon="today" label="Today" tab={tab} setTab={setTab} />
            <NavBtn id="progress" icon="progress" label="Progress" tab={tab} setTab={setTab} />
            <button className="add" aria-label="Add food" onClick={() => ctx.openAdd()}>
              <Icon name="plus" size={28} stroke={2.6} />
            </button>
            <NavBtn id="coach" icon="coach" label="Coach" tab={tab} setTab={setTab} />
            <NavBtn id="settings" icon="settings" label="Settings" tab={tab} setTab={setTab} />
          </div>
        </nav>
        {addFor && <AddFood {...addFor} onClose={() => setAddFor(null)} />}
      </>
    )
  }

  return (
    <AppCtx.Provider value={ctx}>
      <main className="app">{body}</main>
      {/* Always mounted so screen readers announce each new message. */}
      <div className={`toast-region${tab === 'coach' && profile ? ' raised' : ''}`} role="status" aria-live="polite">
        {toastMsg && (
          <div key={toastMsg.id} className={`toast ${toastMsg.kind === 'error' ? 'error' : ''}`}>
            <span>{toastMsg.msg}</span>
            {toastMsg.action && (
              <button
                type="button"
                onClick={() => {
                  setToastMsg(null)
                  toastMsg.action.run()
                }}
              >
                {toastMsg.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </AppCtx.Provider>
  )
}

function NavBtn({ id, icon, label, tab, setTab }) {
  return (
    <button className={tab === id ? 'on' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
      <Icon name={icon} size={24} stroke={tab === id ? 2.3 : 1.9} />
      {label}
    </button>
  )
}
