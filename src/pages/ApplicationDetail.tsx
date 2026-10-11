import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useRealtimeRefresh } from '../lib/useRealtimeRefresh'
import { buildReminders } from '../lib/reminders'
import { STATUSES, type Application, type Opportunity, type Status } from '../lib/types'
export default function ApplicationDetail() {
  const { id } = useParams(); const nav = useNavigate()
  const [a, setA] = useState<Application | null | undefined>(undefined); const [opp, setOpp] = useState<Opportunity | null>(null); const [err, setErr] = useState('')
  const load = useCallback(async () => {
    const r = await supabase.from('applications').select('*').eq('id', id ?? '').maybeSingle()
    if (r.error) setErr('Could not load this application.'); const app = (r.data ?? null) as Application | null; setA(app)
    if (app?.opportunity_id) { const o = await supabase.from('opportunities').select('*').eq('id', app.opportunity_id).maybeSingle(); setOpp((o.data ?? null) as Opportunity | null) }
  }, [id])
  useEffect(() => { load() }, [load])
  useRealtimeRefresh(['applications', 'opportunities'], load)
  async function setStatus(status: Status) { const { error } = await supabase.from('applications').update({ status, updated_at: new Date().toISOString() }).eq('id', a!.id); if (error) setErr(error.message); else load() }
  async function del() { if (!window.confirm(`Delete ${a!.company} — ${a!.role}?`)) return; const { error } = await supabase.from('applications').delete().eq('id', a!.id); if (error) setErr(error.message); else nav('/applications') }
  if (a === undefined) return <p role="status">Loading…</p>
  if (!a) return <><h1>Application not found</h1>{err && <p role="alert" className="err">{err}</p>}<p>It may have been deleted, or it does not belong to your account.</p><Link to="/applications">Back to applications</Link></>
  const rows: [string, string | null][] = [['Type', a.type], ['Source', a.source], ['Application deadline', a.deadline], ['Assessment', a.assessment_date], ['Interview', a.interview_date], ['Follow-up', a.follow_up_date], ['Added', new Date(a.created_at).toLocaleDateString()], ['Notes', a.notes]]
  const rem = buildReminders([a], [])
  return <><p><Link to="/applications">← All applications</Link></p><h1>{a.company} — {a.role}</h1>{err && <p role="alert" className="err">{err}</p>}
    <div className="card"><div className="row"><label>Status<select value={a.status} onChange={e => setStatus(e.target.value as Status)}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></label><Link to={`/applications?edit=${a.id}`}>Edit</Link><button className="ghost danger" onClick={del}>Delete</button></div>
      <dl>{rows.map(([k, v]) => <div key={k}><dt className="muted">{k}</dt><dd>{v ?? 'Not recorded'}</dd></div>)}<div><dt className="muted">Job URL</dt><dd>{a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer">{a.url}</a> : 'Not recorded'}</dd></div></dl></div>
    <h2>Dates and reminders</h2>{rem.length === 0 ? <p className="card">No dates recorded.</p> : <ul className="list">{rem.map(r => <li key={r.key}><span><span className={`tag ${r.state}`}>{r.state}</span> {r.type} <span className="muted">({r.date}) {r.reason}</span></span></li>)}</ul>}
    {opp && <><h2>Original opportunity</h2><div className="card"><p className="muted">Extracted by {opp.extraction_method === 'ai' ? 'AI' : opp.extraction_method === 'rules' ? 'the rule-based extractor' : 'unknown method'}{opp.extracted_at ? ` on ${new Date(opp.extracted_at).toLocaleDateString()}` : ''}. Verify against the source text.</p><p>{opp.source_text ?? opp.snippet ?? 'No source text saved.'}</p></div></>}</>
}
