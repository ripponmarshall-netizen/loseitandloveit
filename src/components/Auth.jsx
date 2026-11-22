import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { Penguin } from './ui.jsx'

// Email + password rather than magic links: on iPhone a magic link opens in
// Safari, not in the installed home-screen app, so the app never gets the session.
export default function Auth({ onUseLocal }) {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.href.split('#')[0] },
        })
        if (error) throw error
        if (!data.session) {
          setMsg({ ok: true, text: 'Check your email to confirm your account, then come back here and sign in.' })
          setMode('signin')
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.href.split('#')[0],
        })
        if (error) throw error
        setMsg({ ok: true, text: 'If that email has an account, a reset link is on its way.' })
      }
    } catch (err) {
      setMsg({ ok: false, text: err.message || 'Something went wrong' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <Penguin kind="workout" />
      <h1 className="center auth-title">Mimi</h1>
      <p className="center muted auth-sub">
        Track what you eat, watch the trend, get coached.
      </p>
      <form className="card" onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode !== 'reset' && (
          <label className="field">
            <span>Password</span>
            <input
              className="input"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {msg && (
          <p className={`small ${msg.ok ? 'ok-text' : 'danger-text'}`} role="alert">
            {msg.text}
          </p>
        )}
        <button className="btn block" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
        </button>
        <div className="row between small mt-4">
          {mode === 'signin' ? (
            <>
              <button type="button" className="link" onClick={() => setMode('signup')}>Create an account</button>
              <button type="button" className="link" onClick={() => setMode('reset')}>Forgot password?</button>
            </>
          ) : (
            <button type="button" className="link" onClick={() => setMode('signin')}>Back to sign in</button>
          )}
        </div>
      </form>
      <button className="btn gray block" onClick={onUseLocal}>Try it without an account</button>
      <p className="tiny muted center mt-2">
        Without an account, data stays on this device only and the AI coach is off.
      </p>
    </div>
  )
}
