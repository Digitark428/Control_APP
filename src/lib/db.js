import { supabase } from './supabase'

/**
 * Charge l'état depuis Supabase pour l'utilisateur connecté.
 */
export const loadState = async () => {
  try {
    const { data, error } = await supabase
      .from('app_state')
      .select('state')
      .single()

    if (error || !data) return null
    return data.state
  } catch {
    return null
  }
}

/**
 * Sauvegarde l'état dans Supabase (upsert).
 * user_id est automatiquement résolu via RLS / auth.uid()
 */
export const saveState = async (state) => {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase
      .from('app_state')
      .upsert(
        { user_id: user.id, state, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
  } catch {
    // Silently fail
  }
}

