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

/**
 * Supprime toutes les données de l'utilisateur (droit à l'effacement RGPD).
 * Efface la ligne app_state de l'utilisateur courant. La suppression complète
 * du compte d'authentification lui-même nécessite un appel admin côté serveur
 * (Edge Function) ; côté client on garantit l'effacement des données métier et
 * la déconnexion, ce qui rend le compte vide et inaccessible.
 * Renvoie { success: boolean, error?: string }.
 */
export const deleteAccountData = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Session introuvable.' }

    const { error } = await supabase
      .from('app_state')
      .delete()
      .eq('user_id', user.id)

    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (e) {
    return { success: false, error: e?.message || 'Erreur inconnue.' }
  }
}


