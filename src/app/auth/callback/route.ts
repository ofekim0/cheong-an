import { NextResponse } from 'next/server';

import { getSupabaseServerClient } from '@/lib/supabase/serverClient';

/**
 * OAuth 로그인 콜백. provider 리다이렉트로 받은 authorization code를
 * 세션으로 교환(`exchangeCodeForSession`)하고 앱으로 되돌린다. (ADR 009)
 *
 * 성공: `next`(기본 '/')로 리다이렉트.
 * 실패(code 누락·교환 실패): 홈으로 리다이렉트하며 `auth_error` 쿼리 부착.
 */
export async function GET(request: Request): Promise<Response> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = sanitizeNext(searchParams.get('next'));

  if (!code) {
    return NextResponse.redirect(`${origin}/?auth_error=missing_code`);
  }

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/?auth_error=exchange_failed`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}

/**
 * open redirect 방지: 앱 내부 절대경로(`/`로 시작, `//` 제외)만 허용하고
 * 그 외에는 홈(`/`)으로 돌린다.
 */
function sanitizeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}
