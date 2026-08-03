/**
 * 발송(9-c) 전용 배달 채널 조회·정리 리포지터리.
 *
 * - getEnabledChannels: notification_preferences.web_push_enabled = true인
 *   계정의 L2 push_subscriptions 채널 전부를 조회한다 (ADR 008: "웹 푸시가
 *   켜진 계정의 모든 L2 채널로 발송". 채널명 일반화는 ADR 011).
 *   notification_preferences ↔ push_subscriptions 사이에 직접 FK가 없어(둘 다
 *   auth.users를 참조) PostgREST 임베딩 조인이 불가능하므로 2쿼리로 나눈다.
 * - deleteChannelsByEndpoint: 발송이 410 Gone(만료/철회)을 받은 endpoint의
 *   row를 삭제한다. endpoint가 죽었다는 것은 브라우저 채널 자체의 소멸이므로
 *   계정 구분 없이 그 endpoint 전체를 지운다 (ADR 008).
 *
 * 호출자는 cron 배치(세션 없음)이므로 admin 클라이언트를 전달한다 —
 * 사용자 요청 경로의 RLS 강제(9-b)와 달리 시스템 배치는 service role로
 * 전체 행을 읽는다. 클라이언트는 인자로 받아 테스트에서 모킹하기 쉽게 한다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { PushDeliveryChannel } from '@/types/push';

const PREFERENCES_TABLE = 'notification_preferences';
const SUBSCRIPTIONS_TABLE = 'push_subscriptions';

/** push_subscriptions에서 select하는 row 형태 (snake_case). */
interface ChannelRow {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * DB row (snake_case) → 도메인 채널 (camelCase).
 * 순수 함수. 단위 테스트로 매핑 정확성을 검증한다.
 */
export function rowToChannel(row: ChannelRow): PushDeliveryChannel {
  return {
    userId: row.user_id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
  };
}

/**
 * 웹 푸시가 켜진(web_push_enabled) 계정들의 배달 채널(L2)을 모두 조회한다.
 *
 * 해당 계정이 없거나 채널이 하나도 없으면 빈 배열.
 * Supabase 에러는 throw로 표면화 → 호출자에서 발송 스킵·로그로 처리.
 */
export async function getEnabledChannels(
  client: SupabaseClient,
): Promise<PushDeliveryChannel[]> {
  const { data: prefRows, error: prefError } = await client
    .from(PREFERENCES_TABLE)
    .select('user_id')
    .eq('web_push_enabled', true);

  if (prefError) {
    throw new Error(`Failed to get enabled preferences: ${prefError.message}`);
  }

  const userIds = (prefRows ?? []).map((row) => row.user_id);
  if (userIds.length === 0) return [];

  const { data: channelRows, error: channelError } = await client
    .from(SUBSCRIPTIONS_TABLE)
    .select('user_id, endpoint, p256dh, auth')
    .in('user_id', userIds);

  if (channelError) {
    throw new Error(`Failed to get delivery channels: ${channelError.message}`);
  }

  return (channelRows ?? []).map(rowToChannel);
}

/**
 * 만료된 endpoint의 채널 row를 계정 구분 없이 삭제한다 (410 Gone 정리).
 *
 * Supabase 에러는 throw로 표면화 → 호출자에서 로그로 처리
 * (정리 실패는 다음 발송의 410에서 재시도되므로 치명적이지 않다).
 */
export async function deleteChannelsByEndpoint(
  client: SupabaseClient,
  endpoint: string,
): Promise<void> {
  const { error } = await client
    .from(SUBSCRIPTIONS_TABLE)
    .delete()
    .eq('endpoint', endpoint);

  if (error) {
    throw new Error(`Failed to delete push channels: ${error.message}`);
  }
}
