/**
 * CERADRIVE ERP — Supabase Client (Backend)
 *
 * Single shared Supabase client instance using the SERVICE ROLE KEY.
 * - Bypasses Row Level Security — all access control is application-layer.
 * - Imported exclusively by service files. Never imported by routes or controllers.
 * - Never send this client or its key to the frontend.
 *
 * Architecture: Batch 10 Step 10 — Foundation Blueprint approved.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl     = process.env.SUPABASE_URL;
const supabaseKey     = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing Supabase configuration. ' +
    'Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in backend/.env'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // Disable auto session management — backend uses service role, not user sessions
    autoRefreshToken:  false,
    persistSession:    false,
    detectSessionInUrl: false,
  },
});
