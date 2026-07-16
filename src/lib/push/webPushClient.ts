/**
 * web-push 라이브러리 얇은 어댑터 (9-c).
 *
 * 책임 범위:
 * - VAPID env 3종을 읽어 발송 자격 증명을 구성한다 (미설정은 throw로 표면화).
 * - 도메인 채널(PushDeliveryChannel) → web-push 구독 형태 변환 + 발송.
 * - 발송 결과를 라이브러리 중립 형태(WebPushSendResult)로 정규화한다 —
 *   호출자(notificationService)가 web-push 타입에 의존하지 않게 하고,
 *   410/404 판정에 필요한 statusCode만 노출한다.
 *
 * 책임이 아닌 것:
 * - 채널 조회, 410 정리, 채널별 격리·집계 (notificationService의 일).
 *
 * 전역 setVapidDetails 대신 호출마다 vapidDetails 옵션을 전달한다 —
 * 모듈 전역 상태가 없어 테스트 격리가 쉽고, 초기화 순서 문제가 없다.
 */

import webpush from 'web-push';

import type { PushNotificationPayload } from './buildNotificationPayload';
import type { PushDeliveryChannel } from '@/types/push';

/** 발송 1건의 정규화된 결과. */
export type WebPushSendResult =
  | { ok: true }
  | {
      ok: false;
      /** 푸시 서비스 HTTP 응답 코드. 네트워크 등 비HTTP 실패면 null. */
      statusCode: number | null;
      message: string;
    };

/** 발송 함수 시그니처 — notificationService가 테스트에서 모킹하는 경계. */
export type WebPushSender = (
  channel: PushDeliveryChannel,
  payload: PushNotificationPayload,
) => Promise<WebPushSendResult>;

interface VapidDetails {
  subject: string;
  publicKey: string;
  privateKey: string;
}

/**
 * VAPID env 3종을 읽어 발송 자격 증명을 만든다. 하나라도 없으면 throw —
 * 발송 경로에 들어온 시점에 자격 증명이 없는 것은 배포 설정 오류이므로
 * 조용히 스킵하지 않고 표면화한다.
 */
export function getVapidDetailsFromEnv(): VapidDetails {
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!subject || !publicKey || !privateKey) {
    throw new Error(
      'VAPID env가 설정되지 않았습니다: VAPID_SUBJECT, NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY 필요',
    );
  }

  return { subject, publicKey, privateKey };
}

/**
 * 채널 하나에 알림 페이로드를 발송한다.
 *
 * 실패는 throw하지 않고 결과 객체로 돌려준다 — 채널별 격리(한 채널 실패가
 * 배치를 죽이지 않음)는 이 정규화 위에서 notificationService가 수행한다.
 * 단, VAPID env 미설정은 던진다(모든 채널이 실패할 설정 오류).
 */
export const sendWebPush: WebPushSender = async (channel, payload) => {
  const vapidDetails = getVapidDetailsFromEnv();

  try {
    await webpush.sendNotification(
      {
        endpoint: channel.endpoint,
        keys: { p256dh: channel.p256dh, auth: channel.auth },
      },
      JSON.stringify(payload),
      { vapidDetails },
    );
    return { ok: true };
  } catch (err) {
    // web-push의 WebPushError는 statusCode를 가진다. instanceof 대신
    // 덕 타이핑으로 판정해 라이브러리 내부 클래스에 결합하지 않는다.
    const statusCode =
      err && typeof err === 'object' && 'statusCode' in err
        ? Number((err as { statusCode: unknown }).statusCode)
        : null;
    const message = err instanceof Error ? err.message : 'Unknown error';

    return {
      ok: false,
      statusCode: Number.isFinite(statusCode) ? statusCode : null,
      message,
    };
  }
};
