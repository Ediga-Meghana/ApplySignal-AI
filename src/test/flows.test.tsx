// @vitest-environment jsdom
// UI flow tests against an in-memory fake backend (see fakeSupabase.ts). They verify UI behaviour, not live Supabase or RLS.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import * as sb from '../lib/supabase'
import { AuthProvider } from '../auth'
import App from '../App'
vi.mock('../lib/supabase', async () => { const { createFake } = await import('./fakeSupabase'); const f = createFake(); return { supabase: f.client, configured: true, __fake: f } })
const fake = (sb as unknown as { __fake: ReturnType<typeof import('./fakeSupabase').createFake> }).__fake
const ui = userEvent.setup(); let A: string
beforeEach(() => { cleanup(); fake.reset(); window.scrollTo = vi.fn(); vi.spyOn(window, 'confirm').mockReturnValue(true); A = fake.addUser('a@x.com', 'password1'); fake.addUser('b@x.com', 'password1') })
const open = (path = '/') => render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>)
async function login(email: string) { await ui.type(await screen.findByLabelText('Email'), email); await ui.type(screen.getByLabelText('Password'), 'password1'); await ui.click(screen.getByRole('button', { name: 'Sign in' })); await screen.findByRole('heading', { name: 'Dashboard' }) }
const go = async (name: string) => { await ui.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name })) }
async function addApp(company: string, role: string) { await go('Applications'); await ui.type(await screen.findByLabelText('Company'), company); await ui.type(screen.getByLabelText('Role'), role); await ui.click(screen.getByRole('button', { name: 'Save application' })); await screen.findByRole('link', { name: `${company} — ${role}` }) }

describe('authentication', () => {
  it('protects routes, rejects bad credentials, signs in and out', async () => {
    open('/applications'); expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
    await ui.type(screen.getByLabelText('Email'), 'a@x.com'); await ui.type(screen.getByLabelText('Password'), 'wrongpass1'); await ui.click(screen.getByRole('button', { name: 'Sign in' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Invalid login/)
    await ui.clear(screen.getByLabelText('Password')); await ui.type(screen.getByLabelText('Password'), 'password1'); await ui.click(screen.getByRole('button', { name: 'Sign in' }))
    await screen.findByRole('heading', { name: 'Dashboard' }); await ui.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy()
  })
  it('validates sign-up and shows confirmation', async () => {
    open('/signup'); await ui.type(await screen.findByLabelText('Email'), 'new@x.com'); await ui.type(screen.getByLabelText('Password'), 'short'); await ui.click(screen.getByRole('button', { name: 'Create account' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/at least 8/)
    await ui.clear(screen.getByLabelText('Password')); await ui.type(screen.getByLabelText('Password'), 'longenough1'); await ui.click(screen.getByRole('button', { name: 'Create account' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Account created/)
  })
})
describe('application CRUD and detail page', () => {
  it('creates, changes status, opens detail, edits and deletes', async () => {
    open(); await login('a@x.com'); await addApp('Acme', 'Intern')
    await ui.selectOptions(screen.getByLabelText('Status for Acme'), 'Applied'); expect((screen.getByLabelText('Status for Acme') as HTMLSelectElement).value).toBe('Applied')
    await ui.click(screen.getByRole('link', { name: 'Acme — Intern' })); expect(await screen.findByRole('heading', { name: 'Acme — Intern' })).toBeTruthy()
    await ui.click(screen.getByRole('link', { name: 'Edit' })); const role = await screen.findByLabelText('Role'); expect((screen.getByLabelText('Company') as HTMLInputElement).value).toBe('Acme')
    await ui.clear(role); await ui.type(role, 'Analyst'); await ui.click(screen.getByRole('button', { name: 'Save application' })); await screen.findByRole('link', { name: 'Acme — Analyst' })
    await ui.click(screen.getByRole('button', { name: 'Delete' })); expect(await screen.findByText(/No applications yet/)).toBeTruthy()
  })
})
describe('Opportunity Radar', () => {
  it('converts an opportunity with a missing company only after the user supplies it', async () => {
    open(); await login('a@x.com'); await go('Opportunity Radar')
    await ui.type(await screen.findByLabelText('Message'), 'Internship opportunity. Deadline: 15 March 2031.'); await ui.click(screen.getByRole('button', { name: 'Analyze with rules (no AI)' }))
    expect(await screen.findByText(/Company name was not identified/)).toBeTruthy(); await ui.click(screen.getByRole('button', { name: 'Save opportunity' })); await screen.findByText('Opportunity saved.')
    await ui.click(screen.getByRole('button', { name: 'Track as application' })); expect(await screen.findByText(/Add the missing details/)).toBeTruthy(); expect(fake.tables.applications ?? []).toHaveLength(0)
    await ui.type(screen.getByLabelText('Company'), 'Globex'); await ui.click(screen.getByRole('button', { name: 'Save application' })); await screen.findByText('Added to Applications.')
    expect(fake.tables.applications[0]).toMatchObject({ company: 'Globex', role: 'Internship', deadline: '2031-03-15' })
  })
  it('falls back to rules and says so when AI is not configured', async () => {
    open(); await login('a@x.com'); await go('Opportunity Radar'); await ui.type(await screen.findByLabelText('Message'), 'Software Intern at Acme. Apply by 2031-01-05.'); await ui.click(screen.getByRole('button', { name: 'Analyze with AI' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/AI is not configured.*rule-based fallback/); expect(screen.getByText(/rule-based extractor/)).toBeTruthy()
  })
})
describe('SkillMap', () => {
  it('compares, saves the analysis and tracks learning tasks', async () => {
    open(); await login('a@x.com'); await go('SkillMap')
    await ui.type(await screen.findByLabelText('Target role'), 'Backend Intern'); await ui.type(screen.getByLabelText(/Resume text/), 'I know Python.'); await ui.type(screen.getByLabelText('Job description'), 'Needs Python, Docker and SQL experience.')
    await ui.click(screen.getByRole('button', { name: 'Keyword baseline (no AI)' })); await screen.findByRole('heading', { name: /keyword baseline/ }); await ui.click(screen.getByRole('button', { name: 'Save with learning tasks' }))
    await screen.findByText('Analysis saved.'); expect(await screen.findByText(/0\/2 tasks done/)).toBeTruthy()
    await ui.click((await screen.findAllByRole('checkbox', { name: /Learn the basics/ }))[0]); expect(await screen.findByText(/1\/2 tasks done/)).toBeTruthy()
  })
})
describe('reminders', () => {
  it('persists dismissal across reloads and honours the in-app preference', async () => {
    fake.seed('applications', { user_id: A, company: 'Old Co', role: 'Dev', deadline: '2000-01-01' })
    open(); await login('a@x.com'); await go('Reminders'); expect(await screen.findByText(/Old Co — Dev/)).toBeTruthy(); await ui.click(screen.getByRole('button', { name: 'Dismiss' })); await screen.findByText(/No reminders match/)
    cleanup(); open('/reminders'); await screen.findByRole('heading', { name: 'Reminders' }); expect(await screen.findByText(/No reminders match/)).toBeTruthy()
    await ui.click(screen.getByLabelText('Show dismissed')); expect(await screen.findByRole('button', { name: 'Restore' })).toBeTruthy()
    cleanup(); fake.seed('profiles', { user_id: A, notify_in_app: false }); open('/reminders'); expect(await screen.findByText(/In-app reminders are turned off/)).toBeTruthy()
  })
})
describe('user isolation in the UI', () => {
  it('does not show or open another user\'s records after switching accounts', async () => {
    open(); await login('a@x.com'); await addApp('Secret Co', 'Spy'); const id = fake.tables.applications[0].id; await ui.click(screen.getByRole('button', { name: 'Sign out' })); await screen.findByRole('heading', { name: 'Sign in' })
    await login('b@x.com'); await go('Applications'); expect(await screen.findByText(/No applications yet/)).toBeTruthy(); expect(screen.queryByText(/Secret Co/)).toBeNull()
    cleanup(); open(`/applications/${id}`); expect(await screen.findByRole('heading', { name: 'Application not found' })).toBeTruthy(); expect(screen.queryByText(/Secret Co/)).toBeNull()
  })
})
