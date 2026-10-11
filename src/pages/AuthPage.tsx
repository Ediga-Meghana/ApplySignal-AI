import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { configured, supabase } from '../lib/supabase'
type Mode = 'login'|'signup'|'forgot'|'reset'
const T: Record<Mode, string> = { login: 'Sign in', signup: 'Create account', forgot: 'Reset your password', reset: 'Choose a new password' }
export default function AuthPage({ mode }: { mode: Mode }) {
  const { session, loading } = useAuth(); const nav = useNavigate()
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string }|null>(null)
  if (session && mode !== 'reset') return <Navigate to="/" replace />
  if (mode === 'reset' && loading) return <main className="center" role="status">Loading…</main>
  if (mode === 'reset' && !session) return <main className="center"><div className="card auth"><h1>Reset link invalid</h1><p className="err" role="alert">This reset link is invalid or has expired. Request a new one.</p><Link to="/forgot">Request a new link</Link></div></main>
  async function submit(e: FormEvent) {
    e.preventDefault(); setMsg(null)
    if (!configured) return setMsg({ ok: false, text: 'Supabase is not configured. See README.md.' })
    if (mode !== 'forgot' && password.length < 8) return setMsg({ ok: false, text: 'Password must be at least 8 characters.' })
    setBusy(true)
    const origin = window.location.origin
    const r = mode === 'login' ? await supabase.auth.signInWithPassword({ email, password })
      : mode === 'signup' ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: origin } })
      : mode === 'forgot' ? await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/reset` })
      : await supabase.auth.updateUser({ password })
    setBusy(false)
    if (r.error) return setMsg({ ok: false, text: r.error.message })
    if (mode === 'login' || mode === 'reset') nav('/')
    else setMsg({ ok: true, text: mode === 'signup' ? 'Account created. Check your email if verification is enabled.' : 'If that email has an account, a reset link is on its way.' })
  }
  return <main className="center"><form className="card auth" onSubmit={submit}><h1>{T[mode]}</h1>
    {mode !== 'reset' && <label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>}
    {mode !== 'forgot' && <label>{mode === 'reset' ? 'New password' : 'Password'}<input type="password" required value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>}
    {msg && <p role="alert" className={msg.ok ? 'ok' : 'err'}>{msg.text}</p>}
    <button disabled={busy}>{busy ? 'Please wait…' : T[mode]}</button>
    <p className="muted">{mode === 'login' ? <><Link to="/signup">Create an account</Link> · <Link to="/forgot">Forgot password?</Link></> : <Link to="/login">Back to sign in</Link>}</p></form></main>
}
