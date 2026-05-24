'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { initUserProfile } from '@/lib/firestore';

export default function LoginPage() {
  const router = useRouter();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isSignUp) {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await initUserProfile(cred.user.uid);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      router.push('/dashboard');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Authentication failed';
      setError(msg.replace('Firebase: ', '').replace(/\(auth\/.*\)/, '').trim());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="text-green-400 text-2xl font-bold tracking-widest mb-1">
            ▶ STOCK TERMINAL
          </div>
          <div className="text-gray-500 text-xs tracking-widest">PAPER TRADING SIMULATOR</div>
        </div>

        {/* Card */}
        <div className="bg-[#141414] border border-[#2a2a2a] rounded p-6">
          <div className="flex mb-6 border border-[#2a2a2a] rounded overflow-hidden">
            <button
              className={`flex-1 py-2 text-xs tracking-widest transition-colors ${
                !isSignUp ? 'bg-green-500 text-black font-bold' : 'text-gray-500 hover:text-gray-300'
              }`}
              onClick={() => { setIsSignUp(false); setError(''); }}
            >
              LOGIN
            </button>
            <button
              className={`flex-1 py-2 text-xs tracking-widest transition-colors ${
                isSignUp ? 'bg-green-500 text-black font-bold' : 'text-gray-500 hover:text-gray-300'
              }`}
              onClick={() => { setIsSignUp(true); setError(''); }}
            >
              SIGN UP
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1 tracking-widest">EMAIL</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-green-500 transition-colors"
                placeholder="trader@example.com"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 tracking-widest">PASSWORD</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-green-500 transition-colors"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="text-red-400 text-xs border border-red-900 bg-red-950/30 rounded px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-500 hover:bg-green-400 disabled:bg-green-900 disabled:text-green-700 text-black font-bold py-2 rounded text-sm tracking-widest transition-colors"
            >
              {loading ? 'CONNECTING...' : isSignUp ? 'CREATE ACCOUNT' : 'ENTER MARKET'}
            </button>
          </form>

          {isSignUp && (
            <p className="text-gray-600 text-xs mt-4 text-center">
              New accounts start with ₩5,000,000 seed money
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
