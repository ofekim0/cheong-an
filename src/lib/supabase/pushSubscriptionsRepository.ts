/**
 * push_subscriptions(L2 배달 채널) 테이블 UPSERT 리포지터리 패턴.
 *
 * - 입력: 세션에서 도출한 userId + 브라우저 PushSubscription JSON.
 * - 동작: UNIQUE(user_id, endpoint)를 키로 UPSERT — 같은 기기의 재구독은
 *   멱등 갱신되고, 같은 기기를 쓰는 다른 계정의 채널과는 충돌하지 않는다
 *   (ADR 008: 계정별 독립).
 * - 클라이언트는 인자로 받아 테스트에서 모킹하기 쉽게 한다.
 *   호출자는 세션 바인딩된 server 클라이언트를 전달해 RLS가
 *   소유권(user_id = auth.uid())을 강제하게 한다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { PushSubscriptionJson } from '@/types/push';

const TABLE = 'push_subscriptions';

/** Supabase에 UPSERT로 전달하는 row 형태 (snake_case). */
export interface PushSubscriptionInsertRow {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
}

/**
 * PushSubscription JSON + 소유자 → DB row (snake_case).
 * 순수 함수. 단위 테스트로 매핑 정확성을 검증한다.
 */
export function subscriptionToRow(
  userId: string,
  subscription: PushSubscriptionJson,
  userAgent: string | null,
): PushSubscriptionInsertRow {
  return {
    user_id: userId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    user_agent: userAgent,
  };
}

/**
 * 배달 채널 row를 push_subscriptions 테이블에 UPSERT.
 *
 * - (user_id, endpoint)를 충돌 키로 사용 (마이그레이션의 복합 UNIQUE와 일치).
 * - Supabase 에러는 throw로 표면화 → 호출자(Route Handler)에서 5xx로 매핑.
 */
export async function upsertPushSubscription(
  client: SupabaseClient,
  row: PushSubscriptionInsertRow,
): Promise<void> {
  const { error } = await client
    .from(TABLE)
    .upsert(row, { onConflict: 'user_id,endpoint' });

  if (error) {
    throw new Error(`Failed to upsert push subscription: ${error.message}`);
  }
}
