/**
 * Playwright 세션 주입 setup (ADR 010).
 *
 * 실 OAuth를 우회하고 로그인된 상태를 만든다:
 *   1. 테스트 유저를 멱등 생성한다(admin).
 *   2. `@supabase/ssr`의 createServerClient에 쿠키 캡처 store를 물려
 *      signInWithPassword를 수행한다 — 라이브러리가 직렬화한 세션 쿠키를
 *      그대로 받아 storageState에 기록한다. 쿠키 형식을 손으로 조립하지
 *      않으므로 앱의 server 클라(getSupabaseServerClient)가 읽는 형식과
 *      100% 일치하고, @supabase/ssr 버전이 바뀌어도 안전하다.
 *
 * 산출물: e2e/.auth/user.json (세션 쿠키 포함, .gitignore 처리).
 * chromium 프로젝트가 이 파일을 storageState로 사용한다.
 */

import { test as setup, expect } from '@playwright/test';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  ensureTestUser,
  getTestSupabaseEnv,
  TEST_USER,
} from './helpers/testUser';

export const STORAGE_STATE = 'e2e/.auth/user.json';

/** dev 서버가 localhost에서 뜨므로 쿠키 도메인은 localhost로 고정한다. */
const COOKIE_DOMAIN = 'localhost';
/** storageState 쿠키 만료 — 7일이면 테스트 러너 수명 내내 유효하다. */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

setup('세션 주입: 테스트 유저 로그인 → storageState 기록', async () => {
  await ensureTestUser();
  const { url, anonKey } = getTestSupabaseEnv();

  const captured: { name: string; value: string; options?: CookieOptions }[] =
    [];
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return [];
      },
      setAll(cookiesToSet) {
        captured.push(...cookiesToSet);
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({
    email: TEST_USER.email,
    password: TEST_USER.password,
  });
  expect(error, `테스트 유저 로그인 실패: ${error?.message}`).toBeNull();
  expect(
    captured.length,
    'signInWithPassword가 세션 쿠키를 생성하지 않았습니다.',
  ).toBeGreaterThan(0);

  const cookies = captured.map(({ name, value }) => ({
    name,
    value,
    domain: COOKIE_DOMAIN,
    path: '/',
    httpOnly: false,
    secure: false,
    sameSite: 'Lax' as const,
    expires: Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_SECONDS,
  }));

  mkdirSync(dirname(STORAGE_STATE), { recursive: true });
  writeFileSync(
    STORAGE_STATE,
    JSON.stringify({ cookies, origins: [] }, null, 2),
  );
});
