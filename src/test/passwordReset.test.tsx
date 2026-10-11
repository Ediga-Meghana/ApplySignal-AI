// @vitest-environment jsdom
// UI tests against the in-memory fake backend: password-reset screens only. Not a test of Supabase's real email or recovery links.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import * as sb from '../lib/supabase'
import { AuthProvider } from '../auth'
import App from '../App'
vi.mock('../lib/supabase', async () => { const { createFake } = await import('./fakeSupabase'); const f = createFake(); return { supabase: f.client, configured: true, __fake: f } })
const fake = (sb as unknown as { __fake: ReturnType<typeof import('./fakeSupabase').createFake> }).__fake
const ui = userEvent.setup()
beforeEach(() => { cleanup(); fake.reset(); vi.restoreAllMocks(); fake.addUser('a@x.com', 'password1') })
const open = (path: string) => render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>)

describe('password reset', () => {
  it('forgot-password sends the reset link to /reset and shows a neutral message', async () => {
    const spy = vi.spyOn(sb.supabase.auth, 'resetPasswordForEmail')
    open('/forgot'); await ui.type(await screen.findByLabelText('Email'), 'nobody@x.com'); await ui.click(screen.getByRole('button', { name: 'Reset your password' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/If that email has an account/) // same text whether or not the account exists
    expect(spy).toHaveBeenCalledWith('nobody@x.com', { redirectTo: `${window.location.origin}/reset` })
  })
  it('an invalid or expired reset link (no recovery session) is explained, not a blank form', async () => {
    open('/reset'); expect(await screen.findByRole('heading', { name: 'Reset link invalid' })).toBeTruthy()
    expect(screen.queryByLabelText('New password')).toBeNull(); expect(screen.getByRole('link', { name: 'Request a new link' })).toBeTruthy()
  })
  it('with a recovery session: rejects a short password, then updates and returns to the dashboard', async () => {
    await fake.client.auth.signInWithPassword({ email: 'a@x.com', password: 'password1' })
    const spy = vi.spyOn(sb.supabase.auth, 'updateUser')
    open('/reset'); await ui.type(await screen.findByLabelText('New password'), 'short'); await ui.click(screen.getByRole('button', { name: 'Choose a new password' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/at least 8/); expect(spy).not.toHaveBeenCalled()
    await ui.clear(screen.getByLabelText('New password')); await ui.type(screen.getByLabelText('New password'), 'a-better-pass1'); await ui.click(screen.getByRole('button', { name: 'Choose a new password' }))
    await screen.findByRole('heading', { name: 'Dashboard' }); expect(spy).toHaveBeenCalledWith({ password: 'a-better-pass1' })
  })
})
