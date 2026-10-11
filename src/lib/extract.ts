export interface Extracted { company: string|null; role: string|null; type: string|null; action: string|null; url: string|null; source: string|null; deadline: string|null; assessment_date: string|null; interview_date: string|null; snippet: string|null; warnings: string[] }
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
const iso = (y: number, m: number, d: number) => { const t = new Date(y, m, d); return t.getFullYear()===y && t.getMonth()===m && t.getDate()===d ? `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}` : null }
/** Returns a date only when it is unambiguous. Year-less dates and dd/mm vs mm/dd conflicts return null. */
export function parseDate(s: string): string | null {
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s); if (m) return iso(+m[1], +m[2]-1, +m[3])
  m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b/i.exec(s)
  if (m) return iso(+m[3], MONTHS.indexOf(m[2].toLowerCase()), +m[1])
  m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i.exec(s)
  if (m) return iso(+m[3], MONTHS.indexOf(m[1].toLowerCase()), +m[2])
  m = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\b/.exec(s)
  if (m && (+m[1] > 12 || +m[2] > 12 || m[1] === m[2])) return +m[1] > 12 ? iso(+m[3], +m[2]-1, +m[1]) : iso(+m[3], +m[1]-1, +m[2])
  return null
}
const firstDate = (text: string, kw: RegExp) => { for (const part of text.split(/(?<=[.!?\n])\s+/)) if (kw.test(part)) { const d = parseDate(part); if (d) return d } return null }
export function extractOpportunity(text: string): Extracted {
  const warnings: string[] = []; const t = text.trim()
  const url = /https?:\/\/[^\s)>"']+/.exec(t)?.[0].replace(/[.,;]+$/, '') ?? null
  const company = /\b(?:at|from|with|by)\s+([A-Z][\w&-]*(?:\s+[A-Z][\w&-]*){0,3})(?=[\s,.!:;]|$)/.exec(t)?.[1] ?? /^\s*(?:company|organization)\s*:\s*(.+)$/im.exec(t)?.[1]?.trim() ?? null
  const role = /\b((?:[A-Z][\w+#.-]*\s+){0,3}(?:Intern(?:ship)?|Engineer|Developer|Analyst|Trainee|Associate))\b/.exec(t)?.[1]?.trim() ?? /^\s*(?:role|position)\s*:\s*(.+)$/im.exec(t)?.[1]?.trim() ?? null
  const type = /\bintern(ship)?\b/i.test(t) ? 'Internship' : /\bfull[- ]?time\b/i.test(t) ? 'Full-time' : role ? 'Job' : null
  const interview_date = firstDate(t, /interview/i), assessment_date = firstDate(t, /assessment|online test|coding test|\btest\b/i)
  const deadline = firstDate(t, /deadline|apply (?:by|before)|last date|closes?|due/i)
  const action = interview_date ? 'Attend interview' : assessment_date || /assessment|online test/i.test(t) ? 'Complete assessment' : /apply|application/i.test(t) ? 'Submit application' : null
  if (!company) warnings.push('Company name was not identified. Please enter it.')
  if (!role) warnings.push('Role was not identified. Please enter it.')
  if (!deadline && !assessment_date && !interview_date) warnings.push('No unambiguous date found. Dates are never guessed.')
  return { company, role, type, action, url, source: 'Pasted message', deadline, assessment_date, interview_date, snippet: t.slice(0, 500) || null, warnings }
}
export const norm = (s?: string|null) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
export function isDuplicate(a: {company?:string|null;role?:string|null;url?:string|null}, b: typeof a): boolean {
  if (a.url && b.url && norm(a.url) === norm(b.url)) return true
  return !!norm(a.company) && !!norm(a.role) && norm(a.company) === norm(b.company) && norm(a.role) === norm(b.role)
}
