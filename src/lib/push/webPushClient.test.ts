import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getVapidDetailsFromEnv, sendWebPush } from './webPushClient';
import type { PushNotificationPayload } from './buildNotificationPayload';
import type { PushDeliveryChannel } from '@/types/push';

vi.mock('web-push', () => ({
  default: { sendNotification: vi.fn() },
}));

import webpush from 'web-push';

const sendNotification = vi.mocked(webpush.sendNotification);

const CHANNEL: PushDeliveryChannel = {
  userId: 'b7e6a4c2-0000-4000-8000-000000000001',
  endpoint: 'https://fcm.googleapis.com/fcm/send/aaa',
  p256dh: 'p256dh-a',
  auth: 'auth-a',
};

const PAYLOAD: PushNotificationPayload = {
  title: '청안 — 새 공고',
  body: '테스트 공고',
  url: 'https://soco.seoul.go.kr/youth/bbs/BMSR00015/view.do?boardId=1&menuNo=400008',
  tag: 'cheongan-announcement-1',
};

function stubVapidEnv() {
  vi.stubEnv('VAPID_SUBJECT', 'mailto:test@example.com');
  vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'public-key');
  vi.stubEnv('VAPID_PRIVATE_KEY', 'private-key');
}

beforeEach(() => {
  sendNotification.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getVapidDetailsFromEnv', () => {
  it('env 3종이 모두 있으면 자격 증명을 반환한다', () => {
    stubVapidEnv();

    expect(getVapidDetailsFromEnv()).toEqual({
      subject: 'mailto:test@example.com',
      publicKey: 'public-key',
      privateKey: 'private-key',
    });
  });

  it.each([
    'VAPID_SUBJECT',
    'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
    'VAPID_PRIVATE_KEY',
  ])('%s가 없으면 throw한다', (missingKey) => {
    stubVapidEnv();
    vi.stubEnv(missingKey, '');

    expect(() => getVapidDetailsFromEnv()).toThrow(/VAPID env/);
  });
});

describe('sendWebPush', () => {
  it('채널을 web-push 구독 형태로 변환해 페이로드 JSON과 함께 발송한다', async () => {
    stubVapidEnv();
    sendNotification.mockResolvedValue({
      statusCode: 201,
      body: '',
      headers: {},
    });

    const result = await sendWebPush(CHANNEL, PAYLOAD);

    expect(result).toEqual({ ok: true });
    expect(sendNotification).toHaveBeenCalledWith(
      {
        endpoint: CHANNEL.endpoint,
        keys: { p256dh: CHANNEL.p256dh, auth: CHANNEL.auth },
      },
      JSON.stringify(PAYLOAD),
      {
        vapidDetails: {
          subject: 'mailto:test@example.com',
          publicKey: 'public-key',
          privateKey: 'private-key',
        },
      },
    );
  });

  it('statusCode를 가진 실패(WebPushError)는 코드를 보존해 반환한다', async () => {
    stubVapidEnv();
    sendNotification.mockRejectedValue(
      Object.assign(new Error('Gone'), { statusCode: 410 }),
    );

    const result = await sendWebPush(CHANNEL, PAYLOAD);

    expect(result).toEqual({ ok: false, statusCode: 410, message: 'Gone' });
  });

  it('statusCode가 없는 실패(네트워크 등)는 statusCode null로 반환한다', async () => {
    stubVapidEnv();
    sendNotification.mockRejectedValue(new Error('fetch failed'));

    const result = await sendWebPush(CHANNEL, PAYLOAD);

    expect(result).toEqual({
      ok: false,
      statusCode: null,
      message: 'fetch failed',
    });
  });

  it('VAPID env 미설정이면 throw한다 (배포 설정 오류 표면화)', async () => {
    await expect(sendWebPush(CHANNEL, PAYLOAD)).rejects.toThrow(/VAPID env/);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
