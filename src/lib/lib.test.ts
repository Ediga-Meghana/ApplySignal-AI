import { describe, it, expect } from 'vitest'
import { extractOpportunity, isDuplicate, parseDate } from './extract'
import { classify, isDone } from './deadline'
import { analyzeSkills } from './skills'
describe('extract', () => {
  it('finds company and deadline', () => { const r = extractOpportunity('Apply for Software Intern at Acme Corp. Deadline: 15 March 2030. https://acme.com/jobs'); expect(r.company).toBe('Acme Corp'); expect(r.deadline).toBe('2030-03-15'); expect(r.url).toBe('https://acme.com/jobs') })
  it('does not invent missing data', () => { const r = extractOpportunity('hello there'); expect(r.company).toBeNull(); expect(r.deadline).toBeNull() })
  it('rejects ambiguous dates', () => { expect(parseDate('due 03/04/2030')).toBeNull(); expect(parseDate('due 25/04/2030')).toBe('2030-04-25') })
  it('detects duplicates but keeps different roles', () => { expect(isDuplicate({company:' ACME ',role:'Intern'},{company:'acme',role:'intern'})).toBe(true); expect(isDuplicate({company:'Acme',role:'Intern'},{company:'Acme',role:'Analyst'})).toBe(false) })
})
describe('deadline', () => {
  const now = new Date(2030, 0, 10, 12, 0) // 10 Jan 2030, 12:00 local
  const c = (d: string | null, done = false) => classify(d, done, now)
  it('later today is urgent and "due today", never "1 day"', () => { for (const d of ['2030-01-10T18:00', '2030-01-10']) { const r = c(d); expect(r.state).toBe('urgent'); expect(r.days).toBe(0); expect(r.reason).toBe('Urgent: due today.') } })
  it('already passed today is overdue (earlier today)', () => { const r = c('2030-01-10T09:00'); expect(r.state).toBe('overdue'); expect(r.reason).toMatch(/earlier today/) })
  it('tomorrow', () => { const r = c('2030-01-11'); expect(r.state).toBe('urgent'); expect(r.reason).toBe('Urgent: due tomorrow.') })
  it('urgency boundary: 3 days urgent, 4 days upcoming', () => { expect(c('2030-01-13').state).toBe('urgent'); expect(c('2030-01-14').state).toBe('upcoming') })
  it('past days are overdue with a positive count', () => { expect(c('2030-01-09').reason).toBe('Overdue: the deadline passed 1 day ago.'); expect(c('2030-01-01').reason).toBe('Overdue: the deadline passed 9 days ago.') })
  it('exactly at the deadline instant is not yet overdue', () => { expect(classify('2030-01-10T12:00', false, new Date(2030, 0, 10, 12, 0)).state).toBe('urgent') })
  it('invalid dates', () => { for (const d of ['2030-02-30', 'abc', '2030-13-01', '10/01/2030']) expect(c(d).state).toBe('invalid') })
  it('missing dates', () => { for (const d of [null, undefined, '']) expect(classify(d, false, now).state).toBe('none') })
  it('completed wins over everything', () => { expect(c('2020-01-01', true).state).toBe('done'); expect(c(null, true).state).toBe('done') })
  it('month boundary near midnight is calendar-based', () => { expect(classify('2030-02-01', false, new Date(2030, 0, 31, 23, 30)).reason).toBe('Urgent: due tomorrow.') })
  it('done rules', () => { expect(isDone('deadline', 'Applied')).toBe(true); expect(isDone('deadline', 'Saved')).toBe(false); expect(isDone('event', 'Interview')).toBe(false); expect(isDone('event', 'Rejected')).toBe(true) })
})
describe('skills', () => { it('compares', () => { const r = analyzeSkills('I know Python and SQL', 'Needs python, sql, docker'); expect(r.matched).toEqual(['python','sql']); expect(r.missing).toEqual(['docker']) }) })
