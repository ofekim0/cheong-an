import { type NextRequest } from 'next/server';

import { updateSession } from '@/lib/supabase/middleware';

/**
 * 모든 (정적 자산 제외) 요청에서 Supabase 세션 토큰을 갱신한다. (ADR 009)
 */
export async function middleware(request: NextRequest): Promise<Response> {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * 정적 자산·이미지·Service Worker(`sw.js`)를 제외한 모든 경로에서 동작한다.
     */
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
