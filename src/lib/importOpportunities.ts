import { parseDeadline } from './deadline'
export type ImportedOpportunity = { company: string | null; role: string | null; type: string | null; url: string | null; deadline: string | null; assessment_date: string | null; interview_date: string | null; source: string; snippet: string | null }
export class ImportError extends Error {}
const clean = (v: unknown, max = 500) => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
const date = (v: unknown) => { const s = clean(v, 30); if (!s) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !parseDeadline(s)) throw new ImportError(`Invalid date "${s}". Use YYYY-MM-DD.`); return s }
const url = (v: unknown) => { const s = clean(v, 1000); if (!s) return null; try { const u = new URL(s); if (!['http:', 'https:'].includes(u.protocol)) throw new Error(); return u.toString() } catch { throw new ImportError(`Invalid URL "${s}".`) } }
function normalize(o: Record<string, unknown>): ImportedOpportunity {
  const keyMap = new Map(Object.keys(o).map(k => [k.toLowerCase().replace(/[ _-]/g, ''), k]))
  const get = (...names: string[]) => { for (const n of names) { const k = keyMap.get(n.toLowerCase().replace(/[ _-]/g, '')); if (k) return o[k] } return null }
  return { company: clean(get('company','organization','employer'), 200), role: clean(get('role','title','jobtitle','position'), 200), type: clean(get('type','opportunitytype'), 80), url: url(get('url','link','applicationurl','joburl')), deadline: date(get('deadline','applicationdeadline','duedate')), assessment_date: date(get('assessmentdate','assessment')), interview_date: date(get('interviewdate','interview')), source: clean(get('source'), 120) ?? 'Imported file', snippet: clean(get('snippet','description','details','message'), 5000) }
}
function parseCsv(text: string): Record<string, unknown>[] {
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) { const c = text[i]
    if (quoted) { if (c === '"' && text[i+1] === '"') { field += '"'; i++ } else if (c === '"') quoted = false; else field += c }
    else if (c === '"' && field.length === 0) quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (quoted) throw new ImportError('The CSV contains an unclosed quoted field.')
  if (field.length || row.length) { row.push(field); rows.push(row) }
  const useful = rows.filter(r => r.some(c => c.trim()))
  if (useful.length < 2) throw new ImportError('The CSV needs a header row and at least one opportunity row.')
  const headers = useful[0].map(h => h.trim())
  if (!headers.some(h => /^(company|organization|employer)$/i.test(h)) || !headers.some(h => /^(role|title|job title|position)$/i.test(h))) throw new ImportError('CSV headers must include company and role (or organization and title).')
  return useful.slice(1).map(cells => Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ''])))
}
/** Parses user-selected CSV/JSON exports. Nothing is uploaded until the user reviews and confirms. */
export function parseOpportunityImport(text: string, filename: string): ImportedOpportunity[] {
  text = text.replace(/^\uFEFF/, '')
  if (text.length > 2_000_000) throw new ImportError('Import files must be smaller than 2 MB.')
  const ext = filename.toLowerCase().split('.').pop()
  let raw: unknown
  try { raw = ext === 'json' ? JSON.parse(text) : ext === 'csv' ? parseCsv(text) : null } catch (e) { if (e instanceof ImportError) throw e; throw new ImportError('Could not parse this file. Check the CSV or JSON syntax.') }
  if (!raw) throw new ImportError('Only CSV and JSON files are supported.')
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 200) throw new ImportError('Provide between 1 and 200 opportunity rows.')
  const result = raw.map((x, i) => { if (!x || typeof x !== 'object' || Array.isArray(x)) throw new ImportError(`Row ${i + 1} is not an object.`); return normalize(x as Record<string, unknown>) })
  if (result.some(x => !x.company && !x.role)) throw new ImportError('Each row needs at least a company or a role.')
  return result
}
