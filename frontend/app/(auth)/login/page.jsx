'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase }  from '../../../lib/supabaseClient.js';

export default function LoginPage() {
  const router = useRouter();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  async function handleLogin(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error: authError } = await supabase.auth.signInWithPassword({
      email:    email.trim(),
      password: password,
    });

    if (authError) {
      setError('Email or password is incorrect. Please try again.');
      setLoading(false);
      return;
    }

    // Reset loading before navigation so button is not permanently stuck
    // if router.push encounters a redirect or delay.
    setLoading(false);
    router.push('/purchase-orders');
  }

  return (
    <div className="min-h-screen bg-brand-black flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-red rounded-2xl mb-4">
            <span className="text-white text-2xl font-black">C</span>
          </div>
          <h1 className="text-white text-2xl font-bold tracking-tight">
            Ceradrive ERP
          </h1>
          <p className="text-gray-400 text-sm mt-1">Sign in to continue</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">

          {error && (
            <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1.5">
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-red focus:border-transparent text-base"
              placeholder="you@ceradrive.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-red focus:border-transparent text-base"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full py-3.5 px-4 rounded-xl bg-brand-red hover:bg-red-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold text-base transition-colors duration-150 min-h-touch"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>

        </form>

        <p className="text-center text-gray-600 text-xs mt-8">
          Ceradrive Brakes ERP · Internal Use Only
        </p>
      </div>
    </div>
  );
}
