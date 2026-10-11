import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_E2E_URL
const anon = process.env.SUPABASE_E2E_ANON_KEY
const email = process.env.SUPABASE_E2E_EMAIL
const password = process.env.SUPABASE_E2E_PASSWORD
if (!url || !anon || !email || !password) {
  console.error('Set SUPABASE_E2E_URL, SUPABASE_E2E_ANON_KEY, SUPABASE_E2E_EMAIL, and SUPABASE_E2E_PASSWORD for live tests.')
  process.exit(2)
}
const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
const other = process.env.SUPABASE_E2E_OTHER_EMAIL && process.env.SUPABASE_E2E_OTHER_PASSWORD
  ? createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } }) : null
const marker = `ApplySignal E2E ${new Date().toISOString()} ${Math.random().toString(16).slice(2)}`
const ids = { application: null, opportunity: null, analysis: null, task: null }
let profileBackup = undefined // undefined = untouched; null = no row existed before; object = original row to restore
let failures = 0
let userIdForCleanup = null
function pass(s) { console.log(`PASS ${s}`) }
function assert(ok, s) { if (!ok) { failures++; console.error(`FAIL ${s}`) } else pass(s) }
async function must(p, label) { const r = await p; if (r.error) throw new Error(`${label}: ${r.error.message}`); return r.data }
try {
  const { data: login, error: loginError } = await client.auth.signInWithPassword({ email, password })
  if (loginError || !login.user) throw new Error(`Login failed: ${loginError?.message ?? 'no user returned'}`)
  pass('live Supabase login')
  const userId = login.user.id; userIdForCleanup = userId

  const opp = await must(client.from('opportunities').insert({ user_id: userId, company: marker, role: 'E2E Intern', source: 'live-e2e' }).select('id').single(), 'insert opportunity')
  ids.opportunity = opp.id; pass('insert opportunity')
  const app = await must(client.from('applications').insert({ user_id: userId, opportunity_id: opp.id, company: marker, role: 'E2E Intern', status: 'Saved' }).select('id,status').single(), 'insert application')
  ids.application = app.id; assert(app.status === 'Saved', 'insert application and read returned row')
  await must(client.from('applications').update({ status: 'Applied' }).eq('id', app.id), 'update application')
  const persisted = await must(client.from('applications').select('id,status').eq('id', app.id).single(), 'read updated application')
  assert(persisted.status === 'Applied', 'database persistence after update')

  const analysis = await must(client.from('skill_analyses').insert({ user_id: userId, target_role: marker, job_description: 'E2E job description', matched: ['Java'], missing: ['SQL'], method: 'keywords' }).select('id').single(), 'insert skill analysis')
  ids.analysis = analysis.id; pass('insert SkillMap analysis')
  const task = await must(client.from('learning_tasks').insert({ user_id: userId, analysis_id: analysis.id, title: `${marker} task` }).select('id').single(), 'insert learning task')
  ids.task = task.id; pass('insert learning task')
  const loaded = await must(client.from('learning_tasks').select('id,title').eq('id', task.id).single(), 'read learning task')
  assert(loaded.title === `${marker} task`, 'read saved learning task')


  // Profile: save, read back, then restore exactly what was there before (never leaves test data behind or overwrites a real profile).
  const before = await must(client.from('profiles').select('*').eq('user_id', userId).maybeSingle(), 'read existing profile')
  profileBackup = before ?? null
  await must(client.from('profiles').upsert({ user_id: userId, full_name: marker, skills: ['E2E'], preferred_roles: [], preferred_locations: [], notify_in_app: true, updated_at: new Date().toISOString() }), 'upsert profile')
  const prof = await must(client.from('profiles').select('full_name,skills').eq('user_id', userId).single(), 'read saved profile')
  assert(prof.full_name === marker && prof.skills[0] === 'E2E', 'profile saved and persisted')

  // Signed-out visitors must not be able to read user tables.
  const anonClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const anonRead = await anonClient.from('applications').select('id').limit(1)
  assert(Boolean(anonRead.error) || (anonRead.data ?? []).length === 0, 'signed-out client cannot read applications')

  if (other) {
    const { error: otherLoginError } = await other.auth.signInWithPassword({ email: process.env.SUPABASE_E2E_OTHER_EMAIL, password: process.env.SUPABASE_E2E_OTHER_PASSWORD })
    if (otherLoginError) throw new Error(`Second test account login failed: ${otherLoginError.message}`)
    const { data: hidden, error: hiddenError } = await other.from('applications').select('id').eq('id', app.id)
    assert(!hiddenError && (hidden ?? []).length === 0, 'second user cannot read first user application')
  } else console.log('SKIP second-user isolation (set SUPABASE_E2E_OTHER_EMAIL and SUPABASE_E2E_OTHER_PASSWORD)')

  if (process.env.SUPABASE_E2E_TEST_AI === 'true') {
    const { data: ai, error: aiError } = await client.functions.invoke('ai', { body: { task: 'extract', text: 'Software Intern at Acme. Apply by 2031-03-15. https://example.com/jobs/123' } })
    assert(!aiError && ai && typeof ai.data === 'object', 'live AI opportunity extraction')
    const { data: skill, error: skillError } = await client.functions.invoke('ai', { body: { task: 'skillmap', resume: 'I built projects using Java and SQL.', jd: 'The role requires Java, SQL and Docker.' } })
    assert(!skillError && skill && typeof skill.data === 'object', 'live AI SkillMap analysis')
  } else console.log('SKIP live AI calls (set SUPABASE_E2E_TEST_AI=true; provider usage may be billable)')
} catch (e) {
  failures++; console.error(`FAIL ${e instanceof Error ? e.message : String(e)}`)
} finally {
  // Clean only rows created by this run, while still authenticated as the test user.
  if (ids.task) await client.from('learning_tasks').delete().eq('id', ids.task)
  if (ids.analysis) await client.from('skill_analyses').delete().eq('id', ids.analysis)
  if (ids.application) await client.from('applications').delete().eq('id', ids.application)
  if (ids.opportunity) await client.from('opportunities').delete().eq('id', ids.opportunity)
  if (profileBackup === null) await client.from('profiles').delete().eq('user_id', userIdForCleanup)
  else if (profileBackup) await client.from('profiles').upsert(profileBackup)
  await client.auth.signOut()
  if (other) await other.auth.signOut()
}
if (failures) process.exit(1)
console.log('Live smoke tests finished. This script tests configured Supabase services, not browser layout or the signup email-confirmation flow.')
