import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth'
const csv = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean)
export default function Profile() {
  const { session } = useAuth(); const [f, setF] = useState({ full_name: '', graduation_year: '', skills: '', preferred_roles: '', preferred_locations: '', notify_in_app: true, notify_email: false, timezone: 'Asia/Kolkata' })
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false)
  useEffect(() => { supabase.from('profiles').select('*').maybeSingle().then(({ data, error }) => { if (error) setMsg({ ok: false, text: error.message }); else if (data) setF({ full_name: data.full_name ?? '', graduation_year: data.graduation_year?.toString() ?? '', skills: data.skills.join(', '), preferred_roles: data.preferred_roles.join(', '), preferred_locations: data.preferred_locations.join(', '), notify_in_app: data.notify_in_app, notify_email: data.notify_email ?? false, timezone: data.timezone ?? 'Asia/Kolkata' }); setReady(true) }) }, [])
  async function save(e: FormEvent) {
    e.preventDefault(); if (busy) return; const y = f.graduation_year.trim()
    if (y && (!/^\d{4}$/.test(y) || +y < 1990 || +y > 2100)) return setMsg({ ok: false, text: 'Graduation year must be a 4-digit year between 1990 and 2100.' })
    setBusy(true); const { error } = await supabase.from('profiles').upsert({ user_id: session!.user.id, full_name: f.full_name.trim() || null, graduation_year: y ? +y : null, skills: csv(f.skills), preferred_roles: csv(f.preferred_roles), preferred_locations: csv(f.preferred_locations), notify_in_app: f.notify_in_app, notify_email: f.notify_email, timezone: f.timezone, updated_at: new Date().toISOString() }); setBusy(false)
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: 'Profile saved.' })
  }
  if (!ready) return <p role="status">Loading…</p>
  const t = (k: 'full_name' | 'graduation_year' | 'skills' | 'preferred_roles' | 'preferred_locations', label: string) => <label>{label}<input value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>
  return <><h1>Profile and settings</h1>{msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'ok' : 'err'}>{msg.text}</p>}
    <form className="card grid" onSubmit={save}><p className="muted">Signed in as {session?.user.email}. Password changes use the “Forgot password” flow.</p>{t('full_name', 'Name')}{t('graduation_year', 'Graduation year')}{t('skills', 'Skills (comma-separated)')}{t('preferred_roles', 'Preferred roles (comma-separated)')}{t('preferred_locations', 'Preferred locations (comma-separated)')}
      <label>Time zone<select value={f.timezone} onChange={e => setF({ ...f, timezone: e.target.value })}><option value="Asia/Kolkata">India (Asia/Kolkata)</option><option value="UTC">UTC</option><option value="America/New_York">US Eastern</option><option value="America/Los_Angeles">US Pacific</option><option value="Europe/London">UK (Europe/London)</option><option value="Australia/Sydney">Australia (Sydney)</option></select></label><label className="check"><input type="checkbox" checked={f.notify_in_app} onChange={e => setF({ ...f, notify_in_app: e.target.checked })} /> Show in-app reminders</label><label className="check"><input type="checkbox" checked={f.notify_email} onChange={e => setF({ ...f, notify_email: e.target.checked })} /> Email me a daily digest for deadlines due within 3 days (requires the owner to configure email delivery)</label><button disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button></form></>
}
