'use client';

import { useState } from 'react';

import {
  signInWithProvider,
  type SocialProvider,
} from '@/lib/auth/signInWithProvider';

const PROVIDERS: { provider: SocialProvider; label: string }[] = [
  { provider: 'google', label: 'Google로 로그인' },
  { provider: 'kakao', label: '카카오로 로그인' },
];

interface LoginButtonsProps {
  /** 로그인 후 복귀할 앱 내부 경로 */
  next?: string;
}

/**
 * 소셜 로그인 버튼(구글·카카오). 클릭 시 provider 인증 페이지로 이동한다.
 *
 * 실제 디자인은 Sprint 2 화면이 모두 잡힌 뒤 일괄 작업한다(임시 UI). (ADR 009)
 */
export function LoginButtons({ next = '/' }: LoginButtonsProps) {
  const [pending, setPending] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick(provider: SocialProvider) {
    setPending(provider);
    setError(null);
    const { error } = await signInWithProvider(provider, next);
    // 성공 시 브라우저가 provider로 리다이렉트되므로 이 줄에 도달하지 않는다.
    if (error) {
      setError(error.message);
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {PROVIDERS.map(({ provider, label }) => (
        <button
          key={provider}
          type="button"
          onClick={() => void handleClick(provider)}
          disabled={pending !== null}
          className="w-fit rounded border px-4 py-2 disabled:opacity-50"
        >
          {pending === provider ? '이동 중…' : label}
        </button>
      ))}

      {error && <p className="text-sm text-red-600">로그인 오류: {error}</p>}
    </div>
  );
}
