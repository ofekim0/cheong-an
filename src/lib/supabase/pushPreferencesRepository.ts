/**
 * push_preferences(L1 구독 의사) 테이블 리포지터리.
 *
 * 계정당 1 row(user_id UNIQUE)로 "이 계정이 알림을 원한다"를 표현한다.
 * 어느 기기에서 토글하든 계정 차원에서 켜지고 꺼진다 — 전 기기 공유
 * (ADR 008). 발송(9-c)은 enabled = true인 계정의 채널(L2)에만 보낸다.
 *
 * 클라이언트는 인자로 받아 테스트에서 모킹하기 쉽게 한다.
 * 호출자는 세션 바인딩된 server 클라이언트를 전달해 RLS가
 * 소유권(user_id = auth.uid())을 강제하게 한다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const TABLE = 'push_preferences';

/**
 * 계정의 구독 의사를 설정한다. row가 없으면 만들고, 있으면 enabled만 갱신
 * (user_id 충돌 키 UPSERT — 멱등).
 *
 * Supabase 에러는 throw로 표면화 → 호출자(Route Handler)에서 5xx로 매핑.
 */
export async function setPushPreference(
  client: SupabaseClient,
  userId: string,
  enabled: boolean,
): Promise<void> {
  const { error } = await client
    .from(TABLE)
    .upsert({ user_id: userId, enabled }, { onConflict: 'user_id' });

  if (error) {
    throw new Error(`Failed to set push preference: ${error.message}`);
  }
}

/**
 * 계정의 구독 의사를 조회한다. row가 없으면(한 번도 구독한 적 없음) false.
 *
 * 구독 페이지가 현재 상태를 노출할 때 쓴다.
 */
export async function getPushPreference(
  client: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from(TABLE)
    .select('enabled')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get push preference: ${error.message}`);
  }

  return data?.enabled === true;
}
