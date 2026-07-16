/**
 * 웹 푸시 발송 합성 레이어 (9-c).
 *
 * 책임 범위:
 * - 신규 공고 → 페이로드 생성(buildNotificationPayload) → enabled 계정의
 *   채널 조회(pushChannelsRepository) → 채널별 발송(webPushClient) →
 *   만료 채널(410/404) 정리 → 결과 집계.
 * - 채널별 격리: 한 채널의 발송 실패가 나머지 채널 발송을 막지 않는다
 *   (크롤러의 row별 격리와 같은 철학, ADR 006/007).
 * - 만료 정리 실패는 로그만 남기고 삼킨다 — 죽은 endpoint는 다음 발송의
 *   410에서 다시 잡히므로 치명적이지 않다.
 *
 * 책임이 아닌 것:
 * - 발송 여부 판단(신규 유무)과 크롤 흐름 (호출자 /api/cron/crawl의 일).
 * - web-push 프로토콜 (webPushClient).
 * - DB 쿼리 (pushChannelsRepository).
 *
 * 같은 endpoint가 여러 계정 row로 존재하면(공유 브라우저 다계정) 계정마다
 * 발송한다 — 같은 tag라 브라우저 화면에는 하나만 남는다. 중복 발송 비용은
 * ADR 008이 수용한 트레이드오프.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { buildNotificationPayload } from './buildNotificationPayload';
import { sendWebPush, type WebPushSender } from './webPushClient';
import {
  deleteChannelsByEndpoint,
  getEnabledChannels,
} from '@/lib/supabase/pushChannelsRepository';
import type { AnnouncementDetail } from '@/types/announcement';

/** 만료로 간주해 채널을 정리하는 푸시 서비스 응답 코드 (ADR 008: 410 Gone. FCM은 만료에 404도 반환). */
const EXPIRED_STATUS_CODES = new Set([404, 410]);

/** 발송 1회의 채널 단위 집계. sent + expired + failed = 시도한 채널 수. */
export interface DispatchResult {
  /** 발송 성공 채널 수. */
  sent: number;
  /** 만료(410/404)로 판정되어 정리 대상이 된 채널 수. */
  expired: number;
  /** 그 외 실패 채널 수 (다음 신규 공고 발송에서 자연 재시도). */
  failed: number;
}

export interface DispatchOptions {
  /** admin 클라이언트 — cron 배치(세션 없음)의 시스템 조회·정리용. */
  client: SupabaseClient;
  /** 이번 크롤이 감지한 신규 공고 (announcementService 결과). */
  details: AnnouncementDetail[];
  /** 발송 함수 — 테스트에서 모킹. 기본 webPushClient.sendWebPush. */
  sender?: WebPushSender;
  /** 채널 조회 — 테스트 override. */
  fetchChannels?: typeof getEnabledChannels;
  /** 만료 endpoint 삭제 — 테스트 override. */
  removeChannelsByEndpoint?: typeof deleteChannelsByEndpoint;
}

/**
 * 신규 공고를 구독 계정의 모든 배달 채널로 발송한다.
 *
 * 신규가 없거나 발송 대상 채널이 없으면 no-op(전부 0).
 * VAPID 미설정 등 전 채널 공통의 설정 오류는 throw로 전파된다 —
 * 호출자(cron 라우트)가 크롤 성공과 분리해 로그·집계로 처리한다.
 */
export async function dispatchNewAnnouncementNotifications(
  options: DispatchOptions,
): Promise<DispatchResult> {
  const {
    client,
    details,
    sender = sendWebPush,
    fetchChannels = getEnabledChannels,
    removeChannelsByEndpoint = deleteChannelsByEndpoint,
  } = options;

  const payload = buildNotificationPayload(details);
  if (payload === null) {
    return { sent: 0, expired: 0, failed: 0 };
  }

  const channels = await fetchChannels(client);
  if (channels.length === 0) {
    return { sent: 0, expired: 0, failed: 0 };
  }

  // sender는 채널 단위 실패를 결과 객체로 돌려주므로(throw 없음) Promise.all이
  // 안전하다 — 예외는 VAPID 미설정 같은 전 채널 공통 오류뿐이며 그대로 전파한다.
  const results = await Promise.all(
    channels.map((channel) => sender(channel, payload)),
  );

  const result: DispatchResult = { sent: 0, expired: 0, failed: 0 };
  const expiredEndpoints = new Set<string>();

  results.forEach((sendResult, index) => {
    if (sendResult.ok) {
      result.sent += 1;
      return;
    }
    if (
      sendResult.statusCode !== null &&
      EXPIRED_STATUS_CODES.has(sendResult.statusCode)
    ) {
      result.expired += 1;
      expiredEndpoints.add(channels[index].endpoint);
      return;
    }
    result.failed += 1;
    console.warn(
      `[push/dispatch] 발송 실패 (status ${sendResult.statusCode ?? 'n/a'}): ${sendResult.message}`,
    );
  });

  for (const endpoint of expiredEndpoints) {
    try {
      await removeChannelsByEndpoint(client, endpoint);
    } catch (err) {
      // 정리 실패는 다음 발송의 410에서 재시도되므로 발송 결과를 오염시키지 않는다.
      console.warn('[push/dispatch] 만료 채널 정리 실패:', err);
    }
  }

  return result;
}
