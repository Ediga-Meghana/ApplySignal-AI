import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useRealtimeRefresh } from '../lib/useRealtimeRefresh'
import { ImportError, parseOpportunityImport, type ImportedOpportunity } from '../lib/importOpportunities'
import { fetchRecentOpportunityEmails, prepareGmailImport, requestGmailToken, type GmailMessage } from '../lib/gmail'
import { extractOpportunity, isDuplicate, type Extracted } from '../lib/extract'
import { classify } from '../lib/deadline'
import { callAi, AiError } from '../lib/ai'
import { validateExtraction, AiValidationError, type AiDetails } from '../lib/aiSchemas'
import type { Opportunity } from '../lib/types'
type Draft = Omit<Extracted, 'warnings'> & { method: 'ai' | 'rules'; details: AiDetails | null }
type TextKey = 'company' | 'role' | 'type' | 'action' | 'url' | 'deadline' | 'assessment_date' | 'interview_date'
type Notice = { ok: boolean; text: string } | null
export default function Radar() {
  const [text, setText] = useState(''); const [draft, setDraft] = useState<Draft | null>(null); const [warn, setWarn] = useState<string[]>([])
  const [opps, setOpps] = useState<Opportunity[]>([]); const [notice, setNotice] = useState<Notice>(null); const [busy, setBusy] = useState(false); const [force, setForce] = useState(false)
  const [conv, setConv] = useState<{ id: string; company: string; role: string } | null>(null)
  const [importRows, setImportRows] = useState<ImportedOpportunity[]>([])
  const [importSelected, setImportSelected] = useState<Set<number>>(new Set())
  const [gmailMessages, setGmailMessages] = useState<GmailMessage[]>([])
  const [gmailBusy, setGmailBusy] = useState(false)
  const [inputSource, setInputSource] = useState('Pasted message')
  const lock = useRef(false) // synchronous guard: state updates are async, so a fast double-click could slip through `busy`
  const load = useCallback(async () => { const { data, error } = await supabase.from('opportunities').select('*').order('created_at', { ascending: false }); if (error) setNotice({ ok: false, text: error.message }); else setOpps(data as Opportunity[]) }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (import.meta.env.VITE_GOOGLE_CLIENT_ID) void prepareGmailImport().catch(() => {}) }, [])
  useRealtimeRefresh(['opportunities', 'applications'], load)
  async function run(fn: () => Promise<string | null>, success: string) {
    if (lock.current) return; lock.current = true; setBusy(true); setNotice(null)
    const e = await fn(); lock.current = false; setBusy(false)
    if (e) setNotice({ ok: false, text: e }); else { setNotice({ ok: true, text: success }); load() }
    return !e
  }
  const rules = () => { const { warnings, ...d } = extractOpportunity(text); setDraft({ ...d, source: inputSource, method: 'rules', details: null }); setWarn(warnings) }
  const analyze = () => { setNotice(null); setForce(false); if (!text.trim()) return setNotice({ ok: false, text: 'Paste a message first.' }); rules() }
  async function analyzeAi() {
    setNotice(null); setForce(false); if (!text.trim()) return setNotice({ ok: false, text: 'Paste a message first.' }); if (lock.current) return
    lock.current = true; setBusy(true)
    try { const v = validateExtraction(await callAi('extract', { text }), text); const { warnings, ...d } = v
      setDraft({ company: d.company, role: d.role, type: d.type, action: d.action, url: d.url, source: inputSource, deadline: d.deadline, assessment_date: d.assessment_date, interview_date: d.interview_date, snippet: text.slice(0, 500), method: 'ai', details: d.details }); setWarn(warnings)
    } catch (e) { rules(); setNotice({ ok: false, text: `${e instanceof AiError || e instanceof AiValidationError ? e.message : 'AI request failed.'} Showing the rule-based fallback instead.` }) }
    finally { lock.current = false; setBusy(false) }
  }
  const dup = draft ? opps.find(o => isDuplicate(draft, o)) : undefined
  async function onImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    if (file.size > 2_000_000) return setNotice({ ok: false, text: 'Import files must be smaller than 2 MB.' })
    try {
      const rows = parseOpportunityImport(await file.text(), file.name)
      setImportRows(rows); setImportSelected(new Set(rows.map((_, i) => i)))
      setNotice({ ok: true, text: `Loaded ${rows.length} rows for review. Nothing has been saved yet.` })
    } catch (error) { setNotice({ ok: false, text: error instanceof ImportError ? error.message : 'Could not read the import file.' }) }
  }
  async function saveImport() {
    if (busy) return
    const rows = importRows.filter((_, i) => importSelected.has(i))
    if (!rows.length) return setNotice({ ok: false, text: 'Select at least one row to import.' })
    setBusy(true)
    const { error } = await supabase.from('opportunities').insert(rows.map(r => ({ ...r, snippet: r.snippet, extraction_method: 'rules', extracted_at: new Date().toISOString(), source_text: r.snippet })))
    setBusy(false)
    if (error) setNotice({ ok: false, text: error.message })
    else { setNotice({ ok: true, text: `Imported ${rows.length} reviewed opportunities.` }); setImportRows([]); setImportSelected(new Set()); load() }
  }

  async function importGmail() {
    if (gmailBusy || busy) return
    setGmailBusy(true); setNotice(null)
    try {
      const token = await requestGmailToken(import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '')
      const messages = await fetchRecentOpportunityEmails(token)
      setGmailMessages(messages)
      setNotice({ ok: true, text: `Found ${messages.length} recent job-related emails. Select one to review; messages are not saved or sent to AI automatically.` })
      if (!messages.length) setNotice({ ok: true, text: 'No matching emails found in the last 30 days.' })
    } catch (e) { setNotice({ ok: false, text: e instanceof Error ? e.message : 'Gmail import failed.' }) }
    finally { setGmailBusy(false) }
  }
  function useGmailMessage(m: GmailMessage) {
    setText(m.text); setInputSource(`Gmail: ${m.subject}`); setDraft(null); setWarn([])
    setNotice({ ok: true, text: 'Email loaded for review. Nothing has been saved or sent to AI yet; choose Analyze with AI when ready.' })
  }
  async function save() {
    if (!draft || busy) return; if (dup && !force) return setForce(true)
    const ok = await run(async () => (await supabase.from('opportunities').insert((({ method, details, ...row }) => ({ ...row, extraction_method: method, extracted_at: new Date().toISOString(), source_text: text.slice(0, 12000), details }))(draft))).error?.message ?? null, 'Opportunity saved.')
    if (ok) { setDraft(null); setText(''); setForce(false) }
  }
  function startConvert(o: Opportunity) { setNotice(null); if (o.company && o.role) submitConvert(o, o.company, o.role); else setConv({ id: o.id, company: o.company ?? '', role: o.role ?? '' }) }
  async function submitConvert(o: Opportunity, company: string, role: string) {
    if (!company.trim() || !role.trim()) return setNotice({ ok: false, text: 'Company and role are both required to track an application.' })
    const ok = await run(async () => (await supabase.from('applications').insert({ opportunity_id: o.id, company: company.trim(), role: role.trim(), type: o.type, url: o.url, source: o.source, deadline: o.deadline, assessment_date: o.assessment_date, interview_date: o.interview_date })).error?.message ?? null, 'Added to Applications.')
    if (ok) setConv(null)
  }
  async function del(o: Opportunity) { if (!window.confirm('Delete this opportunity?')) return; await run(async () => (await supabase.from('opportunities').delete().eq('id', o.id)).error?.message ?? null, 'Opportunity deleted.') }
  const set = (k: TextKey, v: string) => setDraft(d => d && { ...d, [k]: v.trim() === '' ? null : v })
  const field = (k: TextKey, label: string, type = 'text') => <label>{label}<input type={type} value={(draft?.[k] as string | null) ?? ''} onChange={e => set(k, e.target.value)} /></label>
  return <><h1>Opportunity Radar</h1><p className="muted">Paste text from an email, chat or announcement that you are allowed to share. “Analyze with AI” sends it to the AI provider configured on the server (when set up); “Analyze with rules” runs in your browser with no AI. Review and correct every field before saving. Optional Gmail read-only import and CSV/JSON file import are available after configuration. WhatsApp and LinkedIn are not directly connected; you can paste text or import a supported file.</p>
    {notice && <p role={notice.ok ? 'status' : 'alert'} className={notice.ok ? 'ok' : 'err'}>{notice.text}</p>}
    <div className="card"><h2>Optional Gmail import (read-only)</h2><p className="muted">Requires a Google OAuth web client ID, Gmail API enabled, and an approved read-only consent screen. Only the 10 most recent matching messages from the last 30 days are fetched when you click the button. The access token is kept in memory and is not stored.</p><button className="ghost" onClick={importGmail} disabled={gmailBusy || busy}>{gmailBusy ? "Connecting to Gmail…" : "Fetch recent job-related emails"}</button>{gmailMessages.length > 0 && <ul className="list">{gmailMessages.map(m => <li key={m.id}><div><b>{m.subject}</b><div className="muted">{m.from} · {m.date}</div></div><button className="ghost" onClick={() => useGmailMessage(m)}>Review this email</button></li>)}</ul>}<hr /><label>Import opportunities from CSV or JSON (max 2 MB, 200 rows)<input type="file" accept=".csv,.json,text/csv,application/json" onChange={onImportFile} disabled={busy} /></label><p className="muted">Expected columns include company and role; optional fields: type, URL, deadline, assessment date, interview date, source, description. Imported rows are previewed before saving.</p>{importRows.length > 0 && <div className="card"><h2>Review file import ({importSelected.size}/{importRows.length} selected)</h2><div className="row"><button className="ghost" onClick={() => setImportSelected(new Set(importRows.map((_, i) => i)))}>Select all</button><button className="ghost" onClick={() => setImportSelected(new Set())}>Clear selection</button></div><ul className="list">{importRows.map((r, i) => <li key={`${i}:${r.company}:${r.role}`}><label className="check"><input type="checkbox" checked={importSelected.has(i)} onChange={e => setImportSelected(prev => { const n = new Set(prev); e.target.checked ? n.add(i) : n.delete(i); return n })} /> <b>{r.company ?? "Company not identified"} — {r.role ?? "Role not identified"}</b><span className="muted"> {r.deadline ? `Deadline ${r.deadline}` : "No deadline"}</span></label></li>)}</ul><button onClick={saveImport} disabled={busy}>{busy ? "Importing…" : `Import ${importSelected.size} selected rows`}</button><button className="ghost" onClick={() => { setImportRows([]); setImportSelected(new Set()) }}>Cancel import</button></div>}<hr /><label>Message<textarea rows={6} value={text} onChange={e => { setText(e.target.value); setInputSource("Pasted message") }} /></label><p className="muted">Source: {inputSource}</p><div className="row"><button onClick={analyzeAi} disabled={busy}>{busy ? 'Analyzing…' : 'Analyze with AI'}</button><button className="ghost" onClick={analyze} disabled={busy}>Analyze with rules (no AI)</button></div><p className="muted">AI mode sends this message to the AI provider configured on the server. Do not paste anything you are not allowed to share. Results can be wrong: always review.</p></div>
    {draft && <div className="card grid"><h2>Review extracted details</h2><p className="muted">Extracted by: {draft.method === 'ai' ? 'AI (unverified, review every field)' : 'rule-based extractor'}</p>{warn.map(w => <p key={w} className="warn">Review needed — {w}</p>)}
      {dup && <p className="warn">Possible duplicate — a similar opportunity already exists ({dup.company} — {dup.role}). {force ? 'Press Save again to keep both.' : ''}</p>}
      {field('company', 'Company')}{field('role', 'Role')}{field('type', 'Type')}{field('action', 'Required action')}{field('url', 'Application URL', 'url')}{field('deadline', 'Deadline', 'date')}{field('assessment_date', 'Assessment date', 'date')}{field('interview_date', 'Interview date', 'date')}
      {draft.details && <p className="muted">Eligibility: {draft.details.eligibility ?? 'not stated'} · Graduation years: {draft.details.graduation_years.join(', ') || 'not stated'} · Skills: {draft.details.required_skills.join(', ') || 'not stated'} · Location: {draft.details.location ?? 'not stated'} · Work mode: {draft.details.work_mode ?? 'not stated'} · Instructions: {draft.details.instructions ?? 'none'}{draft.details.inferred.length ? ` · Inferred by AI (not explicit): ${draft.details.inferred.join(', ')}` : ''}</p>}
      <div className="row"><button className="ghost" onClick={() => { setDraft(null); setForce(false) }}>Dismiss</button></div>
      <button onClick={save} disabled={busy}>{busy ? 'Saving…' : dup && !force ? 'Review duplicate' : 'Save opportunity'}</button></div>}
    <h2>Saved opportunities</h2>{opps.length === 0 ? <p className="card">None yet. Analyze a message above.</p> :
    <ul className="list">{opps.map(o => { const c = classify(o.deadline ?? o.assessment_date ?? o.interview_date); return <li key={o.id}><div><span className={`tag ${c.state}`}>{c.state}</span> <b>{o.company ?? 'Company not identified'}</b> — {o.role ?? 'Role not identified'}<div className="muted">{c.reason}{o.action ? ` Action: ${o.action}.` : ''}</div></div>
      <div className="row"><button className="ghost" disabled={busy} onClick={() => startConvert(o)}>Track as application</button><button className="ghost danger" disabled={busy} onClick={() => del(o)}>Delete</button></div>
      {conv?.id === o.id && <form className="grid full" onSubmit={e => { e.preventDefault(); submitConvert(o, conv.company, conv.role) }}><p className="warn">Add the missing details before tracking this application.</p>
        <label>Company<input required value={conv.company} onChange={e => setConv({ ...conv, company: e.target.value })} /></label><label>Role<input required value={conv.role} onChange={e => setConv({ ...conv, role: e.target.value })} /></label>
        <div className="row"><button disabled={busy}>{busy ? 'Saving…' : 'Save application'}</button><button type="button" className="ghost" onClick={() => setConv(null)}>Cancel</button></div></form>}</li> })}</ul>}</>
}
