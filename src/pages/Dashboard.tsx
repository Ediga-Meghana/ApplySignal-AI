import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { buildReminders, filterReminders } from '../lib/reminders'
import { useReminderPrefs } from '../lib/useReminderPrefs'
import { useRealtimeRefresh } from '../lib/useRealtimeRefresh'
import { STATUSES, type Application, type Opportunity, type Task } from '../lib/types'
export default function Dashboard() {
  const prefs = useReminderPrefs()
  const [apps, setApps] = useState<Application[]>([]); const [opps, setOpps] = useState<Opportunity[]>([]); const [tasks, setTasks] = useState<Task[]>([]); const [err, setErr] = useState(''); const [ready, setReady] = useState(false)
  const load = useCallback(async () => {
    const [a, o, t] = await Promise.all([supabase.from('applications').select('*').order('created_at', { ascending: false }), supabase.from('opportunities').select('*').order('created_at', { ascending: false }), supabase.from('learning_tasks').select('id,analysis_id,title,done')])
    const e = a.error ?? o.error ?? t.error; if (e) setErr(e.message); else setErr('')
    setApps((a.data ?? []) as Application[]); setOpps((o.data ?? []) as Opportunity[]); setTasks((t.data ?? []) as Task[]); setReady(true)
  }, [])
  useEffect(() => { void load() }, [load])
  useRealtimeRefresh(['applications', 'opportunities', 'learning_tasks', 'reminder_dismissals', 'profiles'], load)
  if (!ready || !prefs.loaded) return <p role="status">Loading…</p>
  const pending = prefs.enabled ? filterReminders(buildReminders(apps, opps), { dismissed: prefs.dismissed }) : [], overdue = pending.filter(r => r.state === 'overdue').length
  return <><h1>Dashboard</h1>{err && <p role="alert" className="err">Some data could not be loaded: {err}</p>}
    {apps.length + opps.length + tasks.length === 0 ? <div className="card"><h2>Nothing tracked yet</h2><p>Paste a message in the <Link to="/radar">Opportunity Radar</Link> or <Link to="/applications">add an application</Link>.</p></div> : <>
    <div className="stats"><div className="card"><b>{apps.length}</b> applications</div><div className="card"><b>{opps.length}</b> saved opportunities</div><div className="card"><b>{overdue}</b> overdue reminders</div><div className="card"><b>{tasks.filter(t => t.done).length}/{tasks.length}</b> learning tasks done</div>{STATUSES.map(s => <div className="card" key={s}><b>{apps.filter(a => a.status === s).length}</b> {s}</div>)}</div>
    <h2>Upcoming and overdue</h2><ul className="list">{pending.length === 0 && <li>{prefs.enabled ? 'No pending dates.' : 'In-app reminders are turned off in Profile and settings.'}</li>}{pending.slice(0, 8).map(r => <li key={r.key}><span><span className={`tag ${r.state}`}>{r.state}</span> {r.type}: {r.title} <span className="muted">({r.date}) {r.reason}</span></span><Link to={r.kind === 'application' ? `/applications/${r.recordId}` : '/radar'}>Open</Link></li>)}</ul>{pending.length > 8 && <Link to="/reminders">All reminders</Link>}
    <h2>Recent opportunities</h2><ul className="list">{opps.length === 0 && <li>None yet.</li>}{opps.slice(0, 4).map(o => <li key={o.id}><span>{o.company ?? 'Company not identified'} — {o.role ?? 'Role not identified'}</span><Link to="/radar">Open</Link></li>)}</ul>
    <h2>Recent applications</h2><ul className="list">{apps.length === 0 && <li>None yet.</li>}{apps.slice(0, 4).map(a => <li key={a.id}><span>{a.company} — {a.role} <span className="muted">({a.status}, added {new Date(a.created_at).toLocaleDateString()})</span></span><Link to={`/applications/${a.id}`}>Open</Link></li>)}</ul></>}</>
}
