/**
 * 브라우저 푸시 구독 합성 스텁 (ADR 010).
 *
 * headless Chromium에서 실 FCM 구독 생성(`pushManager.subscribe`)은 푸시 서비스가
 * 없어 비결정적으로 실패한다. `PushManager.prototype`만 합성 구독으로 스텁해 구독
 * 생성 단계만 결정론적으로 만든다 — 실제 SW 등록·버튼 클릭·`POST /api/push/subscribe`·
 * RLS·DB 쓰기는 모두 진짜로 일어난다(소유 표면 검증). 실 구독 생성 경로 자체는
 * 자동화 경계 밖(수동 스모크).
 */

import type { BrowserContext, Page } from '@playwright/test';

/** 합성 구독의 고정 값 — 실제 FCM endpoint 형식을 흉내낸다(저장/조회 검증용). */
export const FAKE_SUBSCRIPTION = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-fake-channel-0001',
  expirationTime: null,
  keys: {
    p256dh:
      'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8',
    auth: 'e2e-fake-auth-secret',
  },
} as const;

/**
 * notifications 권한을 부여하고, `PushManager.prototype.subscribe/getSubscription`을
 * 합성 구독으로 스텁한다. goto 전에 호출해야 한다(addInitScript는 다음 내비게이션부터 적용).
 */
export async function stubPushSubscription(
  context: BrowserContext,
  page: Page,
): Promise<void> {
  await context.grantPermissions(['notifications']);
  await page.addInitScript((sub) => {
    if (!('PushManager' in window)) return;
    const fake = {
      endpoint: sub.endpoint,
      expirationTime: null,
      toJSON: () => sub,
      unsubscribe: async () => true,
    };
    Object.defineProperty(PushManager.prototype, 'subscribe', {
      configurable: true,
      value: async () => fake,
    });
    // 시작 시엔 기존 구독 없음 — 클릭으로 생성되는 경로를 검증한다.
    Object.defineProperty(PushManager.prototype, 'getSubscription', {
      configurable: true,
      value: async () => null,
    });
  }, FAKE_SUBSCRIPTION);
}
