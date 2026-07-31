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

/** RLS 남의 row 거부 검증용 2번째 계정. */
export const SECOND_USER = {
  email: 'e2e-other@cheong-an.test',
  password: 'e2e-other-1234!',
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

/** 이메일로 기존 유저 id를 찾는다(없으면 null). */
async function findUserIdByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<string | null> {
  const { data, error } = await admin.auth.admin.listUsers();
  if (error) throw error;
  const found = data.users.find((u) => u.email === email);
  return found?.id ?? null;
}

/**
 * 유저를 멱등 생성한다 — 이미 있으면 그대로 재사용하고 userId를 반환한다.
 * `email_confirm: true`로 이메일 확인을 건너뛴다(테스트 프로젝트는 provider 설정 없음).
 */
export async function ensureUser(
  email: string,
  password: string,
): Promise<string> {
  const admin = getAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (!error && data.user) return data.user.id;

  // 이미 존재하는 경우만 조회로 폴백한다. 그 외 오류는 그대로 표면화.
  const existing = await findUserIdByEmail(admin, email);
  if (existing) return existing;

  throw new Error(
    `테스트 유저 생성/조회 실패(${email}): ${error?.message ?? '알 수 없는 오류'}`,
  );
}

/** 주 테스트 유저를 멱등 생성한다(global.setup 세션 주입 대상). */
export function ensureTestUser(): Promise<string> {
  return ensureUser(TEST_USER.email, TEST_USER.password);
}

/** 유저를 삭제한다(FK CASCADE로 push_preferences/subscriptions도 정리됨). */
export async function deleteUser(email: string): Promise<void> {
  const admin = getAdminClient();
  const existing = await findUserIdByEmail(admin, email);
  if (existing) await admin.auth.admin.deleteUser(existing);
}

/** 한 유저의 구독 데이터(L1/L2)를 admin으로 모두 지운다 — 테스트 멱등성 확보용. */
export async function clearPushData(userId: string): Promise<void> {
  const admin = getAdminClient();
  await admin.from('push_subscriptions').delete().eq('user_id', userId);
  await admin.from('push_preferences').delete().eq('user_id', userId);
}

/** L1 구독 의사 row(없으면 null). admin(RLS 우회)로 조회. */
export async function getPushPreferenceRow(
  userId: string,
): Promise<{ enabled: boolean } | null> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('push_preferences')
    .select('enabled')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** L2 배달 채널 rows. admin(RLS 우회)로 조회. */
export async function getPushSubscriptionRows(
  userId: string,
): Promise<{ endpoint: string }[]> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('push_subscriptions')
    .select('endpoint')
    .eq('user_id', userId);
  if (error) throw error;
  return data ?? [];
}

/** L1 구독 의사 row를 upsert한다(발송 채널 조회 e2e 시드용). */
export async function setPushPreferenceRow(
  userId: string,
  enabled: boolean,
): Promise<void> {
  const admin = getAdminClient();
  const { error } = await admin
    .from('push_preferences')
    .upsert({ user_id: userId, enabled }, { onConflict: 'user_id' });
  if (error) throw error;
}

/** L2 배달 채널을 시드한다(테스트용 더미 keys). */
export async function insertPushChannels(
  userId: string,
  endpoints: string[],
): Promise<void> {
  const admin = getAdminClient();
  const rows = endpoints.map((endpoint) => ({
    user_id: userId,
    endpoint,
    p256dh: 'e2e-p256dh',
    auth: 'e2e-auth',
  }));
  const { error } = await admin
    .from('push_subscriptions')
    .upsert(rows, { onConflict: 'user_id,endpoint' });
  if (error) throw error;
}

/**
 * 세션 바인딩 anon 클라이언트 — 지정 유저로 로그인해 RLS가 적용되는 상태를
 * 만든다(admin과 달리 RLS 우회 안 함). 남의 row 거부 검증에 쓴다.
 */
export async function createSessionClient(
  email: string,
  password: string,
): Promise<SupabaseClient> {
  const { url, anonKey } = getTestSupabaseEnv();
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`세션 클라 로그인 실패(${email}): ${error.message}`);
  }
  return client;
}
