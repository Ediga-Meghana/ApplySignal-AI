import { describe, expect, it } from 'vitest'
import { ImportError, parseOpportunityImport } from './importOpportunities'
describe('opportunity CSV/JSON import', () => {
  it('parses CSV with quoted commas and maps common headers', () => {
    const r = parseOpportunityImport('Company,Job Title,Deadline,URL\n"Acme, Inc.",Software Intern,2031-03-15,https://example.com/job', 'jobs.csv')
    expect(r[0]).toMatchObject({ company: 'Acme, Inc.', role: 'Software Intern', deadline: '2031-03-15', url: 'https://example.com/job' })
  })
  it('parses JSON and rejects invalid dates', () => {
    expect(parseOpportunityImport('[{"company":"Acme","role":"Intern"}]', 'jobs.json')).toHaveLength(1)
    expect(() => parseOpportunityImport('[{"company":"Acme","role":"Intern","deadline":"2030-02-30"}]', 'jobs.json')).toThrow(ImportError)
  })
  it('rejects malformed files and unsupported extensions', () => {
    expect(() => parseOpportunityImport('not a file', 'jobs.xlsx')).toThrow(ImportError)
    expect(() => parseOpportunityImport('Company,Role\n"Acme,Intern', 'jobs.csv')).toThrow(ImportError)
  })
})
