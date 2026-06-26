/**
 * 서버(서버 컴포넌트 / Route Handler / 서버 액션)용 세션 바인딩 Supabase 클라이언트.
 *
 * 요청 쿠키에서 세션을 읽고, 토큰 갱신 시 응답 쿠키에 기록한다.
 * 세션 토큰의 주기적 갱신은 middleware.ts가 담당한다.
 * 서버에서 인증 상태를 확인할 때는 `getClaims()`를 쓴다(ADR 009).
 *
 * admin 클라이언트(client.ts, service role)와 용도가 다르다 — 이쪽은
 * 로그인한 사용자 컨텍스트로 동작해 RLS가 소유권을 강제한다.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { getSupabasePublicConfig } from './publicConfig';

export async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabasePublicConfig();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // 서버 컴포넌트에서 호출되면 쿠키 쓰기가 막힌다.
          // 세션 갱신은 미들웨어가 처리하므로 여기서는 무시해도 안전하다.
        }
      },
    },
  });
}
