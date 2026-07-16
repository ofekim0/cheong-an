/**
 * 웹 푸시 구독 공유 타입.
 *
 * 브라우저 `PushSubscription.toJSON()`이 만드는 형태 중 발송(9-c)에
 * 필요한 값만 담는다 — endpoint + keys(p256dh, auth).
 * `expirationTime`은 저장하지 않는다 (ADR 008: 만료 정리는 발송 시 410 Gone).
 */
export interface PushSubscriptionJson {
  /** 푸시 서비스가 구독마다 발급하는 고유 URL. 기기 식별 키 */
  endpoint: string;
  keys: {
    /** 메시지 암호화용 클라이언트 공개키 */
    p256dh: string;
    /** 메시지 인증 시크릿 */
    auth: string;
  };
}

/**
 * 발송(9-c) 대상 배달 채널 — L2 push_subscriptions 한 row의 도메인 표현.
 * web-push sendNotification에 필요한 값 + 발송 결과 귀속용 userId.
 */
export interface PushDeliveryChannel {
  /** 채널 소유 계정 (L1 enabled 판정의 기준) */
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}
