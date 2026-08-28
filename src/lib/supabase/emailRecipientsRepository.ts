/**
 * 이메일 발송(Step b-2) 전용 수신자 조회 리포지터리 (#65, ADR 011).
 *
 * pushChannelsRepository의 이메일 대응물. 웹 푸시와 달리 이메일은 별도
 * 배달-채널 테이블(L2)이 없다 — 배달 채널이 곧 계정의 이메일 주소이고,
 * 주소는 저장하지 않고 발송 시점에 auth.users에서 조회한다(ADR 011 축3:
 * 주소 변경 동기화·중복 저장 문제 원천 소거).
 *
 * 조회 경로:
 * 1. notification_preferences에서 email_enabled = true인 user_id 조회.
 * 2. 계정마다 auth.admin.getUserById로 이메일 주소 확보 — opt-in 수만큼만
 *    호출한다(listUsers 전체 나열 대비 opt-in 규모에 비례, MVP 규모 적합).
 *
 * 주소가 없는 계정은 조용히 스킵한다 — opt-in 진입은 400으로 게이팅되지만
 * (POST /api/notifications/email), 켠 뒤 주소가 사라지는 엣지(provider 연결
 * 해제 등)까지 발송 측이 방어한다. getUserById 개별 실패도 그 계정만 스킵
 * (계정별 격리 — 한 계정의 조회 실패가 배치를 죽이지 않는다).
 *
 * 호출자는 cron 배치(세션 없음)이므로 admin 클라이언트를 전달한다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const PREFERENCES_TABLE = 'notification_preferences';

/** 이메일 발송 대상 — 발송 결과 귀속용 userId + 배달 주소. */
export interface EmailRecipient {
  userId: string;
  email: string;
}

/**
 * 이메일 알림이 켜진(email_enabled) 계정 중 주소가 있는 수신자를 모두
 * 조회한다.
 *
 * 해당 계정이 없거나 전부 주소가 없으면 빈 배열.
 * preferences 조회의 Supabase 에러는 throw로 표면화(전 수신자 공통 실패) →
 * 호출자(emailAdapter)에서 채널 실패로 처리.
 */
export async function getEmailRecipients(
  client: SupabaseClient,
): Promise<EmailRecipient[]> {
  const { data: prefRows, error: prefError } = await client
    .from(PREFERENCES_TABLE)
    .select('user_id')
    .eq('email_enabled', true);

  if (prefError) {
    throw new Error(
      `Failed to get email-enabled preferences: ${prefError.message}`,
    );
  }

  const userIds = (prefRows ?? []).map((row) => row.user_id as string);
  if (userIds.length === 0) return [];

  const results = await Promise.all(
    userIds.map(async (userId): Promise<EmailRecipient | null> => {
      const { data, error } = await client.auth.admin.getUserById(userId);
      if (error) {
        // 개별 조회 실패는 그 계정만 스킵 — 다음 크롤 발송에서 자연 재시도.
        console.warn(
          `[email/recipients] 사용자 조회 실패 (userId ${userId}): ${error.message}`,
        );
        return null;
      }
      const email = data.user?.email;
      if (!email) return null;
      return { userId, email };
    }),
  );

  return results.filter(
    (recipient): recipient is EmailRecipient => recipient !== null,
  );
}
