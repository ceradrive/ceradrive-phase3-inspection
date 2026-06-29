/**
 * CERADRIVE ERP — Auth Hook
 *
 * Provides current user session and role from Supabase Auth.
 * Used by ERP shell layout (auth guard) and any component needing role awareness.
 *
 * Returns:
 *   user    — Supabase user object or null
 *   role    — app_metadata.role string or null
 *   loading — true while session is being resolved
 *   signOut — function to log out
 */

'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient.js';

export function useAuth() {
  const [user,    setUser]    = useState(null);
  const [role,    setRole]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        setRole(session.user.app_metadata?.role ?? null);
      }
      setLoading(false);
    });

    // Listen for auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user) {
          setUser(session.user);
          setRole(session.user.app_metadata?.role ?? null);
        } else {
          setUser(null);
          setRole(null);
        }
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    // Redirect to login after sign out
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }

  return { user, role, loading, signOut };
}
