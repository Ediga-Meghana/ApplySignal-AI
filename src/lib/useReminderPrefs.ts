import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { reminderKey, type Reminder } from './reminders'
import { useRealtimeRefresh } from './useRealtimeRefresh'
/** Loads the saved in-app reminder preference and the persisted dismissals; dismiss/restore write to the database before updating the UI. */
export function useReminderPrefs() {
  const [s, setS] = useState({ loaded: false, enabled: true, dismissed: new Set<string>(), error: '' })
  const load = useCallback(async () => {
    const [p, d] = await Promise.all([supabase.from('profiles').select('notify_in_app').maybeSingle(), supabase.from('reminder_dismissals').select('key')])
    setS({ loaded: true, enabled: p.data?.notify_in_app ?? true, dismissed: new Set(((d.data ?? []) as { key: string }[]).map(x => x.key)), error: (p.error ?? d.error)?.message ?? '' })
  }, [])
  useEffect(() => { void load() }, [load])
  useRealtimeRefresh(['profiles', 'reminder_dismissals'], load)
  const change = useCallback(async (r: Reminder, dismiss: boolean) => {
    const k = reminderKey(r)
    const { error } = dismiss ? await supabase.from('reminder_dismissals').insert({ key: k }) : await supabase.from('reminder_dismissals').delete().eq('key', k)
    setS(p => { if (error) return { ...p, error: error.message }; const d = new Set(p.dismissed); if (dismiss) d.add(k); else d.delete(k); return { ...p, dismissed: d, error: '' } })
  }, [])
  return { ...s, dismiss: (r: Reminder) => change(r, true), restore: (r: Reminder) => change(r, false) }
}
