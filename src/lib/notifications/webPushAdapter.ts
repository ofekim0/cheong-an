/**
 * 웹 푸시 채널 어댑터 (Step b-1, ADR 011 축2).
 *
 * ChannelAdapter의 첫 구현. 9-c의 발송 로직(페이로드 생성 → enabled 계정의
 * L2 채널 조회 → 채널별 발송 → 410/404 만료 정리 → 집계)을 그대로 담는다.
 * 동작은 이전 notificationService.dispatchNewAnnouncementNotifications와 동일하며,
 * 채널 플러그형 인터페이스에 맞춰 캡슐화만 했다.
 *
 * 책임 범위:
 * - 채널별 격리: 한 채널의 발송 실패가 나머지 채널 발송을 막지 않는다
 *   (크롤러의 row별 격리와 같은 철학, ADR 006/007).
 * - 만료 정리 실패는 로그만 남기고 삼킨다 — 죽은 endpoint는 다음 발송의
 *   410에서 다시 잡히므로 치명적이지 않다.
 *
 * 책임이 아닌 것:
 * - 발송 여부 판단(신규 유무)과 크롤 흐름 (호출자 /api/cron/crawl의 일).
 * - 채널 간 격리·순회 (notificationService의 일).
 * - web-push 프로토콜 (webPushClient).
 * - DB 쿼리 (pushChannelsRepository).
 *
 * 같은 endpoint가 여러 계정 row로 존재하면(공유 브라우저 다계정) 계정마다
 * 발송한다 — 같은 tag라 브라우저 화면에는 하나만 남는다. 중복 발송 비용은
 * ADR 008이 수용한 트레이드오프.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ChannelAdapter, ChannelResult } from './channelAdapter';
import { buildNotificationPayload } from '@/lib/push/buildNotificationPayload';
import { sendWebPush, type WebPushSender } from '@/lib/push/webPushClient';
import {
  deleteChannelsByEndpoint,
  getEnabledChannels,
} from '@/lib/supabase/pushChannelsRepository';
import type { AnnouncementDetail } from '@/types/announcement';

/** 만료로 간주해 채널을 정리하는 푸시 서비스 응답 코드 (ADR 008: 410 Gone. FCM은 만료에 404도 반환). */
const EXPIRED_STATUS_CODES = new Set([404, 410]);

/** 어댑터 구성 시 주입 가능한 의존성 — 테스트에서 모킹하는 경계. */
export interface WebPushAdapterDeps {
  /** 발송 함수. 기본 webPushClient.sendWebPush. */
  sender?: WebPushSender;
  /** 채널 조회. 기본 pushChannelsRepository.getEnabledChannels. */
  fetchChannels?: typeof getEnabledChannels;
  /** 만료 endpoint 삭제. 기본 pushChannelsRepository.deleteChannelsByEndpoint. */
  removeChannelsByEndpoint?: typeof deleteChannelsByEndpoint;
}

/**
 * 웹 푸시 채널 어댑터를 만든다. 의존성은 인자로 받아 테스트에서 교체한다.
 *
 * dispatch는 신규 공고를 web_push_enabled 계정의 모든 배달 채널로 발송한다.
 * 신규가 없거나 발송 대상 채널이 없으면 no-op(전부 0). VAPID 미설정 등 전
 * 채널 공통의 설정 오류는 throw로 전파되며, notificationService가 채널 단위로
 * 격리한다.
 */
export function createWebPushAdapter(
  deps: WebPushAdapterDeps = {},
): ChannelAdapter {
  const {
    sender = sendWebPush,
    fetchChannels = getEnabledChannels,
    removeChannelsByEndpoint = deleteChannelsByEndpoint,
  } = deps;

  return {
    channel: 'web_push',
    async dispatch(
      client: SupabaseClient,
      details: AnnouncementDetail[],
    ): Promise<ChannelResult> {
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

      const result: ChannelResult = { sent: 0, expired: 0, failed: 0 };
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
    },
  };
}

/** 기본 의존성으로 구성한 웹 푸시 어댑터 (프로덕션 경로). */
export const webPushAdapter = createWebPushAdapter();
