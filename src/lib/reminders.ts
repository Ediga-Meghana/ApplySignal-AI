import { classify, isDone, type Urgency } from './deadline'
import type { Application, Opportunity } from './types'
export type ReminderType = 'Application deadline' | 'Assessment' | 'Interview' | 'Follow-up'
export interface Reminder { key: string; type: ReminderType; title: string; date: string; state: Urgency; reason: string; recordId: string; kind: 'application' | 'opportunity' }
/** One source of truth for every date-based reminder: derived from saved records, so nothing is fake or stale. */
export function buildReminders(apps: Application[], opps: Opportunity[], now = new Date()): Reminder[] {
  const out: Reminder[] = []
  const add = (kind: Reminder['kind'], id: string, type: ReminderType, title: string, date: string | null, done: boolean) => { if (!date) return; const c = classify(date, done, now); out.push({ key: `${kind}:${id}:${type}`, type, title, date, state: c.state, reason: c.reason, recordId: id, kind }) }
  for (const a of apps) { const t = `${a.company} — ${a.role}`; add('application', a.id, 'Application deadline', t, a.deadline, isDone('deadline', a.status)); add('application', a.id, 'Assessment', t, a.assessment_date, isDone('event', a.status)); add('application', a.id, 'Interview', t, a.interview_date, isDone('event', a.status)); add('application', a.id, 'Follow-up', t, a.follow_up_date, isDone('event', a.status)) }
  for (const o of opps) { const t = `${o.company ?? 'Company not identified'} — ${o.role ?? 'Role not identified'}`; add('opportunity', o.id, 'Application deadline', t, o.deadline, false); add('opportunity', o.id, 'Assessment', t, o.assessment_date, false); add('opportunity', o.id, 'Interview', t, o.interview_date, false) }
  return out.sort((x, y) => x.date.localeCompare(y.date) || x.key.localeCompare(y.key))
}
/** A dismissal is tied to the date, so moving a deadline makes the reminder reappear. */
export const reminderKey = (r: Reminder) => `${r.key}@${r.date}`
export function filterReminders(list: Reminder[], f: { type?: string; state?: string; includeDone?: boolean; dismissed?: Set<string>; showDismissed?: boolean }): Reminder[] {
  return list.filter(r => (f.showDismissed || !f.dismissed?.has(reminderKey(r))) && (f.type ? r.type === f.type : true) && (f.state ? r.state === f.state : f.includeDone || r.state !== 'done'))
}
