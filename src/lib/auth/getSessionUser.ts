/**
 * 서버(서버 컴포넌트 / Route Handler / 서버 액션)에서 현재 로그인한
 * 사용자를 도출한다. 로그인 게이팅과 9-b 구독 저장의 단일 진입점이다.
 *
 * 세션 검증은 `getClaims()`로 한다(ADR 009) — 미들웨어가 갱신한 쿠키 세션의
 * JWT 클레임을 읽는다. 비로그인·검증 실패 시 null을 반환한다.
 */

import { getSupabaseServerClient } from '@/lib/supabase/serverClient';

export interface SessionUser {
  /** Supabase `auth.users.id` (JWT `sub`). 구독 등 소유권의 기준 */
  userId: string;
  /** provider가 제공한 이메일. 없으면 null */
  email: string | null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) return null;

  const { sub, email } = data.claims;
  return {
    userId: sub,
    email: typeof email === 'string' ? email : null,
  };
}
