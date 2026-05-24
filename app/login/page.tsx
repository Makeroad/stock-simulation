'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { initUserProfile } from '@/lib/firestore';

function toEmail(id: string) {
  return `${id.toLowerCase()}@stockapp.local`;
}

export default function LoginPage() {
  const router = useRouter();
  const [isSignUp, setIsSignUp] = useState(false);
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function parseError(msg: string) {
    if (msg.includes('user-not-found') || msg.includes('invalid-credential') || msg.includes('wrong-password')) return '아이디 또는 비밀번호가 올바르지 않습니다.';
    if (msg.includes('email-already-in-use')) return '이미 사용 중인 아이디입니다.';
    if (msg.includes('weak-password')) return '비밀번호는 6자 이상이어야 합니다.';
    if (msg.includes('too-many-requests')) return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
    if (msg.includes('invalid-api-key') || msg.includes('api-key')) return 'Firebase 설정 오류입니다. 관리자에게 문의하세요.';
    return '오류가 발생했습니다. 다시 시도해 주세요.';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(userId)) {
      setError('아이디는 영문·숫자·밑줄(_) 3~20자로 입력해 주세요.');
      return;
    }

    setLoading(true);
    try {
      const email = toEmail(userId);
      if (isSignUp) {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await initUserProfile(cred.user.uid);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      router.push('/dashboard');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      setError(parseError(msg));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* 헤더 */}
        <div className="mb-8 text-center">
          <div className="text-green-400 text-2xl font-bold tracking-widest mb-1">
            ▶ 주식 터미널
          </div>
          <div className="text-gray-500 text-xs tracking-widest">모의 주식 거래 시뮬레이터</div>
        </div>

        {/* 카드 */}
        <div className="bg-[#141414] border border-[#2a2a2a] rounded p-6">
          <div className="flex mb-6 border border-[#2a2a2a] rounded overflow-hidden">
            <button
              className={`flex-1 py-2 text-xs tracking-widest transition-colors ${
                !isSignUp ? 'bg-green-500 text-black font-bold' : 'text-gray-500 hover:text-gray-300'
              }`}
              onClick={() => { setIsSignUp(false); setError(''); }}
            >
              로그인
            </button>
            <button
              className={`flex-1 py-2 text-xs tracking-widest transition-colors ${
                isSignUp ? 'bg-green-500 text-black font-bold' : 'text-gray-500 hover:text-gray-300'
              }`}
              onClick={() => { setIsSignUp(true); setError(''); }}
            >
              회원가입
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1 tracking-widest">아이디</label>
              <input
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                required
                className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-green-500 transition-colors"
                placeholder="영문·숫자 3~20자"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1 tracking-widest">비밀번호</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-[#0f0f0f] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-green-500 transition-colors"
                placeholder="6자 이상"
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
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
              {loading ? '처리 중...' : isSignUp ? '계정 만들기' : '시장 입장'}
            </button>
          </form>

          {isSignUp && (
            <p className="text-gray-600 text-xs mt-4 text-center">
              신규 계정에는 ₩5,000,000 시드머니가 지급됩니다
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
