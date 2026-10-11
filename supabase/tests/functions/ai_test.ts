// Runs the REAL supabase/functions/ai/index.ts with a stubbed Supabase client and a mocked fetch. Run: npm run test:functions
import { state } from './supabase_stub.js'
let pass = 0, fail = 0
const check = (label: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  <-- ' + extra}`) }
const SECRET = 'SUPER-SECRET-PROVIDER-KEY'
let handler: (r: Request) => Promise<Response>
// deno-lint-ignore no-explicit-any
;(Deno as any).serve = (h: any) => { handler = h; return {} }
const realFetch = globalThis.fetch
let providerCalls: { url: string; init: RequestInit }[] = []
let providerReply: () => Response = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"company":"Acme"}' }] } }] }), { status: 200 })
globalThis.fetch = ((url: string, init: RequestInit) => { providerCalls.push({ url: String(url), init }); return Promise.resolve(providerReply()) }) as typeof fetch
const env = (o: Record<string, string | undefined>) => { for (const k of ['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','AI_PROVIDER','AI_API_KEY','AI_MODEL','APP_ORIGIN','AI_HOURLY_LIMIT']) Deno.env.delete(k); for (const [k, v] of Object.entries(o)) if (v !== undefined) Deno.env.set(k, v) }
const base = { SUPABASE_URL: 'http://x', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's', AI_PROVIDER: 'gemini', AI_API_KEY: SECRET, AI_MODEL: 'test-model' }
let n = 0
async function load(e: Record<string, string | undefined>) { env(e); await import(`../../functions/ai/index.ts?v=${++n}`) }
const call = (body: unknown, headers: Record<string, string> = { Authorization: 'Bearer user-jwt' }, method = 'POST') => handler(new Request('http://f/ai', { method, headers: { 'Content-Type': 'application/json', ...headers }, body: method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }))
const reset = () => { providerCalls = []; state.getUser = async () => ({ data: { user: { id: 'u1' } } }); state.rpc = async () => ({ data: true, error: null }); providerReply = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"company":"Acme"}' }] } }] }), { status: 200 }) }
const goodText = 'Acme is hiring a Software Intern. Apply by 2030-01-15.'

await load(base)
reset()
let r = await handler(new Request('http://f/ai', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } }))
check('CORS preflight OPTIONS -> 204', r.status === 204)
const ah = (r.headers.get('Access-Control-Allow-Headers') ?? '').toLowerCase()
check('preflight allows authorization, apikey, content-type, x-client-info', ['authorization','apikey','content-type','x-client-info'].every(h => ah.includes(h)), ah)
check('preflight allows POST', (r.headers.get('Access-Control-Allow-Methods') ?? '').includes('POST'))
check('no APP_ORIGIN set -> allow-origin falls back to *', r.headers.get('Access-Control-Allow-Origin') === '*')
r = await call({}, {}, 'GET'); check('GET -> 405', r.status === 405)
r = await call({ task: 'extract', text: goodText }, {}); check('missing Authorization -> 401, provider not called', r.status === 401 && providerCalls.length === 0)
state.getUser = async () => ({ data: { user: null } }); r = await call({ task: 'extract', text: goodText }); check('invalid session (no user) -> 401, provider not called', r.status === 401 && providerCalls.length === 0); reset()
state.getUser = async () => { throw new Error('boom') }; r = await call({ task: 'extract', text: goodText }); check('auth lookup throws -> 401, provider not called', r.status === 401 && providerCalls.length === 0); reset()
r = await call('not json'); check('malformed JSON -> 400', r.status === 400)
r = await call([1]); check('JSON array body -> 400', r.status === 400)
r = await call({ task: 'extract', text: 'short' }); check('extract text too short -> 400', r.status === 400)
r = await call({ task: 'extract', text: 'x'.repeat(12001) }); check('extract text > 12000 chars -> 400', r.status === 400)
r = await call({ task: 'skillmap', resume: 'r'.repeat(30), jd: 'short' }); check('skillmap job description too short -> 400', r.status === 400)
r = await call({ task: 'skillmap', resume: 'r'.repeat(15001), jd: 'j'.repeat(30) }); check('skillmap resume > 15000 chars -> 400', r.status === 400)
r = await call({ task: 'delete-everything', text: goodText }); check('unknown task -> 400', r.status === 400)
check('no provider call was made for any invalid input', providerCalls.length === 0)
state.rpc = async () => ({ data: null, error: { message: 'db down' } }); r = await call({ task: 'extract', text: goodText }); check('quota check error -> 503 and provider NOT called (fails closed)', r.status === 503 && providerCalls.length === 0); reset()
state.rpc = async () => { throw new Error('net') }; r = await call({ task: 'extract', text: goodText }); check('quota check throws -> 503 and provider NOT called', r.status === 503 && providerCalls.length === 0); reset()
state.rpc = async () => ({ data: false, error: null }); r = await call({ task: 'extract', text: goodText }); const rb = await r.json(); check('quota exhausted -> 429 AI_RATE_LIMITED, provider NOT called', r.status === 429 && rb.code === 'AI_RATE_LIMITED' && providerCalls.length === 0); reset()
let rpcArgs: unknown; state.rpc = async (_n: string, a: unknown) => { rpcArgs = a; return { data: true, error: null } }
r = await call({ task: 'extract', text: goodText }); const ok = await r.json()
check('Gemini success -> 200 with parsed data', r.status === 200 && ok.data?.company === 'Acme', JSON.stringify(ok))
check('quota consumed for the AUTHENTICATED user id (not a browser-supplied id)', JSON.stringify(rpcArgs) === '{"p_user":"u1","p_limit":20}', JSON.stringify(rpcArgs))
check('Gemini request hits generativelanguage.googleapis.com with the configured model', providerCalls[0]?.url.startsWith('https://generativelanguage.googleapis.com/') && providerCalls[0].url.includes('test-model:generateContent'), providerCalls[0]?.url)
check('provider key is sent in a header, not in the URL', (providerCalls[0]?.init.headers as Record<string, string>)['x-goog-api-key'] === SECRET && !providerCalls[0].url.includes(SECRET))
check('provider key never appears in the response to the browser', !JSON.stringify(ok).includes(SECRET))
check('untrusted text is wrapped in <data> tags and system prompt warns against following it', String(providerCalls[0]?.init.body).includes('<data>') && String(providerCalls[0]?.init.body).includes('UNTRUSTED'))
reset(); providerReply = () => new Response('{}', { status: 429 }); r = await call({ task: 'extract', text: goodText }); check('provider 429 -> 429 AI_RATE_LIMITED', r.status === 429 && (await r.json()).code === 'AI_RATE_LIMITED')
reset(); providerReply = () => new Response('{}', { status: 500 }); r = await call({ task: 'extract', text: goodText }); check('provider 500 -> 502 AI_UNAVAILABLE', r.status === 502 && (await r.json()).code === 'AI_UNAVAILABLE')
reset(); providerReply = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'this is not json' }] } }] }), { status: 200 }); r = await call({ task: 'extract', text: goodText }); check('provider returns non-JSON text -> 502 AI_BAD_RESPONSE', r.status === 502 && (await r.json()).code === 'AI_BAD_RESPONSE')
reset(); globalThis.fetch = (() => Promise.reject(new Error('network'))) as typeof fetch; r = await call({ task: 'extract', text: goodText }); check('provider network failure -> 502 AI_UNAVAILABLE', r.status === 502 && (await r.json()).code === 'AI_UNAVAILABLE')
globalThis.fetch = ((url: string, init: RequestInit) => { providerCalls.push({ url: String(url), init }); return Promise.resolve(providerReply()) }) as typeof fetch
r = await call({ task: 'skillmap', resume: 'r'.repeat(30), jd: 'j'.repeat(30), preferences: 'p'.repeat(1001) }); check('skillmap preferences > 1000 chars -> 400', r.status === 400)
reset(); r = await call({ task: 'skillmap', resume: 'Built React apps with TypeScript.', jd: 'Need React and SQL experience please.' }); check('skillmap valid input -> 200', r.status === 200)

await load({ ...base, AI_PROVIDER: 'openai' }); reset(); providerReply = () => new Response(JSON.stringify({ choices: [{ message: { content: '{"company":"OpenAI Co"}' } }] }), { status: 200 })
r = await call({ task: 'extract', text: goodText }); const oj = await r.json()
check('OpenAI success -> 200 with parsed data', r.status === 200 && oj.data?.company === 'OpenAI Co')
check('OpenAI request uses api.openai.com with Bearer auth', providerCalls[0]?.url === 'https://api.openai.com/v1/chat/completions' && (providerCalls[0].init.headers as Record<string, string>).Authorization === `Bearer ${SECRET}`)
await load({ ...base, AI_API_KEY: undefined }); reset(); r = await call({ task: 'extract', text: goodText }); check('no AI_API_KEY -> 503 AI_NOT_CONFIGURED, provider not called', r.status === 503 && (await r.json()).code === 'AI_NOT_CONFIGURED' && providerCalls.length === 0)
await load({ ...base, AI_PROVIDER: 'claude' }); reset(); r = await call({ task: 'extract', text: goodText }); check('unsupported AI_PROVIDER value -> 503 AI_NOT_CONFIGURED', r.status === 503)
await load({ ...base, SUPABASE_SERVICE_ROLE_KEY: undefined }); reset(); r = await call({ task: 'extract', text: goodText }); check('missing Supabase env -> 503', r.status === 503 && providerCalls.length === 0)
await load({ ...base, APP_ORIGIN: 'https://myapp.example' }); reset(); r = await handler(new Request('http://f/ai', { method: 'OPTIONS' })); check('APP_ORIGIN is reflected in Access-Control-Allow-Origin', r.headers.get('Access-Control-Allow-Origin') === 'https://myapp.example')
await load({ ...base, AI_HOURLY_LIMIT: '3' }); reset(); state.rpc = async (_n: string, a: unknown) => { rpcArgs = a; return { data: true, error: null } }; await call({ task: 'extract', text: goodText }); check('AI_HOURLY_LIMIT env var is honoured', JSON.stringify(rpcArgs) === '{"p_user":"u1","p_limit":3}', JSON.stringify(rpcArgs))
globalThis.fetch = realFetch
console.log(`\nai function: ${pass} passed, ${fail} failed`); Deno.exit(fail ? 1 : 0)
