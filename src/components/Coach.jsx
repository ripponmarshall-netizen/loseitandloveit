import { useEffect, useRef, useState } from 'react'
import { useApp } from '../appContext.js'
import { streamCoach } from '../lib/ai.js'
import { buildCoachContext } from '../lib/coachContext.js'
import { Icon, Loading, MiniMarkdown, Spinner } from './ui.jsx'

const PROMPTS = [
  'Review my last 7 days',
  'What should I eat for the rest of today?',
  'Plan my food for a 24-hour shift',
  "Why isn't my weight moving?",
  'Healthier cookshop order?',
  'Give me 3 high-protein Jamaican breakfasts',
]

export default function Coach() {
  const app = useApp()
  const { store, mode, toast } = app
  const [messages, setMessages] = useState(null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(null) // text while a reply is arriving
  const [busy, setBusy] = useState(false)
  const abortRef = useRef()
  const inputRef = useRef()
  // Follow new text only while the user is at the bottom, so scrolling up
  // to re-read an earlier answer isn't yanked back down mid-reply.
  const stickRef = useRef(true)

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
    const onScroll = () => {
      const el = document.documentElement
      stickRef.current = el.scrollHeight - (window.scrollY + window.innerHeight) < 140
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Scroll the page itself to the bottom: the layout already leaves room for
  // the fixed composer and nav, so the last message sits just above them.
  useEffect(() => {
    if (stickRef.current) window.scrollTo(0, document.documentElement.scrollHeight)
  }, [messages, streaming])

  function grow() {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, 120)}px`
  }

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
    requestAnimationFrame(grow)
    stickRef.current = true
    setBusy(true)
    const prior = (messages || []).slice(-20).map(({ role, content }) => ({ role, content }))
    try {
      const saved = await store.addCoachMessage({ role: 'user', content: question })
      setMessages((m) => [...(m || []), saved])
      setStreaming('')
      const context = await buildCoachContext({
        store,
        profile: app.profile,
        series: app.series,
        targets: app.targets,
        today: app.today,
      })
      abortRef.current = new AbortController()
      const reply = await streamCoach({
        message: question,
        history: prior,
        context,
        onText: setStreaming,
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

  return (
    <div>
      <div className="row between">
        <h1>Coach</h1>
        {messages?.length > 0 && (
          <button className="link small" onClick={clear}>
            Clear
          </button>
        )}
      </div>

      {messages === null ? (
        <Loading />
      ) : (
        <div className="chat">
          {messages.length === 0 && (
            <div className="card">
              <p>
                Ask me anything about your eating, your numbers or your plan. I can see your targets, the last two weeks of logs and your weight trend.
              </p>
              <p className="small muted" style={{ margin: 0 }}>
                General guidance, not medical advice. Check with your doctor if you have a medical condition or take medication.
              </p>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`bubble ${m.role}`}>
              {m.role === 'assistant' ? <MiniMarkdown text={m.content} /> : m.content}
            </div>
          ))}
          {streaming !== null && (
            <div className="bubble assistant">
              {streaming ? (
                <>
                  <MiniMarkdown text={streaming} />
                  <span className="typing" />
                </>
              ) : (
                <span className="typing-dots" aria-label="Coach is thinking">
                  <i />
                  <i />
                  <i />
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {!busy && (
        <div className="chips" style={{ marginTop: 12 }}>
          {PROMPTS.map((p) => (
            <button key={p} className="chip" onClick={() => send(p)}>
              {p}
            </button>
          ))}
        </div>
      )}
      <div className="coach-pad" />

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
            placeholder="Ask your coach…"
            aria-label="Message to your coach"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              grow()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) {
                e.preventDefault()
                send(input)
              }
            }}
          />
          <button className="btn" disabled={busy || !input.trim()} aria-label="Send">
            {busy ? <Spinner /> : <Icon name="send" size={22} stroke={2.4} />}
          </button>
        </div>
      </form>
    </div>
  )
}
