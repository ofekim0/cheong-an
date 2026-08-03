/**
 * notification_preferences(계정 단위 채널별 알림 의사) 리포지터리.
 *
 * 계정당 1 row(user_id UNIQUE)로 "이 계정이 어느 채널로 알림을 원하는가"를
 * 채널별 불리언 컬럼으로 표현한다(ADR 011). 어느 기기에서 토글하든 계정
 * 차원에서 켜지고 꺼진다 — 전 기기 공유(ADR 008 L1 성질 계승).
 *
 * 채널 추가(알림톡 등)는 CHANNEL_COLUMN에 매핑 한 줄 + 마이그레이션 컬럼
 * 하나로 끝난다.
 *
 * 클라이언트는 인자로 받아 테스트에서 모킹하기 쉽게 한다. 호출자는 세션
 * 바인딩된 server 클라이언트를 전달해 RLS(user_id = auth.uid())가 소유권을
 * 강제하게 한다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const TABLE = 'notification_preferences';

/** opt-in을 저장하는 알림 채널. 발송 어댑터(ADR 011 축2)와 1:1 대응. */
export type NotificationChannel = 'web_push' | 'email';

/** 채널 → notification_preferences의 불리언 컬럼명. */
const CHANNEL_COLUMN: Record<NotificationChannel, string> = {
  web_push: 'web_push_enabled',
  email: 'email_enabled',
};

/**
 * 계정의 특정 채널 구독 의사를 설정한다. row가 없으면 만들고, 있으면 해당
 * 채널 컬럼만 갱신한다(user_id 충돌 키 UPSERT — 멱등).
 *
 * 페이로드에 대상 채널 컬럼만 담으므로 ON CONFLICT DO UPDATE가 그 컬럼만
 * 갱신한다 — 다른 채널의 opt-in을 덮어쓰지 않는다. 신규 INSERT 시 나머지
 * 채널 컬럼은 DEFAULT(false)로 채워진다.
 *
 * Supabase 에러는 throw로 표면화 → 호출자(Route Handler)에서 5xx로 매핑.
 */
export async function setChannelPreference(
  client: SupabaseClient,
  userId: string,
  channel: NotificationChannel,
  enabled: boolean,
): Promise<void> {
  const column = CHANNEL_COLUMN[channel];
  const { error } = await client
    .from(TABLE)
    .upsert({ user_id: userId, [column]: enabled }, { onConflict: 'user_id' });

  if (error) {
    throw new Error(`Failed to set ${channel} preference: ${error.message}`);
  }
}

/**
 * 계정의 특정 채널 구독 의사를 조회한다. row가 없거나(한 번도 설정 안 함)
 * 해당 채널이 꺼져 있으면 false.
 *
 * 구독 페이지가 현재 상태를 토글로 노출할 때 쓴다.
 */
export async function getChannelPreference(
  client: SupabaseClient,
  userId: string,
  channel: NotificationChannel,
): Promise<boolean> {
  const column = CHANNEL_COLUMN[channel];
  const { data, error } = await client
    .from(TABLE)
    .select(column)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get ${channel} preference: ${error.message}`);
  }

  return (data as Record<string, unknown> | null)?.[column] === true;
}
