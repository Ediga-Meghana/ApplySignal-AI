import { supabase } from './supabase'
export class AiError extends Error { constructor(public code: string, message: string) { super(message) } }
const MSG: Record<string, string> = { AI_NOT_CONFIGURED: 'AI is not configured on the server yet.', AI_RATE_LIMITED: 'AI rate limit reached. Try again later.', AI_UNAVAILABLE: 'The AI service is unavailable.', AI_BAD_RESPONSE: 'The AI returned an unusable response.', INPUT_INVALID: 'The text is too short or too long for AI analysis.', UNAUTHORIZED: 'Please sign in again.' }
/** Calls the server-side Edge Function. The browser never sees the AI key. Output must still be validated by the caller. */
export async function callAi(task: 'extract' | 'skillmap', payload: Record<string, string>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke('ai', { body: { task, ...payload } })
  if (error) { let code = 'AI_UNAVAILABLE'; try { code = (await (error as { context?: Response }).context?.json())?.code ?? code } catch { /* keep default */ } throw new AiError(code, MSG[code] ?? MSG.AI_UNAVAILABLE) }
  return (data as { data: unknown }).data
}
