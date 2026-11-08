import { useEffect, useRef, useState } from 'react'
import { useApp } from '../appContext.js'
import { streamCoach } from '../lib/ai.js'
import { buildCoachContext } from '../lib/coachContext.js'
import { buildRefs } from '../lib/foodSearch.js'
import { BUILTIN_FOODS } from '../data/foods.js'
import { Icon, MiniMarkdown, Penguin, Spinner, Thinking } from './ui.jsx'

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
  const [status, setStatus] = useState('Thinking…')
  const [busy, setBusy] = useState(false)
  const endRef = useRef()
  const abortRef = useRef()

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
    if (active) endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages, streaming, status, active])

  if (mode !== 'cloud') {
    return (
      <div>
        <h1>Coach</h1>
        <div className="card warn small">
          The AI coach needs an account, because it runs on the server where the Claude API key is kept secret. Sign out from Settings
          and create an account to use it. Your local data can be exported first and imported after.
        </div>
      </div>
    )
  }

  async function send(text) {
    const question = text.trim()
    if (!question || busy) return
    setInput('')
    setBusy(true)
    setStatus('Thinking…')
    const prior = (messages || []).slice(-20).map(({ role, content }) => ({ role, content }))
    try {
      const saved = await store.addCoachMessage({ role: 'user', content: question })
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
    <div style={{ paddingBottom: 64 }}>
      <header className="page-head">
        <div>
          <div className="eyebrow">Powered by Claude</div>
          <h1>Coach</h1>
        </div>
        {messages?.length > 0 && !busy && (
          <button className="btn sm gray" onClick={clear}>Clear</button>
        )}
      </header>

      {messages === null ? (
        <div className="center" style={{ padding: 32, color: 'var(--text-3)' }}>
          <Spinner />
        </div>
      ) : (
        <div className="chat">
          {messages.length === 0 && (
            <div className="card center" style={{ paddingTop: 8 }}>
              <Penguin kind="thinking" size={130} />
              <p className="headline" style={{ marginTop: 4 }}>Ask me anything</p>
              <p className="small muted">
                About your eating, your numbers or your plan. I can see your targets, the last two weeks of logs and your weight trend, and I can
                check foods against USDA and Open Food Facts.
              </p>
              <p className="tiny muted" style={{ margin: 0 }}>
                General guidance, not medical advice. Check with your doctor if you have a medical condition or take medication.
              </p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`bubble ${m.role}`}>
              {m.role === 'assistant' ? <MiniMarkdown text={m.content} /> : m.content}
            </div>
          ))}
          {streaming !== null &&
            (streaming ? (
              <>
                <div className="bubble assistant">
                  <MiniMarkdown text={streaming} />
                  {!checking && <span className="typing" />}
                </div>
                {checking && <Thinking status={status} size={52} />}
              </>
            ) : (
              <Thinking status={status} />
            ))}
          <div ref={endRef} />
        </div>
      )}

      {!busy && (
        <div className="chips" style={{ marginTop: 14 }}>
          {PROMPTS.map(([p, c]) => (
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
              className="input grow"
              rows={1}
              placeholder="Ask your coach…"
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
