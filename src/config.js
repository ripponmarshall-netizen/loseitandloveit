// Public client config. The publishable key is designed to be shipped in
// browser code: Row Level Security in Postgres is what protects the data.
// Never put a service-role key or the Anthropic API key here.
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://ikaccpktgcbwpvbqoxzr.supabase.co'

export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_2WvguqD23R2nQo8JTzVRtw_eFOJKywW'

export const AI_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/ai`

export const APP_VERSION = '0.6.0'
