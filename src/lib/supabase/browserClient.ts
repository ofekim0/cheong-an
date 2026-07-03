/**
 * 브라우저(클라이언트 컴포넌트)용 Supabase 클라이언트.
 *
 * 공개 anon 키를 사용하며, 쿠키 기반 세션을 브라우저에서 읽고 쓴다.
 * 로그인 트리거(`signInWithOAuth`)·로그아웃 등 클라이언트 인증 동작에 쓴다. (ADR 009)
 */

import { createBrowserClient } from '@supabase/ssr';

import { getSupabasePublicConfig } from './publicConfig';

export function getSupabaseBrowserClient() {
  const { url, anonKey } = getSupabasePublicConfig();
  return createBrowserClient(url, anonKey);
}
