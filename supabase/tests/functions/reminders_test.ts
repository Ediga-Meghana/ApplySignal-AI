// Runs the REAL supabase/functions/send-reminders/index.ts with a stubbed Supabase client and mocked Resend. Run: npm run test:functions
import { state } from './supabase_stub.js'
let pass = 0, fail = 0
const check = (label: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  <-- ' + extra}`) }
let handler: (r: Request) => Promise<Response>
// deno-lint-ignore no-explicit-any
;(Deno as any).serve = (h: any) => { handler = h; return {} }
let sent: { to: string[]; subject: string; text: string; auth: string }[] = []
let resendStatus = 200
globalThis.fetch = ((url: string, init: RequestInit) => { if (url !== 'https://api.resend.com/emails') throw new Error('unexpected fetch ' + url); const b = JSON.parse(String(init.body)); sent.push({ ...b, auth: (init.headers as Record<string, string>).Authorization }); return Promise.resolve(new Response('{}', { status: resendStatus })) }) as typeof fetch
const SECRET = 'cron-secret-123'
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 's', RESEND_API_KEY: 'rk', REMINDER_FROM_EMAIL: 'A <a@verified.example>', REMINDER_CRON_SECRET: SECRET })) Deno.env.set(k, v)
await import('../../functions/send-reminders/index.ts')
const post = (headers: Record<string, string> = { Authorization: `Bearer ${SECRET}` }, method = 'POST') => handler(new Request('http://f/send-reminders', { method, headers }))
const day = (offset: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10) }
const fresh = () => { sent = []; resendStatus = 200; state.log = []; state.users = { u1: { email: 'u1@example.com' }, u2: { email: 'u2@example.com' } }
  state.tables = { profiles: [{ user_id: 'u1', timezone: 'UTC', notify_email: true }, { user_id: 'u2', timezone: 'UTC', notify_email: false }],
    applications: [
      { id: 'a1', user_id: 'u1', company: 'Acme', role: 'Intern', status: 'Saved', deadline: day(1), assessment_date: null, interview_date: null, follow_up_date: null },
      { id: 'a2', user_id: 'u1', company: 'FarAway', role: 'Dev', status: 'Saved', deadline: day(10), assessment_date: null, interview_date: null, follow_up_date: null },
      { id: 'a3', user_id: 'u1', company: 'Applied Inc', role: 'Dev', status: 'Applied', deadline: day(1), assessment_date: day(2), interview_date: null, follow_up_date: null },
      { id: 'a4', user_id: 'u1', company: 'Done Ltd', role: 'Dev', status: 'Rejected', deadline: null, assessment_date: day(1), interview_date: null, follow_up_date: null },
      { id: 'a5', user_id: 'u1', company: 'Past Co', role: 'Dev', status: 'Saved', deadline: day(-1), assessment_date: null, interview_date: null, follow_up_date: null },
      { id: 'b1', user_id: 'u2', company: 'OtherUser', role: 'Dev', status: 'Saved', deadline: day(1), assessment_date: null, interview_date: null, follow_up_date: null }],
    opportunities: [{ id: 'o1', user_id: 'u1', company: 'OppCo', role: 'Analyst', deadline: day(3), assessment_date: null, interview_date: null }],
    reminder_dismissals: [], notification_deliveries: [] } }

fresh()
let r = await post({}, 'GET'); check('GET -> 405', r.status === 405)
r = await post({}); check('no Authorization -> 401', r.status === 401 && sent.length === 0)
r = await post({ Authorization: 'Bearer wrong' }); check('wrong secret -> 401, nothing sent', r.status === 401 && sent.length === 0)
Deno.env.delete('RESEND_API_KEY'); r = await post(); check('missing RESEND_API_KEY -> 503 NOT_CONFIGURED (does not pretend to send)', r.status === 503 && sent.length === 0); Deno.env.set('RESEND_API_KEY', 'rk')

fresh(); r = await post(); const j = await r.json()
check('valid secret -> 200 ok', r.status === 200 && j.ok === true, JSON.stringify(j))
check('only the opted-in user gets an email (u2 has notify_email=false)', sent.length === 1 && sent[0].to[0] === 'u1@example.com', JSON.stringify(sent.map(s => s.to)))
const t = sent[0]?.text ?? ''
check('digest includes saved application deadline in window (Acme)', t.includes('Acme'))
check('digest includes assessment of an Applied application (Applied Inc)', t.includes('Applied Inc'))
check('digest includes opportunity deadline in window (OppCo)', t.includes('OppCo'))
check('digest EXCLUDES deadline > 3 days away (FarAway)', !t.includes('FarAway'))
check('digest EXCLUDES overdue/past dates (Past Co)', !t.includes('Past Co'))
check('digest EXCLUDES Rejected application events (Done Ltd)', !t.includes('Done Ltd'))
check('digest EXCLUDES the already-applied record\'s deadline but keeps its assessment', !/Application deadline: Applied Inc/.test(t) && /Assessment: Applied Inc/.test(t))
check('digest never contains another user\'s data (OtherUser)', !t.includes('OtherUser'))
check('Resend called with the configured API key as Bearer', sent[0]?.auth === 'Bearer rk')
check('deliveries recorded as sent in the ledger (3 reminders: Acme, Applied Inc, OppCo)', state.tables.notification_deliveries.length === 3 && state.tables.notification_deliveries.every((d: { status: string }) => d.status === 'sent'), JSON.stringify(state.tables.notification_deliveries.map((d: { status: string }) => d.status)))
sent = []; r = await post(); check('second run the same day sends NOTHING (idempotent, no duplicate email)', sent.length === 0 && (await r.json()).digests_sent === 0)

fresh(); state.tables.reminder_dismissals = [{ user_id: 'u1', key: `application:a1:Application deadline@${day(1)}` }]; await post()
check('dismissed reminder is not emailed (key format matches the frontend: kind:id:type@date)', !sent[0]?.text.includes('Acme') && sent[0]?.text.includes('Applied Inc'))
fresh(); state.tables.reminder_dismissals = [{ user_id: 'u1', key: `application:a1:Application deadline@${day(5)}` }]; await post()
check('a dismissal for an OLD date does not hide the moved deadline', sent[0]?.text.includes('Acme') === true)

fresh(); resendStatus = 500; r = await post(); const jf = await r.json()
check('Resend failure -> reported as failure, not as sent', jf.digests_sent === 0 && jf.failures === 1, JSON.stringify(jf))
check('failed deliveries are marked failed with a generic error (no provider detail leaked)', state.tables.notification_deliveries.every((d: { status: string; last_error: string }) => d.status === 'failed' && d.last_error === 'EMAIL_DELIVERY_FAILED'))
resendStatus = 200; sent = []; await post(); check('failed deliveries are retried on the next run', sent.length === 1)

fresh(); state.tables.notification_deliveries = [{ user_id: 'u1', reminder_key: 'application:a1:Application deadline', reminder_date: day(1), channel: 'email', status: 'pending', created_at: new Date().toISOString() }]
await post(); check('a fresh "pending" claim by another invocation is skipped (no double send)', !sent[0]?.text.includes('Acme') && sent[0]?.text.includes('Applied Inc'))
fresh(); state.tables.profiles[0].timezone = 'Not/AZone'; r = await post(); check('invalid stored timezone falls back safely instead of crashing', r.status === 200 && sent.length === 1)
fresh(); state.users = {}; r = await post(); check('user without an email address is skipped, no crash', r.status === 200 && sent.length === 0)
console.log(`\nsend-reminders function: ${pass} passed, ${fail} failed`); Deno.exit(fail ? 1 : 0)
