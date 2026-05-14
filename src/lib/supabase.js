import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://pnsmmyzghdjttxftlefs.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBuc21teXpnaGRqdHR4ZnRsZWZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NjU2NDQsImV4cCI6MjA5NDM0MTY0NH0.sjT0cor766tINc2TjDmJfxZ77llYLQbLeqZCiGXFOao'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'implicit',
  },
  global: {
    fetch: (...args) => fetch(...args),
  },
})
