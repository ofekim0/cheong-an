'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { getSupabaseBrowserClient } from '@/lib/supabase/browserClient';

/**
 * 로그아웃 버튼. 쿠키 세션을 제거한 뒤 현재 라우트를 새로고침해
 * 서버 컴포넌트의 로그인 상태(게이팅)를 다시 평가하게 한다. (ADR 009)
 */
export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    await getSupabaseBrowserClient().auth.signOut();
    router.refresh();
    setPending(false);
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={pending}
      className="w-fit rounded border px-4 py-2 disabled:opacity-50"
    >
      {pending ? '로그아웃 중…' : '로그아웃'}
    </button>
  );
}
