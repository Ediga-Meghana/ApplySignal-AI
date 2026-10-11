// @vitest-environment jsdom
// UI test against the in-memory fake backend (see fakeSupabase.ts): verifies Profile load/validate/save/persist behaviour only.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import * as sb from '../lib/supabase'
import { AuthProvider } from '../auth'
import App from '../App'
vi.mock('../lib/supabase', async () => { const { createFake } = await import('./fakeSupabase'); const f = createFake(); return { supabase: f.client, configured: true, __fake: f } })
const fake = (sb as unknown as { __fake: ReturnType<typeof import('./fakeSupabase').createFake> }).__fake
const ui = userEvent.setup()
beforeEach(() => { cleanup(); fake.reset(); window.scrollTo = vi.fn(); fake.addUser('a@x.com', 'password1') })
const open = (path = '/') => render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>)
async function login() { await ui.type(await screen.findByLabelText('Email'), 'a@x.com'); await ui.type(screen.getByLabelText('Password'), 'password1'); await ui.click(screen.getByRole('button', { name: 'Sign in' })); await screen.findByRole('heading', { name: 'Dashboard' }) }
const go = (name: string) => ui.click(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name }))

describe('Profile and settings', () => {
  it('opens with no profile row, rejects a bad year, saves, and the values persist after a reload', async () => {
    open(); await login(); await go('Profile')
    await screen.findByRole('heading', { name: 'Profile and settings' })
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('') // no row yet is a normal state, not an error
    expect(screen.queryByRole('alert')).toBeNull()
    await ui.type(screen.getByLabelText('Graduation year'), '1850'); await ui.click(screen.getByRole('button', { name: 'Save profile' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/4-digit year between 1990 and 2100/)
    expect(fake.tables.profiles ?? []).toHaveLength(0) // nothing saved on validation failure
    await ui.clear(screen.getByLabelText('Graduation year')); await ui.type(screen.getByLabelText('Graduation year'), '2027')
    await ui.type(screen.getByLabelText('Name'), 'Asha'); await ui.type(screen.getByLabelText('Skills (comma-separated)'), 'React, SQL , ')
    await ui.click(screen.getByRole('button', { name: 'Save profile' }))
    expect((await screen.findByRole('status')).textContent).toMatch(/Profile saved/)
    expect(fake.tables.profiles).toHaveLength(1)
    expect(fake.tables.profiles[0]).toMatchObject({ full_name: 'Asha', graduation_year: 2027, skills: ['React', 'SQL'] })
    cleanup(); open('/profile') // full remount = page refresh; the fake keeps the session
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Asha'))
    expect((screen.getByLabelText('Graduation year') as HTMLInputElement).value).toBe('2027')
    expect((screen.getByLabelText('Skills (comma-separated)') as HTMLInputElement).value).toBe('React, SQL')
  })
})
