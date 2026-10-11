// Scheduled server-side email digest. Requires Supabase service role + Resend secrets.
// Configure this function with verify_jwt=false and a strong REMINDER_CRON_SECRET; the function checks it itself.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Candidate = { key: string; date: string; type: string; title: string }
const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const dateInZone = (timeZone: string, d = new Date()) => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d) }
  catch { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d) }
}
const dayNumber = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); return m ? Math.floor(Date.UTC(+m[1], +m[2]-1, +m[3]) / 86400000) : NaN }
function addCandidate(out: Candidate[], kind: 'application'|'opportunity', id: string, type: string, title: string, date: unknown, today: string) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return
  const delta = dayNumber(date) - dayNumber(today)
  if (!Number.isFinite(delta) || delta < 0 || delta > 3) return
  out.push({ key: `${kind}:${id}:${type}`, date, type, title })
}
async function sendEmail(apiKey: string, from: string, to: string, subject: string, text: string) {
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, text }) })
  if (!response.ok) throw new Error(`EMAIL_PROVIDER_${response.status}`)
}
Deno.serve(async req => {
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' })
  const cronSecret = Deno.env.get('REMINDER_CRON_SECRET')
  if (!cronSecret || req.headers.get('Authorization') !== `Bearer ${cronSecret}`) return json(401, { error: 'UNAUTHORIZED' })
  const url = Deno.env.get('SUPABASE_URL'), serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const resendKey = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('REMINDER_FROM_EMAIL')
  if (!url || !serviceKey || !resendKey || !from) return json(503, { error: 'NOT_CONFIGURED' })
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: profiles, error: profilesError } = await admin.from('profiles').select('user_id,timezone').eq('notify_email', true)
  if (profilesError) return json(503, { error: 'DATABASE_UNAVAILABLE' })
  let scanned = 0, sent = 0, failed = 0
  for (const profile of profiles ?? []) {
    try {
      const { data: userResult, error: userError } = await admin.auth.admin.getUserById(profile.user_id)
      const email = userResult?.user?.email
      if (userError || !email) continue
      const zone = typeof profile.timezone === 'string' ? profile.timezone : 'Asia/Kolkata'
      const today = dateInZone(zone)
      const [{ data: apps, error: appErr }, { data: opps, error: oppErr }] = await Promise.all([
        admin.from('applications').select('id,company,role,status,deadline,assessment_date,interview_date,follow_up_date').eq('user_id', profile.user_id),
        admin.from('opportunities').select('id,company,role,deadline,assessment_date,interview_date').eq('user_id', profile.user_id),
      ])
      if (appErr || oppErr) { failed++; continue }
      const candidates: Candidate[] = []
      for (const a of apps ?? []) {
        const title = `${a.company} — ${a.role}`
        if (a.status === 'Saved') addCandidate(candidates, 'application', a.id, 'Application deadline', title, a.deadline, today)
        if (!['Offer','Rejected'].includes(a.status)) {
          addCandidate(candidates, 'application', a.id, 'Assessment', title, a.assessment_date, today)
          addCandidate(candidates, 'application', a.id, 'Interview', title, a.interview_date, today)
          addCandidate(candidates, 'application', a.id, 'Follow-up', title, a.follow_up_date, today)
        }
      }
      for (const o of opps ?? []) {
        const title = `${o.company ?? 'Company not identified'} — ${o.role ?? 'Role not identified'}`
        addCandidate(candidates, 'opportunity', o.id, 'Application deadline', title, o.deadline, today)
        addCandidate(candidates, 'opportunity', o.id, 'Assessment', title, o.assessment_date, today)
        addCandidate(candidates, 'opportunity', o.id, 'Interview', title, o.interview_date, today)
      }
      const { data: dismissals } = await admin.from('reminder_dismissals').select('key').eq('user_id', profile.user_id)
      const dismissed = new Set((dismissals ?? []).map((d: { key: string }) => d.key))
      const pending: Candidate[] = []
      for (const c of candidates) {
        if (dismissed.has(`${c.key}@${c.date}`)) continue
        scanned++
        const base = { user_id: profile.user_id, reminder_key: c.key, reminder_date: c.date, channel: 'email' }
        const { data: existing } = await admin.from('notification_deliveries').select('status,created_at').match(base).maybeSingle()
        if (existing?.status === 'sent') continue
        if (existing?.status === 'pending' && Date.now() - new Date(existing.created_at).getTime() < 30 * 60 * 1000) continue
        if (existing) {
          const { error } = await admin.from('notification_deliveries').update({ status: 'pending', last_error: null, created_at: new Date().toISOString() }).match(base)
          if (error) continue
        } else {
          const { error } = await admin.from('notification_deliveries').insert({ ...base, status: 'pending' })
          if (error) continue // another invocation already claimed this reminder
        }
        pending.push(c)
      }
      if (!pending.length) continue
      const body = ['Your ApplySignal AI deadline digest', '', ...pending.map(c => `• ${c.type}: ${c.title} — ${c.date} (in-app record key: ${c.key})`), '', 'This digest covers reminders due today through the next 3 days. Manage email reminders in ApplySignal AI Profile settings.'].join('\n')
      try {
        await sendEmail(resendKey, from, email, `ApplySignal AI: ${pending.length} upcoming reminder${pending.length === 1 ? '' : 's'}`, body)
        for (const c of pending) await admin.from('notification_deliveries').update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null }).match({ user_id: profile.user_id, reminder_key: c.key, reminder_date: c.date, channel: 'email' })
        sent++
      } catch {
        failed++
        for (const c of pending) await admin.from('notification_deliveries').update({ status: 'failed', last_error: 'EMAIL_DELIVERY_FAILED' }).match({ user_id: profile.user_id, reminder_key: c.key, reminder_date: c.date, channel: 'email' })
      }
    } catch { failed++ }
  }
  return json(200, { ok: true, users_checked: profiles?.length ?? 0, reminders_scanned: scanned, digests_sent: sent, failures: failed })
})
