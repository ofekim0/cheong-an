/**
 * 미들웨어용 세션 갱신 헬퍼.
 *
 * 요청 쿠키의 세션을 읽어 `getClaims()`로 검증·갱신하고, 갱신된 토큰을
 * 요청·응답 쿠키에 반영한다. 서버 컴포넌트는 쿠키를 직접 쓸 수 없으므로
 * 토큰의 주기적 갱신은 미들웨어가 담당한다. (ADR 009)
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { getSupabasePublicConfig } from './publicConfig';

export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  const { url, anonKey } = getSupabasePublicConfig();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  // 중요: createServerClient와 getClaims() 사이에 다른 코드를 넣지 말 것.
  // 세션 갱신 타이밍이 어긋나면 무작위 로그아웃이 발생할 수 있다.
  await supabase.auth.getClaims();

  return supabaseResponse;
}
