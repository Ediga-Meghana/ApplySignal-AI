type TokenResponse = { access_token?: string; error?: string; error_description?: string }
type TokenClient = { requestAccessToken: (opts?: { prompt?: string }) => void }
type GoogleIdentity = { accounts: { oauth2: { initTokenClient: (opts: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type?: string; message?: string }) => void }) => TokenClient } } }
declare global { interface Window { google?: GoogleIdentity } }
export type GmailMessage = { id: string; subject: string; from: string; date: string; text: string }
const GIS_URL = 'https://accounts.google.com/gsi/client'
let gisLoading: Promise<void> | null = null
async function loadGis() {
  if (window.google?.accounts?.oauth2) return
  if (!gisLoading) gisLoading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_URL}"]`)
    const script = existing ?? document.createElement('script')
    script.onload = () => window.google?.accounts?.oauth2 ? resolve() : reject(new Error('Google sign-in library did not initialize.'))
    script.onerror = () => reject(new Error('Could not load Google sign-in. Check your internet connection.'))
    if (!existing) { script.src = GIS_URL; script.async = true; script.defer = true; document.head.appendChild(script) }
  }).catch(e => { gisLoading = null; throw e })
  return gisLoading
}
export async function prepareGmailImport(): Promise<void> { await loadGis() }
export async function requestGmailToken(clientId: string): Promise<string> {
  if (!clientId.trim()) throw new Error('Set VITE_GOOGLE_CLIENT_ID in .env first.')
  await loadGis()
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({ client_id: clientId, scope: 'https://www.googleapis.com/auth/gmail.readonly', callback: r => r.access_token ? resolve(r.access_token) : reject(new Error(r.error_description || r.error || 'Google authorization was not granted.')), error_callback: e => reject(new Error(e.message || e.type || 'Google authorization failed.')) })
    client.requestAccessToken({ prompt: '' })
  })
}
async function gmailGet<T>(token: string, path: string): Promise<T> {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok) throw new Error(r.status === 403 ? 'Gmail access was denied. Enable the Gmail API and approve the read-only permission.' : `Gmail request failed (${r.status}).`)
  return r.json() as Promise<T>
}
function decode(data?: string): string {
  if (!data) return ''
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/')
  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}
function partsText(payload: any): string {
  if (payload?.filename) return ''
  if (payload?.mimeType === 'text/plain' && payload?.body?.data) return decode(payload.body.data)
  for (const part of payload?.parts ?? []) { const t = partsText(part); if (t) return t }
  if (payload?.mimeType === 'text/html' && payload?.body?.data) return decode(payload.body.data).replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  return ''
}
/** Fetches up to 10 recent messages matching job-related terms. Token stays in memory and is never saved. */
export async function fetchRecentOpportunityEmails(token: string): Promise<GmailMessage[]> {
  const query = 'newer_than:30d (intern OR internship OR hiring OR job OR application OR recruitment)'
  const list = await gmailGet<{ messages?: { id: string }[] }>(token, `messages?maxResults=10&q=${encodeURIComponent(query)}`)
  const out: GmailMessage[] = []
  for (const item of list.messages ?? []) {
    const m = await gmailGet<any>(token, `messages/${encodeURIComponent(item.id)}?format=full`)
    const headers: { name: string; value: string }[] = m.payload?.headers ?? []
    const header = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
    const body = partsText(m.payload) || m.snippet || ''
    out.push({ id: m.id, subject: header('subject') || '(no subject)', from: header('from'), date: header('date'), text: [`Subject: ${header('subject')}`, `From: ${header('from')}`, `Date: ${header('date')}`, '', body].join('\n').slice(0, 12000) })
  }
  return out
}
