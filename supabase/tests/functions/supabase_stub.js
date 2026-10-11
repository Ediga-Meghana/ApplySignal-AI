// Test double for https://esm.sh/@supabase/supabase-js@2 (mapped via import_map.json). In-memory only; no network.
export const state = { getUser: async () => ({ data: { user: { id: 'u1' } } }), rpc: async () => ({ data: true, error: null }), tables: {}, users: {}, log: [] }
function query(table) {
  let op = 'select', payload, filters = [], one = false
  const rows = () => (state.tables[table] ??= [])
  const match = r => filters.every(([k, v]) => r[k] === v)
  const exec = () => {
    if (op === 'insert') { if (rows().some(r => ['user_id','reminder_key','reminder_date','channel'].every(k => r[k] === payload[k]))) return { data: null, error: { message: 'duplicate' } }; rows().push({ created_at: new Date().toISOString(), ...payload }); state.log.push(['insert', table]); return { data: null, error: null } }
    if (op === 'update') { rows().filter(match).forEach(r => Object.assign(r, payload)); state.log.push(['update', table, payload.status]); return { data: null, error: null } }
    const data = rows().filter(match); return one ? { data: data[0] ?? null, error: null } : { data, error: null }
  }
  const b = { select: () => b, insert: p => (op = 'insert', payload = p, b), update: p => (op = 'update', payload = p, b), eq: (k, v) => (filters.push([k, v]), b),
    match: o => (Object.entries(o).forEach(e => filters.push(e)), b), maybeSingle: () => (one = true, b), then: (res, rej) => Promise.resolve(exec()).then(res, rej) }
  return b
}
export function createClient(_url, _key, opts) {
  return { auth: { getUser: () => state.getUser(opts?.global?.headers?.Authorization), admin: { getUserById: async id => ({ data: { user: state.users[id] ?? null }, error: null }) } },
    rpc: (n, a) => state.rpc(n, a), from: query }
}
