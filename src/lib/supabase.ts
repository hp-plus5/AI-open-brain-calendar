import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment variables')
}

// No Database generic: supabase-js 2.99 requires the Database type to satisfy
// GenericSchema internally, which needs non-trivial structural changes to our
// hand-written types. Since every call site casts results manually (e.g. `as
// CalendarEventWithLocation[]`), the generic adds no practical safety here.
// See src/types/database.ts for the full type definitions.
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
