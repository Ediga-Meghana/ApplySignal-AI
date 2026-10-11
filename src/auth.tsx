import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, configured } from './lib/supabase'
interface State { session: Session | null; loading: boolean; error: string | null }
const Ctx = createContext<State & { retry: () => void }>({ session: null, loading: true, error: null, retry: () => {} })
export const useAuth = () => useContext(Ctx)
const RESTORE_ERROR = 'Could not restore your session. Check your connection and try again.'
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ session: null, loading: configured, error: null })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!configured) return
    let active = true
    setState(s => ({ ...s, loading: true, error: null }))
    // Subscribe first so no auth event is missed; events are always newer than the getSession snapshot.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { if (active) setState({ session, loading: false, error: null }) })
    supabase.auth.getSession()
      .then(({ data: d, error }) => { if (active) setState(s => !s.loading ? s : error ? { session: null, loading: false, error: RESTORE_ERROR } : { session: d.session, loading: false, error: null }) })
      .catch(() => { if (active) setState(s => s.loading ? { session: null, loading: false, error: RESTORE_ERROR } : s) })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [attempt])
  return <Ctx.Provider value={{ ...state, retry: () => setAttempt(n => n + 1) }}>{children}</Ctx.Provider>
}
