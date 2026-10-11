import { useEffect, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'

/** Refreshes the current screen when the signed-in user's rows change in Supabase Realtime.
 * The migration adds the relevant tables to supabase_realtime when that publication exists.
 * A missing channel API (e.g. lightweight test doubles) is safely ignored.
 */
export function useRealtimeRefresh(tables: readonly string[], onChange: () => void) {
  const callback = useRef(onChange)
  callback.current = onChange
  const tableKey = tables.join(',')
  useEffect(() => {
    if (typeof supabase.channel !== 'function') return
    let stopped = false
    let channel: RealtimeChannel | null = null
    let currentUserId: string | null = null
    const close = async () => {
      if (channel) {
        const old = channel
        channel = null
        await supabase.removeChannel(old)
      }
    }
    const connect = async (userId: string | null) => {
      if (stopped || userId === currentUserId) return
      currentUserId = userId
      await close()
      if (stopped || !userId) return
      let next = supabase.channel(`applysignal:${userId}:${tableKey}`)
      for (const table of tableKey.split(',').filter(Boolean)) {
        next = next.on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` }, () => callback.current())
      }
      channel = next.subscribe()
    }
    void supabase.auth.getSession().then(({ data }) => connect(data.session?.user.id ?? null))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => { void connect(session?.user.id ?? null) })
    return () => {
      stopped = true
      data.subscription.unsubscribe()
      void close()
    }
  }, [tableKey])
}
