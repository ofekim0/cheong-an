/**
 * E2E 테스트 유저 하네스 (ADR 010).
 *
 * 실 소셜 OAuth를 우회하기 위해, 전용 테스트 프로젝트에 admin API로 password
 * 유저를 만들어 세션을 발급받는다. password 유저 생성은 **테스트 한정**이며
 * 제품의 소셜 전용 정책(ADR 009)을 바꾸지 않는다.
 *
 * 세션 쿠키 조립은 global.setup.ts가 `@supabase/ssr`로 직접 수행한다 —
 * 이 모듈은 유저 생성/조회/정리와 테스트 env·admin 클라 제공만 담당한다.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { loadTestEnv } from './testEnv';

/** 고정 테스트 계정. 전용 테스트 프로젝트에서만 쓰이므로 값이 노출돼도 무해하다. */
export const TEST_USER = {
  email: 'e2e@cheong-an.test',
  password: 'e2e-password-1234!',
} as const;

export interface TestSupabaseEnv {
  url: string;
  serviceRoleKey: string;
  anonKey: string;
}

/** 테스트 프로젝트 접속에 필요한 3개 값. 누락 시 안내와 함께 throw. */
export function getTestSupabaseEnv(): TestSupabaseEnv {
  const env = loadTestEnv();
  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !serviceRoleKey || !anonKey) {
    throw new Error(
      '.env.test에 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY 가 모두 필요합니다 (ADR 010).',
    );
  }

  return { url, serviceRoleKey, anonKey };
}

/** service_role admin 클라이언트 — 유저 생성/정리·row 검증(RLS 우회)에 쓴다. */
export function getAdminClient(): SupabaseClient {
  const { url, serviceRoleKey } = getTestSupabaseEnv();
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** 이메일로 기존 테스트 유저를 찾는다(없으면 null). */
async function findTestUser(admin: SupabaseClient): Promise<string | null> {
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) throw error;
  const found = data.users.find((u) => u.email === TEST_USER.email);
  return found?.id ?? null;
}

/**
 * 테스트 유저를 멱등 생성한다 — 이미 있으면 그대로 재사용하고 userId를 반환한다.
 * `email_confirm: true`로 이메일 확인을 건너뛴다(테스트 프로젝트는 provider 설정 없음).
 */
export async function ensureTestUser(): Promise<string> {
  const admin = getAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email: TEST_USER.email,
    password: TEST_USER.password,
    email_confirm: true,
  });

  if (!error && data.user) return data.user.id;

  // 이미 존재하는 경우만 조회로 폴백한다. 그 외 오류는 그대로 표면화.
  const existing = await findTestUser(admin);
  if (existing) return existing;

  throw new Error(
    `테스트 유저 생성/조회 실패: ${error?.message ?? '알 수 없는 오류'}`,
  );
}

/** 테스트 유저를 삭제한다(FK CASCADE로 push_preferences/subscriptions도 정리됨). */
export async function deleteTestUser(): Promise<void> {
  const admin = getAdminClient();
  const existing = await findTestUser(admin);
  if (existing) await admin.auth.admin.deleteUser(existing);
}
