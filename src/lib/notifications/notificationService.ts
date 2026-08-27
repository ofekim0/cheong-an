/**
 * 알림 발송 합성 레이어 (9-c → Step b-1에서 채널 플러그형으로 일반화, ADR 011 축2).
 *
 * 책임 범위:
 * - 신규 공고를 채널 어댑터 목록에 순회 발송하고 채널별 집계를 모은다.
 * - 채널 간 격리: 한 채널의 실패(어댑터 throw — 예: VAPID 미설정)가 다른
 *   채널의 발송을 막지 않는다. 실패 채널은 집계 대신 { error }로 표면화한다
 *   (크롤러의 row별 격리와 같은 철학, ADR 006/007).
 *
 * 책임이 아닌 것:
 * - 발송 여부 판단(신규 유무)과 크롤 흐름 (호출자 /api/cron/crawl의 일).
 * - 채널별 파이프라인(대상 조회·발송·만료 정리) — 각 어댑터가 소유
 *   (webPushAdapter, 이후 emailAdapter).
 *
 * 채널 추가 = 어댑터 구현 + 호출자의 adapters 배열에 한 줄 (ADR 011).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  ChannelAdapter,
  ChannelResult,
} from '@/lib/notifications/channelAdapter';
import type { AnnouncementDetail } from '@/types/announcement';

/**
 * 채널별 발송 결과 맵. 키는 어댑터의 channel.
 * 어댑터가 throw한 채널은 집계 대신 { error }가 담긴다.
 */
export type NotificationDispatchResult = Record<
  string,
  ChannelResult | { error: string }
>;

export interface DispatchOptions {
  /** admin 클라이언트 — cron 배치(세션 없음)의 시스템 조회·정리용. */
  client: SupabaseClient;
  /** 이번 크롤이 감지한 신규 공고 (announcementService 결과). */
  details: AnnouncementDetail[];
  /** 발송할 채널 어댑터 목록 — 호출자가 구성, 테스트에서 모킹. */
  adapters: ChannelAdapter[];
}

/**
 * 신규 공고를 모든 채널 어댑터로 발송하고 채널별 집계를 돌려준다.
 *
 * 어댑터들은 병렬로 실행된다(채널 간 의존성 없음). 어댑터가 throw하면 그
 * 채널만 { error }로 기록하고 나머지 채널은 정상 진행한다 — 이 함수 자체는
 * throw하지 않으므로 호출자는 결과 맵만 응답에 실으면 된다.
 */
export async function dispatchNotifications(
  options: DispatchOptions,
): Promise<NotificationDispatchResult> {
  const { client, details, adapters } = options;

  const entries = await Promise.all(
    adapters.map(
      async (adapter): Promise<[string, ChannelResult | { error: string }]> => {
        try {
          return [adapter.channel, await adapter.dispatch(client, details)];
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          console.error(`[notifications] ${adapter.channel} 발송 실패:`, err);
          return [adapter.channel, { error: message }];
        }
      },
    ),
  );

  return Object.fromEntries(entries);
}
