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
import { Icon, PenguinLoader } from './components/ui.jsx'
import { applyTheme, readPrefs, writePrefs } from './lib/prefs.js'

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
  const [prefs, setPrefsState] = useState(readPrefs)
  // Tabs stay mounted once visited, so a coach reply keeps streaming and
  // scroll positions survive when you switch tabs.
  const [visited, setVisited] = useState(() => new Set(['today']))
  const toastTimer = useRef()

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
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
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

  const userId = session?.user?.id
  const store = useMemo(() => {
    if (localMode) return createLocalStore()
    if (userId) return createCloudStore(userId)
    return null
  }, [localMode, userId])

  const toast = useCallback((msg, kind = 'info') => {
    clearTimeout(toastTimer.current)
    setToastMsg({ msg, kind, id: Date.now() })
    toastTimer.current = setTimeout(() => setToastMsg(null), kind === 'error' ? 5000 : 2500)
  }, [])

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
    tabRef.current = 'today'
    setVisited(new Set(['today']))
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
    openAdd: (opts = {}) => setAddFor({ date, meal: opts.meal || guessMeal(), tab: opts.tab }),
    signOut,
    setTab: goTab,
    prefs,
    setPrefs,
  }

  let body
  if ((!authReady && !localMode) || (store && profile === undefined)) {
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
      <>
        {['today', 'progress', 'coach', 'settings'].map(show)}
        <nav className="tabbar" aria-label="Main">
          <div className="tabbar-inner">
            <TabBtn id="today" icon="today" label="Today" tab={tab} setTab={goTab} />
            <TabBtn id="progress" icon="trend" label="Progress" tab={tab} setTab={goTab} />
            <button className="tab-add" aria-label="Add food" onClick={() => ctx.openAdd()}>
              <Icon name="plus" strokeWidth={2.8} />
            </button>
            <TabBtn id="coach" icon="chat" label="Coach" tab={tab} setTab={goTab} />
            <TabBtn id="settings" icon="gear" label="Settings" tab={tab} setTab={goTab} />
          </div>
        </nav>
        {addFor && <AddFood {...addFor} onClose={() => setAddFor(null)} />}
      </>
    )
  }

  return (
    <AppCtx.Provider value={ctx}>
      <main className={`app${store && profile ? '' : ' bare'}`}>{body}</main>
      {toastMsg && (
        <div key={toastMsg.id} className={`toast ${toastMsg.kind === 'error' ? 'error' : ''}`} role="status">
          {toastMsg.msg}
        </div>
      )}
    </AppCtx.Provider>
  )
}

function TabBtn({ id, icon, label, tab, setTab }) {
  return (
    <button className={`tab${tab === id ? ' on' : ''}`} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
      <Icon name={icon} strokeWidth={tab === id ? 2.3 : 1.8} />
      {label}
    </button>
  )
}
