import { describe, it, expect } from 'vitest'
import { validateExtraction, validateSkillMap, AiValidationError } from './aiSchemas'
import { buildReminders, filterReminders, reminderKey } from './reminders'
import type { Application } from './types'
const SRC = 'Acme Corp is hiring a Backend Intern. Apply at https://acme.com/jobs by 2030-03-15. Open to 2027 graduates.'
describe('validateExtraction', () => {
  it('accepts grounded output and keeps nulls', () => { const v = validateExtraction({ company: 'Acme Corp', role: 'Backend Intern', url: 'https://acme.com/jobs', deadline: '2030-03-15', details: { graduation_years: [2027], work_mode: 'remote' } }, SRC); expect(v.company).toBe('Acme Corp'); expect(v.url).toBe('https://acme.com/jobs'); expect(v.interview_date).toBeNull(); expect(v.details.graduation_years).toEqual([2027]); expect(v.warnings).toEqual([]) })
  it('drops fabricated URLs, invalid dates, and flags unseen companies', () => { const v = validateExtraction({ company: 'Globex', url: 'https://evil.example/x', deadline: '2030-02-30', assessment_date: 'next friday' }, SRC); expect(v.url).toBeNull(); expect(v.deadline).toBeNull(); expect(v.assessment_date).toBeNull(); expect(v.warnings.join(' ')).toMatch(/Globex/); expect(v.warnings.length).toBeGreaterThanOrEqual(4) })
  it('rejects malformed output', () => { for (const bad of [null, 'text', [1], 42]) expect(() => validateExtraction(bad, SRC)).toThrow(AiValidationError) })
  it('ignores wrong types and non-http URLs', () => { const v = validateExtraction({ company: 5, role: {}, url: 'javascript:alert(1)', details: { work_mode: 'moon', graduation_years: ['x', 1800, 2026] } }, SRC); expect(v.company).toBeNull(); expect(v.url).toBeNull(); expect(v.details.work_mode).toBeNull(); expect(v.details.graduation_years).toEqual([2026]) })
})
describe('validateSkillMap', () => {
  const resume = 'Built REST APIs in Python and deployed with Docker.'
  it('keeps evidenced skills and demotes unsupported claims', () => { const v = validateSkillMap({ required_skills: ['python', 'kubernetes'], matched: [{ skill: 'Python', evidence: 'REST APIs in Python' }, { skill: 'Kubernetes', evidence: 'ran clusters at scale' }], missing: [{ skill: 'aws', status: 'weak' }] }, resume); expect(v.matched.map(m => m.skill)).toEqual(['Python']); expect(v.missing.find(m => m.skill === 'Kubernetes')?.status).toBe('unverified'); expect(v.warnings).toHaveLength(1); expect(v.score).toEqual({ evidenced: 1, total: 3 }) })
  it('survives empty and malformed sections', () => { const v = validateSkillMap({ matched: 'x', missing: [null, 7], learning: [{ topic: 'SQL', priority: 'urgent' }] }, resume); expect(v.matched).toEqual([]); expect(v.learning[0].priority).toBe('medium'); expect(v.score.total).toBe(0); expect(() => validateSkillMap(undefined, resume)).toThrow(AiValidationError) })
})
describe('reminders', () => {
  const now = new Date(2030, 0, 10, 12), base = { opportunity_id: null, type: null, url: null, source: null, notes: null, created_at: '', follow_up_date: null, assessment_date: null, interview_date: null, deadline: null }
  const app = (o: Partial<Application>): Application => ({ ...base, id: 'a', company: 'C', role: 'R', status: 'Applied', ...o } as Application)
  it('derives items, hides completed by default, sorts by date', () => {
    const list = buildReminders([app({ id: '1', status: 'Saved', deadline: '2030-01-10', interview_date: '2030-01-05' }), app({ id: '2', status: 'Rejected', interview_date: '2030-01-12' }), app({ id: '3', status: 'Applied', deadline: '2030-01-09' })], [], now)
    expect(list.map(r => r.key)).toEqual(['application:1:Interview', 'application:3:Application deadline', 'application:1:Application deadline', 'application:2:Interview'])
    expect(filterReminders(list, {}).map(r => r.recordId)).toEqual(['1', '1']); expect(filterReminders(list, { includeDone: true })).toHaveLength(4)
    const dismissed = new Set([reminderKey(list[0])]); expect(filterReminders(list, { dismissed }).map(r => r.key)).not.toContain(list[0].key); expect(filterReminders(list, { dismissed, showDismissed: true }).map(r => r.key)).toContain(list[0].key)
    expect(filterReminders(list, { dismissed: new Set([`${list[0].key}@2000-01-01`]) }).map(r => r.key)).toContain(list[0].key) // moved date => reappears
    expect(filterReminders(list, { state: 'overdue' }).map(r => r.type)).toEqual(['Interview']); expect(filterReminders(list, { type: 'Application deadline' }).length).toBe(1) })
})
