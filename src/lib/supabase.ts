import { createClient } from '@supabase/supabase-js'
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
export const configured = Boolean(url && key)
// Placeholder client keeps the app loadable; the UI blocks sign-in and shows setup instructions when unconfigured.
export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing')
