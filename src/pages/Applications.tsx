import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useRealtimeRefresh } from '../lib/useRealtimeRefresh'
import { classify, isDone } from '../lib/deadline'
import { STATUSES, type Application, type Status } from '../lib/types'
const blank = { company: '', role: '', type: 'Internship', url: '', notes: '', deadline: '', assessment_date: '', interview_date: '', follow_up_date: '' }
type Form = typeof blank
const nul = (s: string) => s.trim() === '' ? null : s.trim()
export default function Applications() {
  const [apps, setApps] = useState<Application[]>([]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<Form>(blank); const [editing, setEditing] = useState<string|null>(null)
  const [q, setQ] = useState(''); const [fs, setFs] = useState(''); const [sort, setSort] = useState('recent'); const [dl, setDl] = useState('')
  const load = useCallback(async () => { const { data, error } = await supabase.from('applications').select('*').order('created_at', { ascending: false }); if (error) setErr(error.message); else setApps(data as Application[]) }, [])
  useEffect(() => { load() }, [load])
  useRealtimeRefresh(['applications'], load)
  const [params, setParams] = useSearchParams()
  const startEdit = (a: Application) => { setEditing(a.id); setForm({ company: a.company, role: a.role, type: a.type ?? '', url: a.url ?? '', notes: a.notes ?? '', deadline: a.deadline ?? '', assessment_date: a.assessment_date ?? '', interview_date: a.interview_date ?? '', follow_up_date: a.follow_up_date ?? '' }); window.scrollTo(0, 0) }
  useEffect(() => { const id = params.get('edit'); const a = id ? apps.find(x => x.id === id) : undefined; if (a) { startEdit(a); setParams({}, { replace: true }) } }, [apps, params]) // eslint-disable-line
  async function save(e: FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setErr('')
    const row = { company: form.company.trim(), role: form.role.trim(), type: nul(form.type), url: nul(form.url), notes: nul(form.notes), deadline: nul(form.deadline), assessment_date: nul(form.assessment_date), interview_date: nul(form.interview_date), follow_up_date: nul(form.follow_up_date), updated_at: new Date().toISOString() }
    const { error } = editing ? await supabase.from('applications').update(row).eq('id', editing) : await supabase.from('applications').insert(row)
    setBusy(false); if (error) return setErr(error.message)
    setForm(blank); setEditing(null); load()
  }
  async function setStatus(id: string, status: Status) { const { error } = await supabase.from('applications').update({ status, updated_at: new Date().toISOString() }).eq('id', id); if (error) setErr(error.message); else load() }
  async function del(a: Application) { if (!window.confirm(`Delete ${a.company} — ${a.role}?`)) return; const { error } = await supabase.from('applications').delete().eq('id', a.id); if (error) setErr(error.message); else load() }
  const shown = useMemo(() => apps.filter(a => (`${a.company} ${a.role}`).toLowerCase().includes(q.toLowerCase()) && (!fs || a.status === fs) && (!dl || (dl === 'undated' ? !a.deadline : classify(a.deadline, isDone('deadline', a.status)).state === dl)))
    .sort((x, y) => sort === 'deadline' ? (x.deadline ?? '9999').localeCompare(y.deadline ?? '9999') : y.created_at.localeCompare(x.created_at)), [apps, q, fs, sort, dl])
  const f = (k: keyof Form, label: string, type = 'text', req = false) => <label>{label}<input type={type} required={req} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} /></label>
  return <><h1>Applications</h1>{err && <p role="alert" className="err">{err}</p>}
    <form className="card grid" onSubmit={save}><h2>{editing ? 'Edit application' : 'Add application'}</h2>
      {f('company', 'Company', 'text', true)}{f('role', 'Role', 'text', true)}{f('type', 'Type')}{f('url', 'Application URL', 'url')}{f('deadline', 'Deadline', 'date')}{f('assessment_date', 'Assessment date', 'date')}{f('interview_date', 'Interview date', 'date')}{f('follow_up_date', 'Follow-up date', 'date')}{f('notes', 'Notes')}
      <div className="row"><button disabled={busy}>{busy ? 'Saving…' : 'Save application'}</button>{editing && <button type="button" className="ghost" onClick={() => { setEditing(null); setForm(blank) }}>Cancel</button>}</div></form>
    <div className="row filters"><input aria-label="Search company or role" placeholder="Search company or role" value={q} onChange={e => setQ(e.target.value)} />
      <select aria-label="Filter by status" value={fs} onChange={e => setFs(e.target.value)}><option value="">All statuses</option>{STATUSES.map(s => <option key={s}>{s}</option>)}</select>
      <select aria-label="Filter by deadline" value={dl} onChange={e => setDl(e.target.value)}><option value="">Any deadline</option><option value="upcoming">Upcoming</option><option value="urgent">Urgent</option><option value="overdue">Overdue</option><option value="invalid">Invalid date</option><option value="undated">No deadline</option></select>
      <select aria-label="Sort" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">Most recent</option><option value="deadline">Nearest deadline</option></select></div>
    {shown.length === 0 ? <p className="card">{apps.length ? 'No applications match these filters.' : 'No applications yet. Add your first one above.'}</p> :
      <ul className="list">{shown.map(a => <li key={a.id}><div><Link to={`/applications/${a.id}`}><b>{a.company}</b> — {a.role}</Link> <span className="muted">{classify(a.deadline, isDone('deadline', a.status)).reason}</span></div>
        <div className="row"><select aria-label={`Status for ${a.company}`} value={a.status} onChange={e => setStatus(a.id, e.target.value as Status)}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select>
          <button className="ghost" onClick={() => startEdit(a)}>Edit</button>
          <button className="ghost danger" onClick={() => del(a)}>Delete</button></div></li>)}</ul>}</>
}
