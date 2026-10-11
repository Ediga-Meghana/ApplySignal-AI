export type Urgency = 'overdue' | 'urgent' | 'upcoming' | 'none' | 'done' | 'invalid'
export interface Classified { state: Urgency; reason: string; days: number | null }
/** Policy: "urgent" = due within URGENT_DAYS calendar days (today counts as day 0). */
export const URGENT_DAYS = 3
/** An application deadline is satisfied once the application is submitted; other events end at Offer/Rejected. */
export const isDone = (kind: 'deadline' | 'event', status: string) => kind === 'deadline' ? status !== 'Saved' : status === 'Offer' || status === 'Rejected'
/**
 * Accepts yyyy-mm-dd (valid until 23:59:59.999 LOCAL time that day) or an ISO datetime
 * (no zone = local time; with Z/offset = exact instant). Anything else, including 2030-02-30, is invalid.
 */
export function parseDeadline(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (m) { const d = new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999); return d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) { const d = new Date(v); return isNaN(d.getTime()) ? null : d }
  return null
}
// Calendar-day index in the local timezone; DST-safe because it goes through UTC midnight of the local Y/M/D.
const dayIndex = (d: Date) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000)
export function classify(deadline: string | null | undefined, completed = false, now = new Date()): Classified {
  if (completed) return { state: 'done', reason: 'No action required.', days: null }
  if (!deadline) return { state: 'none', reason: 'No deadline recorded.', days: null }
  const end = parseDeadline(deadline)
  if (!end) return { state: 'invalid', reason: 'Invalid date recorded. Edit it to fix.', days: null }
  const days = dayIndex(end) - dayIndex(now)
  if (end.getTime() < now.getTime()) {
    const ago = -days
    return { state: 'overdue', days, reason: ago === 0 ? 'Overdue: the deadline passed earlier today.' : `Overdue: the deadline passed ${ago} day${ago === 1 ? '' : 's'} ago.` }
  }
  if (days === 0) return { state: 'urgent', days, reason: 'Urgent: due today.' }
  if (days === 1) return { state: 'urgent', days, reason: 'Urgent: due tomorrow.' }
  if (days <= URGENT_DAYS) return { state: 'urgent', days, reason: `Urgent: due in ${days} days.` }
  return { state: 'upcoming', days, reason: `Upcoming: due in ${days} days.` }
}
