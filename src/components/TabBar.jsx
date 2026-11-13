import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SPRINGS, animateSpring } from '../lib/spring.js'
import { Icon, PenguinFace } from './ui.jsx'

const TABS = [
  { id: 'today', icon: 'grid', label: 'Dashboard' },
  { id: 'progress', icon: 'trend', label: 'Progress' },
  { id: 'log', icon: 'plus', label: 'Log', action: true },
  { id: 'coach', label: 'Mimi', face: true },
  { id: 'settings', icon: 'gear', label: 'Settings' },
]

const SCRUB_PX = 8 // a drag this far along the bar slides the lens instead of tapping

/**
 * The tab bar: always on screen, frosted glass, Log in the middle. A lens
 * slides to the current tab on a spring and stretches with its speed; drag
 * along the bar to slide it yourself and let go on a tab to open it.
 */
export default function TabBar({ tab, setTab, onLog, shrink = true }) {
  const barRef = useRef()
  const compact = useCompactOnScroll(shrink, tab)
  const lensRef = useRef()
  const items = useRef({})
  const anim = useRef(null)
  const pos = useRef(null) // { x, w } where the lens is now
  const drag = useRef(null)
  const suppressClick = useRef(false)

  const paint = useCallback((x, v = 0) => {
    const el = lensRef.current
    if (!el || !pos.current) return
    pos.current.x = x
    // Stretch along the motion, squash across it (volume kept), like a drop of liquid.
    const s = Math.min(0.22, Math.abs(v) / 5000)
    el.style.transform = `translateX(${x}px) scale(${1 + s}, ${1 - s * 0.45})`
  }, [])

  const slotOf = (id) => {
    const el = items.current[id]
    return el ? { x: el.offsetLeft, w: el.offsetWidth } : null
  }

  const springTo = useCallback(
    (x, spring = SPRINGS.lens) => {
      const from = anim.current && !anim.current.done ? anim.current.state() : { value: pos.current?.x ?? x, velocity: 0 }
      anim.current?.stop()
      anim.current = animateSpring({ from: from.value, to: x, velocity: from.velocity, spring, onUpdate: paint })
    },
    [paint],
  )

  // Place the lens under the current tab: at once the first time and on
  // resize, on a spring when the tab changes.
  useLayoutEffect(() => {
    const slot = slotOf(tab)
    const el = lensRef.current
    if (!slot || !el) return
    el.style.width = `${slot.w}px`
    if (!pos.current) {
      pos.current = { x: slot.x, w: slot.w }
      paint(slot.x)
    } else if (!drag.current?.scrubbing) springTo(slot.x)
  }, [tab, paint, springTo])

  useEffect(() => {
    const onResize = () => {
      const slot = slotOf(tab)
      if (!slot || !lensRef.current) return
      anim.current?.stop()
      lensRef.current.style.width = `${slot.w}px`
      pos.current = { x: slot.x, w: slot.w }
      paint(slot.x)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [tab, paint])

  useEffect(() => () => anim.current?.stop(), [])

  // ---- drag along the bar to slide the lens
  const nearestTab = (x) => {
    let best = null
    for (const t of TABS) {
      if (t.action) continue
      const s = slotOf(t.id)
      if (!s) continue
      const d = Math.abs(s.x + s.w / 2 - x)
      if (!best || d < best.d) best = { id: t.id, d }
    }
    return best?.id
  }
  const localX = (e) => e.clientX - barRef.current.getBoundingClientRect().left

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    compact.expand() // full size while you use it, so the lens lines up under your finger
    drag.current = { id: e.pointerId, x0: e.clientX, scrubbing: false }
  }
  const onPointerMove = (e) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    if (!d.scrubbing) {
      if (Math.abs(e.clientX - d.x0) < SCRUB_PX) return
      d.scrubbing = true
      barRef.current.setPointerCapture?.(e.pointerId)
      barRef.current.classList.add('scrub')
    }
    const w = pos.current?.w || 0
    const max = barRef.current.clientWidth - w
    springTo(Math.max(0, Math.min(max, localX(e) - w / 2)), SPRINGS.snappy)
  }
  const endDrag = (e, cancelled = false) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    if (!d.scrubbing) return
    barRef.current.classList.remove('scrub')
    suppressClick.current = true
    setTimeout(() => (suppressClick.current = false), 0)
    const id = cancelled ? tab : nearestTab(localX(e))
    if (id && id !== tab) setTab(id)
    else springTo(slotOf(tab).x)
  }

  const press = (t) => {
    if (suppressClick.current) return
    if (t.action) onLog()
    else setTab(t.id)
  }

  return (
    <nav
      ref={barRef}
      className={`tab-bar${compact.on ? ' compact' : ''}`}
      aria-label="Main"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e)}
      onPointerCancel={(e) => endDrag(e, true)}
    >
      <span ref={lensRef} className="tab-lens" aria-hidden="true" />
      {TABS.map((t) => {
        const on = t.id === tab
        return (
          <button
            key={t.id}
            ref={(el) => (items.current[t.id] = el)}
            type="button"
            className={`tab-item${t.action ? ' log' : ''}${on ? ' on' : ''}`}
            aria-current={on ? 'page' : undefined}
            aria-label={t.action ? 'Log food, drink, water, exercise, mood or a dose' : t.label}
            onClick={() => press(t)}
          >
            <span className="tab-glyph" aria-hidden="true">
              {t.face ? <PenguinFace size={26} /> : <Icon name={t.icon} strokeWidth={t.action ? 2.8 : on ? 2.3 : 1.9} />}
            </span>
            {!t.action && <span className="tab-label">{t.label}</span>}
          </button>
        )
      })}
    </nav>
  )
}

/**
 * Like iOS: the bar shrinks a little while you scroll down to read, and comes
 * back to full size when you scroll up, reach the top or bottom, switch tabs
 * or touch it.
 */
function useCompactOnScroll(enabled, resetKey) {
  const [on, setOn] = useState(false)
  const hold = useRef(0)
  useEffect(() => {
    setOn(false)
    hold.current = Date.now() + 800 // the scroll a tab switch causes isn't the user's
  }, [resetKey])
  useEffect(() => {
    if (!enabled) return setOn(false)
    let lastY = window.scrollY
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const y = window.scrollY
        const atBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 24
        if (Date.now() < hold.current) lastY = y
        else if (y < 60 || atBottom) setOn(false)
        else if (y > lastY + 8) setOn(true)
        else if (y < lastY - 8) setOn(false)
        else return // small jitter: keep lastY so slow scrolls still add up
        lastY = y
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
    }
  }, [enabled])
  return { on, expand: () => setOn(false) }
}
