import { useState, useEffect } from 'react'
import { supabase } from './supabase'

export const useAuth = () => {
  const [user, setUser]       = useState(undefined) // undefined = loading
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  useEffect(() => {
    // Récupère la session existante
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
    })

    // Écoute les changements d'auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signUp = async ({ email, password, firstName, username }) => {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { first_name: firstName, username }
      }
    })
    if (error) setError(error.message)
    setLoading(false)
    return !error
  }

  const signIn = async ({ email, password }) => {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
    return !error
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return { user, loading, error, setError, signUp, signIn, signOut }
}
