import { useEffect, useRef, useState } from 'react'
import { Icon, PenguinFace } from './ui.jsx'

const TABS = [
  { id: 'today', icon: 'grid', label: 'Dashboard' },
  { id: 'progress', icon: 'trend', label: 'Progress' },
  { id: 'log', label: 'Log' },
  { id: 'coach', label: 'Mimi', face: true },
  { id: 'settings', icon: 'gear', label: 'Settings' },
]

/**
 * Navigation as one button. Collapsed it shows where you are; tap it and it
 * unfurls into a row of every destination, with Log in the middle.
 */
export default function NavDock({ tab, setTab, onLog, hidden }) {
  const [open, setOpen] = useState(false)
  const railRef = useRef()
  const current = TABS.find((t) => t.id === tab) || TABS[0]

  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    // Scrolling the page folds it away again.
    const onScroll = () => setOpen(false)
    window.addEventListener('scroll', onScroll, { passive: true })
    // Narrow screens scroll the row: start with the current tab in view.
    railRef.current?.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll)
    }
  }, [open])

  function go(id) {
    setOpen(false)
    if (id === 'log') onLog()
    else setTab(id)
  }

  return (
    <>
      {open && <div className="nav-scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
      <nav className={`nav-dock${open ? ' open' : ''}${hidden && !open ? ' hidden' : ''}`} aria-label="Main">
        {open ? (
          <div className="nav-rail" ref={railRef} role="menu">
            {TABS.map((t, i) => (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                className={`nav-item${t.id === 'log' ? ' log' : ''}${t.id === tab ? ' on' : ''}`}
                style={{ '--i': Math.abs(i - 2) }}
                aria-current={t.id === tab ? 'page' : undefined}
                aria-label={t.id === 'log' ? 'Log food, drink, water, exercise, mood or a dose' : t.label}
                onClick={() => go(t.id)}
              >
                <span className="nav-glyph" aria-hidden="true">
                  {t.face ? <PenguinFace size={26} /> : <Icon name={t.id === 'log' ? 'plus' : t.icon} strokeWidth={t.id === 'log' ? 2.8 : t.id === tab ? 2.3 : 1.9} />}
                </span>
                <span className="nav-label">{t.label}</span>
              </button>
            ))}
          </div>
        ) : (
          <button type="button" className="nav-orb" aria-haspopup="menu" aria-expanded="false" aria-label={`${current.label}. Open menu`} onClick={() => setOpen(true)}>
            <span className="nav-glyph" aria-hidden="true">
              {current.face ? <PenguinFace size={24} /> : <Icon name={current.icon} strokeWidth={2.2} />}
            </span>
            <span className="nav-orb-label">{current.label}</span>
            <span className="nav-orb-dots" aria-hidden="true"><i /><i /><i /></span>
          </button>
        )}
      </nav>
    </>
  )
}
