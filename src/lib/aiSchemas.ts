import { parseDeadline } from './deadline'
export class AiValidationError extends Error {}
const str = (v: unknown, max = 300) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
const strs = (v: unknown, n = 30) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map(x => x.trim().slice(0, 120)).slice(0, n) : []
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
export interface AiDetails { eligibility: string | null; graduation_years: number[]; required_skills: string[]; location: string | null; work_mode: 'remote' | 'hybrid' | 'onsite' | null; instructions: string | null; inferred: string[] }
export interface AiExtraction { company: string | null; role: string | null; type: string | null; action: string | null; url: string | null; deadline: string | null; assessment_date: string | null; interview_date: string | null; details: AiDetails; warnings: string[] }
/** Never trusts the model: bad dates/URLs are dropped, and a URL not present in the source text is discarded as fabricated. */
export function validateExtraction(raw: unknown, source: string): AiExtraction {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AiValidationError('The AI response was not a JSON object.')
  const r = obj(raw), d = obj(r.details), w: string[] = [], src = norm(source)
  const date = (k: string) => { const v = str(r[k], 20); if (!v) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !parseDeadline(v)) { w.push(`Ignored invalid ${k.replace('_', ' ')} "${v}".`); return null } return v }
  let url = str(r.url, 500)
  if (url) { try { if (!/^https?:$/.test(new URL(url).protocol)) throw new Error() } catch { w.push('Ignored an invalid URL.'); url = null } }
  if (url && !src.includes(norm(url).replace(/\/$/, ''))) { w.push('Ignored a URL that does not appear in the source text.'); url = null }
  const company = str(r.company), role = str(r.role)
  if (company && !src.includes(norm(company))) w.push(`Company "${company}" does not appear in the source text. Verify it.`)
  if (role && !src.includes(norm(role))) w.push(`Role "${role}" does not appear word-for-word in the source text. Verify it.`)
  const wm = d.work_mode === 'remote' || d.work_mode === 'hybrid' || d.work_mode === 'onsite' ? d.work_mode : null
  const details: AiDetails = { eligibility: str(d.eligibility, 500), graduation_years: (Array.isArray(d.graduation_years) ? d.graduation_years : []).filter((n): n is number => Number.isInteger(n) && n >= 1990 && n <= 2100).slice(0, 6), required_skills: strs(d.required_skills), location: str(d.location, 120), work_mode: wm, instructions: str(d.instructions, 800), inferred: strs(d.inferred, 20) }
  const out = { company, role, type: str(r.type, 40), action: str(r.action, 120), url, deadline: date('deadline'), assessment_date: date('assessment_date'), interview_date: date('interview_date'), details, warnings: w }
  if (!company && !role && !url && !out.deadline) w.push('The AI found few details. Check the message and fill fields manually.')
  return out
}
export interface AiSkillMap { required: string[]; matched: { skill: string; evidence: string }[]; missing: { skill: string; status: 'not_mentioned' | 'weak' | 'unverified' }[]; transferable: { skill: string; reason: string }[]; learning: { topic: string; priority: 'high' | 'medium' | 'low'; why: string }[]; projects: string[]; roadmap: { week: string; focus: string }[]; interview_topics: string[]; score: { evidenced: number; total: number }; warnings: string[] }
const list = <T,>(v: unknown, f: (o: Record<string, unknown>) => T | null, n = 30) => (Array.isArray(v) ? v : []).slice(0, n).map(x => f(obj(x))).filter((x): x is T => x !== null)
/** A "matched" skill only counts if its evidence quote really appears in the resume; otherwise it is demoted to "unverified". */
export function validateSkillMap(raw: unknown, resume: string): AiSkillMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AiValidationError('The AI response was not a JSON object.')
  const r = obj(raw), w: string[] = [], res = norm(resume)
  const matched: AiSkillMap['matched'] = [], missing: AiSkillMap['missing'] = list(r.missing, o => { const skill = str(o.skill, 80); return skill ? { skill, status: o.status === 'weak' ? 'weak' as const : 'not_mentioned' as const } : null })
  for (const m of list(r.matched, o => { const skill = str(o.skill, 80), evidence = str(o.evidence, 400); return skill ? { skill, evidence: evidence ?? '' } : null })) {
    if (m.evidence && res.includes(norm(m.evidence))) matched.push(m); else { missing.push({ skill: m.skill, status: 'unverified' }); w.push(`"${m.skill}" was demoted to unverified: its evidence quote was not found in the resume.`) }
  }
  const required = [...new Set([...strs(r.required_skills, 50), ...matched.map(m => m.skill), ...missing.map(m => m.skill)].map(s => s.toLowerCase()))]
  const pri = (p: unknown) => p === 'high' || p === 'medium' || p === 'low' ? p : 'medium'
  return { required, matched, missing, transferable: list(r.transferable, o => { const skill = str(o.skill, 80), reason = str(o.reason, 300); return skill && reason ? { skill, reason } : null }),
    learning: list(r.learning, o => { const topic = str(o.topic, 120); return topic ? { topic, priority: pri(o.priority) as 'high', why: str(o.why, 300) ?? '' } : null }),
    projects: strs(r.projects, 10), roadmap: list(r.roadmap, o => { const focus = str(o.focus, 300); return focus ? { week: str(o.week, 40) ?? '', focus } : null }, 12), interview_topics: strs(r.interview_topics, 15),
    score: { evidenced: matched.length, total: required.length }, warnings: w }
}
