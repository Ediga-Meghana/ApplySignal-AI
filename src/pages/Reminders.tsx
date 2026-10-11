import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { buildReminders, filterReminders, reminderKey } from '../lib/reminders'
import { useReminderPrefs } from '../lib/useReminderPrefs'
import { useRealtimeRefresh } from '../lib/useRealtimeRefresh'
import type { Application, Opportunity } from '../lib/types'
export default function Reminders() {
  const prefs = useReminderPrefs()
  const [apps, setApps] = useState<Application[]>([]); const [opps, setOpps] = useState<Opportunity[]>([]); const [err, setErr] = useState(''); const [ready, setReady] = useState(false)
  const [type, setType] = useState(''); const [state, setState] = useState(''); const [done, setDone] = useState(false); const [shown, setShown] = useState(false); const [desc, setDesc] = useState(false)
  const load = useCallback(async () => { const [a, o] = await Promise.all([supabase.from('applications').select('*'), supabase.from('opportunities').select('*')]); const e = a.error ?? o.error; if (e) setErr(e.message); else setErr(''); setApps((a.data ?? []) as Application[]); setOpps((o.data ?? []) as Opportunity[]); setReady(true) }, [])
  useEffect(() => { void load() }, [load])
  useRealtimeRefresh(['applications', 'opportunities', 'reminder_dismissals', 'profiles'], load)
  const list = useMemo(() => { const l = filterReminders(buildReminders(apps, opps), { type, state, includeDone: done, dismissed: prefs.dismissed, showDismissed: shown }); return desc ? [...l].reverse() : l }, [apps, opps, type, state, done, shown, desc, prefs.dismissed])
  if (!ready || !prefs.loaded) return <p role="status">Loading…</p>
  const msg = err || prefs.error
  return <><h1>Reminders</h1><p className="muted">In-app reminders are derived from the dates saved on your records. Optional email digests can be enabled in Profile after the owner configures the scheduled email service; browser push notifications are not implemented. Dismissals are saved to your account and reappear if the date changes. To change a date, open the record.</p>
    {msg && <p role="alert" className="err">{msg}</p>}
    {!prefs.enabled ? <div className="card"><p>In-app reminders are turned off. Turn them on in <Link to="/profile">Profile and settings</Link>.</p></div> : <>
    <div className="row filters"><select aria-label="Type" value={type} onChange={e => setType(e.target.value)}><option value="">All types</option>{['Application deadline', 'Assessment', 'Interview', 'Follow-up'].map(t => <option key={t}>{t}</option>)}</select>
      <select aria-label="State" value={state} onChange={e => setState(e.target.value)}><option value="">All states</option>{['overdue', 'urgent', 'upcoming', 'invalid'].map(t => <option key={t}>{t}</option>)}</select>
      <label className="check"><input type="checkbox" checked={done} onChange={e => setDone(e.target.checked)} /> Show completed</label><label className="check"><input type="checkbox" checked={shown} onChange={e => setShown(e.target.checked)} /> Show dismissed</label><label className="check"><input type="checkbox" checked={desc} onChange={e => setDesc(e.target.checked)} /> Latest first</label></div>
    {list.length === 0 ? <p className="card">No reminders match. Add dates to an application or opportunity.</p> : <ul className="list">{list.map(r => { const gone = prefs.dismissed.has(reminderKey(r)); return <li key={r.key}><span><span className={`tag ${r.state}`}>{r.state}</span> <b>{r.type}</b>: {r.title} <span className="muted">({r.date}) {r.reason}{gone ? ' Dismissed.' : ''}</span></span>
      <span className="row"><Link to={r.kind === 'application' ? `/applications/${r.recordId}` : '/radar'}>Open {r.kind}</Link>{gone ? <button className="ghost" onClick={() => prefs.restore(r)}>Restore</button> : <button className="ghost" onClick={() => prefs.dismiss(r)}>Dismiss</button>}</span></li> })}</ul>}</>}</>
}
