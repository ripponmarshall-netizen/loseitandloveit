import { useEffect, useRef, useState } from 'react'
import { useApp } from '../appContext.js'
import { streamCoach } from '../lib/ai.js'
import { buildCoachContext } from '../lib/coachContext.js'
import { buildRefs } from '../lib/foodSearch.js'
import { BUILTIN_FOODS } from '../data/foods.js'
import { glp1Plan } from '../lib/glp1.js'
import { Avatar, Icon, MiniMarkdown, Penguin, PenguinFace, Spinner, Thinking } from './ui.jsx'
import MimiCheckin, { useMimi } from './MimiCheckin.jsx'

const GLP1_PROMPTS = [
  ['What should I eat on dose day?', 'var(--purple)'],
  ['Help me with nausea', 'var(--green)'],
  ['Am I eating enough protein?', 'var(--pink)'],
  ['Exercise plan to keep muscle on my GLP-1', 'var(--orange)'],
  ['Review my last 7 days', 'var(--blue)'],
  ['Small high-protein Jamaican meals', 'var(--teal)'],
]

const PROMPTS = [
  ['Review my last 7 days', 'var(--blue)'],
  ['What should I eat for the rest of today?', 'var(--green)'],
  ['Plan my food for a 24-hour shift', 'var(--orange)'],
  ["Why isn't my weight moving?", 'var(--purple)'],
  ['Healthier cookshop order?', 'var(--pink)'],
  ['Give me 3 high-protein Jamaican breakfasts', 'var(--teal)'],
]

export default function Coach({ active = true }) {
  const app = useApp()
  const { store, mode, toast, prefs } = app
  const [messages, setMessages] = useState(null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(null) // text while a reply is arriving
  const [status, setStatus] = useState('Mimi is thinking…')
  const [busy, setBusy] = useState(false)
  const abortRef = useRef()
  // Follow new text only while you're at the bottom, so scrolling up to
  // re-read an answer isn't yanked back down mid-reply.
  const stickRef = useRef(true)
  const inputRef = useRef()
  const onGlp1 = !!glp1Plan(app.profile)
  const mimi = useMimi()

  // Opening the Mimi section reads the latest check-in (clears the bubble's dot).
  useEffect(() => {
    if (active && mimi.unseen) mimi.markSeen()
  }, [active, mimi])

  useEffect(() => {
    store
      .listCoachMessages(60)
      .then(setMessages)
      .catch((e) => {
        toast(e.message, 'error')
        setMessages([])
      })
    return () => abortRef.current?.abort()
  }, [store, toast])

  useEffect(() => {
    if (!active) return
    const onScroll = () => {
      const el = document.documentElement
      stickRef.current = el.scrollHeight - (window.scrollY + window.innerHeight) < 160
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [active])

  // Scroll the page to its end, not an end marker into view: the page's
  // bottom padding clears the fixed composer and tab bar, so the newest
  // message lands just above them instead of underneath.
  useEffect(() => {
    if (!active || !stickRef.current) return
    const top = document.documentElement.scrollHeight
    window.scrollTo({ top, behavior: streaming ? 'auto' : 'smooth' })
  }, [messages, streaming, status, active])

  // A question asked from elsewhere (e.g. a check-in): send it once the history has loaded
  // (so it lands after earlier messages), or just focus the box.
  const ask = app.coachAsk
  useEffect(() => {
    if (!ask || !active || messages === null) return
    app.clearCoachAsk()
    if (ask.text && mode === 'cloud') send(ask.text)
    else setTimeout(() => inputRef.current?.focus(), 350)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask?.id, active, messages === null])

  if (mode !== 'cloud') {
    return (
      <div>
        <h1>Mimi</h1>
        <div className="center" style={{ marginBottom: 8 }}>
          <Penguin kind="thinking" size={130} />
        </div>
        <div className="card warn small">
          Mimi the Penguin, your AI coach, needs an account, because the AI runs on the server where the Claude API key is kept secret. Sign out from Settings
          and create an account to use it. Your local data can be exported first and imported after.
        </div>
      </div>
    )
  }

  async function send(text) {
    const question = text.trim()
    if (!question || busy) return
    setInput('')
    stickRef.current = true
    setBusy(true)
    setStatus('Mimi is thinking…')
    const prior = (messages || []).slice(-20).map(({ role, content }) => ({ role, content }))
    let saved
    try {
      saved = await store.addCoachMessage({ role: 'user', content: question })
    } catch (e) {
      setInput(question) // nothing was sent: give the text back
      toast(e.message, 'error')
      setBusy(false)
      return
    }
    try {
      setMessages((m) => [...(m || []), saved])
      setStreaming('')
      const [context, mine] = await Promise.all([
        buildCoachContext({ store, profile: app.profile, series: app.series, targets: app.targets, today: app.today }),
        store.listFoods().catch(() => []),
      ])
      abortRef.current = new AbortController()
      const reply = await streamCoach({
        message: question,
        history: prior,
        context,
        refs: buildRefs(BUILTIN_FOODS, mine),
        sources: { usda: prefs.usda, off: prefs.off },
        onText: setStreaming,
        onStatus: setStatus,
        signal: abortRef.current.signal,
      })
      if (reply.trim()) {
        const savedReply = await store.addCoachMessage({ role: 'assistant', content: reply })
        setMessages((m) => [...(m || []), savedReply])
      } else {
        toast('No reply came back. Try asking again.', 'error')
      }
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message, 'error')
    } finally {
      setStreaming(null)
      setBusy(false)
    }
  }

  async function clear() {
    if (!window.confirm('Clear the whole conversation?')) return
    try {
      await store.clearCoachMessages()
      setMessages([])
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const checking = status.startsWith('Checking')

  return (
    <div>
      <header className="page-head">
        <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
          <PenguinFace size={44} />
          <div>
            <div className="eyebrow">Your coach · Mimi the Penguin</div>
            <h1>Mimi</h1>
          </div>
        </div>
        {messages?.length > 0 && !busy && (
          <button className="btn sm gray" onClick={clear}>Clear</button>
        )}
      </header>

      <MimiCheckin />

      {messages === null ? (
        <div className="center" style={{ padding: 32, color: 'var(--text-3)' }}>
          <Spinner />
        </div>
      ) : (
        <div className="chat">
          {messages.length === 0 && (
            <div className="card center" style={{ paddingTop: 8 }}>
              <Penguin kind="thinking" size={130} />
              <p className="headline" style={{ marginTop: 4 }}>Hi, I’m Mimi the Penguin</p>
              <p className="small muted">
                Your coach. Ask me about food, exercise, your numbers{onGlp1 ? ', your GLP-1 medicine' : ''} or how you’re feeling. I can see your targets, the last two weeks of
                logs, check-ins and weight trend, and I check foods against USDA and Open Food Facts.
              </p>
              <p className="tiny muted" style={{ margin: 0 }}>
                General guidance, not medical advice. Check with your doctor if you have a medical condition or take medication.
              </p>
            </div>
          )}
          {messages.map((m, i) =>
            m.role === 'assistant' ? (
              <div key={m.id} className="bubble-row">
                {/* Penguin beside the first reply in a run */}
                {messages[i - 1]?.role !== 'assistant' ? <PenguinFace size={28} className="bubble-face" /> : <span className="bubble-face" />}
                <div className="bubble assistant">
                  <MiniMarkdown text={m.content} />
                </div>
              </div>
            ) : (
              <div key={m.id} className="bubble-row mine">
                <div className="bubble user">{m.content}</div>
                {messages[i + 1]?.role !== 'user' ? <Avatar profile={app.profile} size={28} className="bubble-face" /> : <span className="bubble-face" />}
              </div>
            ),
          )}
          {streaming !== null &&
            (streaming ? (
              <>
                <div className="bubble-row">
                  <PenguinFace size={28} className="bubble-face" />
                  <div className="bubble assistant">
                    <MiniMarkdown text={streaming} />
                    {!checking && <span className="typing" />}
                  </div>
                </div>
                {checking && <Thinking status={status} size={52} />}
              </>
            ) : (
              <Thinking status={status} />
            ))}
        </div>
      )}

      {!busy && (
        <div className="chips" style={{ marginTop: 14 }}>
          {(onGlp1 ? GLP1_PROMPTS : PROMPTS).map(([p, c]) => (
            <button key={p} className="chip tinted" style={{ '--c': c }} onClick={() => send(p)}>
              {p}
            </button>
          ))}
        </div>
      )}

      {active && (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault()
            send(input)
          }}
        >
          <div className="composer-inner">
            <textarea
              ref={inputRef}
              className="input grow"
              rows={1}
              placeholder="Ask Mimi anything…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) {
                  e.preventDefault()
                  send(input)
                }
              }}
            />
            <button className="send-btn" disabled={busy || !input.trim()} aria-label="Send">
              {busy ? <Spinner /> : <Icon name="up" strokeWidth={2.6} />}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
