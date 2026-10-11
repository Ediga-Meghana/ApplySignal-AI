/* eslint-disable @typescript-eslint/no-explicit-any */
// In-memory stand-in for the Supabase client, used ONLY by UI tests. It emulates auth and per-user row visibility (like RLS)
// well enough to test UI behaviour. It does NOT test Supabase, Postgres or real RLS: supabase/tests covers that on real Postgres.
type Row = Record<string, any>
export function createFake() {
  const tables: Record<string, Row[]> = {}; const users: { id: string; email: string; password: string }[] = []
  let current: { id: string; email: string } | null = null; let seq = 0
  const listeners = new Set<(e: string, s: any) => void>()
  const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`
  const session = () => current ? { user: current } : null
  const emit = (e: string) => listeners.forEach(l => l(e, session()))
  const defaults: Record<string, Row> = { applications: { status: 'Saved' }, learning_tasks: { done: false }, profiles: { notify_in_app: true, skills: [], preferred_roles: [], preferred_locations: [] } }
  const RLS = { message: 'new row violates row-level security policy' }
  function from(table: string) {
    let op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'; let payload: any; const filters: [string, any][] = []; let order: [string, boolean] | null = null; let one: 'single' | 'maybe' | null = null
    const all = () => (tables[table] ??= []); const mine = () => all().filter(r => r.user_id === current?.id)
    const exec = () => {
      if (!current) return { data: null, error: { message: 'not authenticated' } }
      const match = (r: Row) => filters.every(([k, v]) => r[k] === v); let data: any
      if (op === 'insert' || op === 'upsert') {
        const out: Row[] = []
        for (const p of Array.isArray(payload) ? payload : [payload]) {
          if (p.user_id && p.user_id !== current.id) return { data: null, error: RLS }
          const existing = op === 'upsert' ? mine().find(r => r.user_id === current!.id) : undefined
          if (existing) { Object.assign(existing, p); out.push(existing) } else { const r = { id: uid(), created_at: new Date().toISOString(), ...defaults[table], ...p, user_id: current.id }; if (table === 'profiles' || table === 'reminder_dismissals') delete r.id; all().push(r); out.push(r) }
        }
        data = out
      } else if (op === 'update') { data = mine().filter(match); data.forEach((r: Row) => { if (payload.user_id && payload.user_id !== current!.id) return; Object.assign(r, payload) }) }
      else if (op === 'delete') { data = mine().filter(match); tables[table] = all().filter(r => !data.includes(r)) }
      else { data = mine().filter(match); if (order) { const [k, asc] = order; data = [...data].sort((a: Row, b: Row) => (a[k] > b[k] ? 1 : -1) * (asc ? 1 : -1)) } }
      if (one) return { data: data[0] ?? null, error: null }
      return { data, error: null }
    }
    const b: any = { select: () => b, order: (k: string, o?: { ascending?: boolean }) => { order = [k, o?.ascending !== false]; return b }, eq: (k: string, v: any) => { filters.push([k, v]); return b },
      insert: (p: any) => { op = 'insert'; payload = p; return b }, upsert: (p: any) => { op = 'upsert'; payload = p; return b }, update: (p: any) => { op = 'update'; payload = p; return b }, delete: () => { op = 'delete'; return b },
      single: () => { one = 'single'; return b }, maybeSingle: () => { one = 'maybe'; return b }, then: (res: any, rej: any) => Promise.resolve(exec()).then(res, rej) }
    return b
  }
  const client = {
    from,
    functions: { invoke: async () => ({ data: null, error: { context: { json: async () => ({ code: 'AI_NOT_CONFIGURED' }) } } }) },
    auth: {
      getSession: async () => ({ data: { session: session() }, error: null }),
      onAuthStateChange: (cb: (e: string, s: any) => void) => { listeners.add(cb); setTimeout(() => cb('INITIAL_SESSION', session()), 0); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } } },
      signInWithPassword: async ({ email, password }: Row) => { const u = users.find(x => x.email === email && x.password === password); if (!u) return { data: null, error: { message: 'Invalid login credentials' } }; current = { id: u.id, email }; emit('SIGNED_IN'); return { data: {}, error: null } },
      signUp: async ({ email, password }: Row) => { users.push({ id: uid(), email, password }); return { data: {}, error: null } },
      signOut: async () => { current = null; emit('SIGNED_OUT'); return { error: null } },
      resetPasswordForEmail: async () => ({ data: {}, error: null }), updateUser: async () => ({ data: {}, error: null }),
    },
  }
  return { client, tables, reset() { for (const k of Object.keys(tables)) delete tables[k]; users.length = 0; current = null; seq = 0 }, addUser(email: string, password: string) { const id = uid(); users.push({ id, email, password }); return id },
    seed(table: string, row: Row) { (tables[table] ??= []).push({ id: uid(), created_at: new Date().toISOString(), ...defaults[table], ...row }) } }
}
