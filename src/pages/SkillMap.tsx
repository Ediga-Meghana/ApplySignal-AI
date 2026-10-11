import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { extractResumeText, ResumeError } from '../lib/resume'
import { supabase } from '../lib/supabase'
import { useRealtimeRefresh } from '../lib/useRealtimeRefresh'
import { analyzeSkills } from '../lib/skills'
import { callAi, AiError } from '../lib/ai'
import { validateSkillMap, AiValidationError, type AiSkillMap } from '../lib/aiSchemas'
import type { Analysis, Task } from '../lib/types'
type Res = { method: 'ai' | 'keywords'; matched: string[]; missing: string[]; tasks: string[]; ai: AiSkillMap | null }
type Hist = Analysis & { method: string | null; result: AiSkillMap | null }
const Score = ({ s }: { s: { evidenced: number; total: number } }) => <p className="muted">{s.evidenced} of {s.total} skills have quoted evidence in your resume. This is a simple count of skills named, not a hiring probability.</p>
function AiView({ r }: { r: AiSkillMap }) { return <div><Score s={r.score} />{r.warnings.map(w => <p key={w} className="warn">{w}</p>)}
  <p><b>Required by the job:</b> {r.required.join(', ') || 'none found'}</p>
  <p><b>Evidenced in resume:</b></p><ul>{r.matched.map(m => <li key={m.skill}>{m.skill} — “{m.evidence}”</li>)}</ul>
  <p><b>Not shown in resume:</b> {r.missing.map(m => `${m.skill} (${m.status === 'weak' ? 'weakly shown' : m.status === 'unverified' ? 'unverified claim' : 'not mentioned; you may still have it'})`).join(', ') || 'none'}</p>
  {r.transferable.length > 0 && <><p><b>Transferable:</b></p><ul>{r.transferable.map(t => <li key={t.skill}>{t.skill}: {t.reason}</li>)}</ul></>}
  {r.learning.length > 0 && <><p><b>Learning priorities:</b></p><ul>{r.learning.map(l => <li key={l.topic}>[{l.priority}] {l.topic} {l.why && `— ${l.why}`}</li>)}</ul></>}
  {r.projects.length > 0 && <p><b>Project ideas:</b> {r.projects.join('; ')}</p>}
  {r.roadmap.length > 0 && <><p><b>Roadmap:</b></p><ul>{r.roadmap.map((x, i) => <li key={i}>{x.week} {x.focus}</li>)}</ul></>}
  {r.interview_topics.length > 0 && <p><b>Interview topics:</b> {r.interview_topics.join(', ')}</p>}</div> }
export default function SkillMap() {
  const [role, setRole] = useState(''); const [own, setOwn] = useState(''); const [jd, setJd] = useState(''); const [prefs, setPrefs] = useState(''); const [consent, setConsent] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<Res | null>(null); const [hist, setHist] = useState<Hist[]>([]); const [tasks, setTasks] = useState<Task[]>([]); const [newTask, setNewTask] = useState<Record<string, string>>({})
  const err = (text: string) => setNotice({ ok: false, text })
  const load = useCallback(async () => { const [a, t] = await Promise.all([supabase.from('skill_analyses').select('id,target_role,matched,missing,created_at,method,result').order('created_at', { ascending: false }), supabase.from('learning_tasks').select('*').order('created_at')]); if (a.error || t.error) err((a.error ?? t.error)!.message); else { setHist(a.data as Hist[]); setTasks(t.data as Task[]) } }, [])
  useEffect(() => { load() }, [load])
  useRealtimeRefresh(['skill_analyses', 'learning_tasks'], load)
  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f || busy) return; setNotice(null); setBusy(true)
    try { const r = await extractResumeText(f, { pdfWorkerSrc: workerUrl, ocr: true }); setOwn(r.text); setNotice({ ok: true, text: `Extracted ${r.text.length} characters from ${f.name}${r.truncated ? ' (cut to the 15,000-character limit)' : ''}. Review and correct the text below before analysing. The file was read in your browser only: it was not uploaded or stored. If OCR was needed, the OCR engine and English language model were downloaded from jsDelivr; the document itself stayed in your browser.` }) }
    catch (x) { err(x instanceof ResumeError ? x.message : 'Could not read this file.') } finally { setBusy(false) }
  }
  const check = () => { setNotice(null); if (!jd.trim()) { err('Enter a job description.'); return false } if (!own.trim()) { err('Enter your skills or paste resume text.'); return false } return true }
  const keywords = () => { const r = analyzeSkills(own, jd); setRes({ method: 'keywords', matched: r.matched, missing: r.missing, tasks: r.tasks, ai: null }) }
  async function runAi() {
    if (!check() || busy) return; if (!consent) return err('Tick the consent box to send your resume text to the AI provider.')
    setBusy(true)
    try { const v = validateSkillMap(await callAi('skillmap', { resume: own, jd, preferences: prefs }), own)
      setRes({ method: 'ai', matched: v.matched.map(m => m.skill), missing: v.missing.map(m => m.skill), ai: v, tasks: [...v.learning.filter(l => l.priority !== 'low').map(l => `Learn ${l.topic}`), ...v.projects.slice(0, 3).map(p => `Project: ${p}`)] })
    } catch (e) { keywords(); err(`${e instanceof AiError || e instanceof AiValidationError ? e.message : 'AI request failed.'} Showing the keyword baseline instead.`) }
    setBusy(false)
  }
  async function save() {
    if (!res || busy) return; setBusy(true)
    const a = await supabase.from('skill_analyses').insert({ target_role: role.trim() || null, job_description: jd, matched: res.matched, missing: res.missing, method: res.method, result: res.ai }).select('id').single()
    if (a.error) { setBusy(false); return err(a.error.message) }
    if (res.tasks.length) { const t = await supabase.from('learning_tasks').insert(res.tasks.map(title => ({ analysis_id: a.data.id, title }))); if (t.error) err(t.error.message) }
    setBusy(false); setRes(null); setNotice({ ok: true, text: 'Analysis saved.' }); load()
  }
  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => { const { error } = await p; if (error) err(error.message); else load() }
  const toggle = (t: Task) => run(supabase.from('learning_tasks').update({ done: !t.done }).eq('id', t.id))
  const rename = (t: Task) => { const v = window.prompt('Edit task', t.title); if (v && v.trim() && v !== t.title) run(supabase.from('learning_tasks').update({ title: v.trim() }).eq('id', t.id)) }
  const remove = (t: Task) => { if (window.confirm('Delete this task?')) run(supabase.from('learning_tasks').delete().eq('id', t.id)) }
  const add = (id: string) => { const title = (newTask[id] ?? '').trim(); if (!title) return; setNewTask({ ...newTask, [id]: '' }); run(supabase.from('learning_tasks').insert({ analysis_id: id, title })) }
  return <><h1>SkillMap</h1><p className="muted">Compare a resume with a job description. AI mode needs the server function configured; otherwise a keyword baseline over a fixed skill list is used.</p>
    {notice && <p role={notice.ok ? 'status' : 'alert'} className={notice.ok ? 'ok' : 'err'}>{notice.text}</p>}
    <div className="card grid"><label>Target role<input value={role} onChange={e => setRole(e.target.value)} /></label><label>Resume text or skills (review and correct it)<textarea rows={6} value={own} onChange={e => setOwn(e.target.value)} /></label><label>Upload a resume (PDF or DOCX, max 5 MB; extraction and optional scanned-PDF OCR run in your browser)<input type="file" accept=".pdf,.docx" onChange={onFile} disabled={busy} /></label><label>Job description<textarea rows={5} value={jd} onChange={e => setJd(e.target.value)} /></label><label>Learning preferences (optional)<input value={prefs} onChange={e => setPrefs(e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> I agree to send this resume text and job description to the AI provider configured on the server. Nothing is stored except the analysis I choose to save.</label>
      <div className="row"><button onClick={runAi} disabled={busy}>{busy ? 'Analyzing…' : 'Analyze with AI'}</button><button className="ghost" disabled={busy} onClick={() => check() && keywords()}>Keyword baseline (no AI)</button></div></div>
    {res && <div className="card"><h2>Result ({res.method === 'ai' ? 'AI, unverified: review it' : 'keyword baseline'})</h2>{res.ai ? <AiView r={res.ai} /> : <><p><b>Matched:</b> {res.matched.join(', ') || 'none'}</p><p><b>Missing or unverified:</b> {res.missing.join(', ') || 'none'}</p></>}<button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save with learning tasks'}</button></div>}
    <h2>Saved analyses</h2>{hist.length === 0 ? <p className="card">No saved analyses yet.</p> : hist.map(a => { const ts = tasks.filter(t => t.analysis_id === a.id); return <div className="card" key={a.id}><b>{a.target_role ?? 'Untitled role'}</b> <span className="muted">{new Date(a.created_at).toLocaleDateString()} · {a.method === 'ai' ? 'AI' : 'keyword'} · {ts.filter(t => t.done).length}/{ts.length} tasks done</span>
      {a.result && <details><summary>Reopen analysis</summary><AiView r={a.result} /></details>}
      <ul className="plain">{ts.map(t => <li key={t.id} className="row"><label className="check"><input type="checkbox" checked={t.done} onChange={() => toggle(t)} /> {t.title}</label><button className="ghost" onClick={() => rename(t)}>Edit</button><button className="ghost danger" onClick={() => remove(t)}>Delete</button></li>)}</ul>
      <div className="row"><input aria-label="New task" placeholder="Add a task" value={newTask[a.id] ?? ''} onChange={e => setNewTask({ ...newTask, [a.id]: e.target.value })} /><button className="ghost" onClick={() => add(a.id)}>Add task</button></div></div> })}</>
}
