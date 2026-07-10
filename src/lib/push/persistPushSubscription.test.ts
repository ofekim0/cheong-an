import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  disablePushSubscription,
  persistPushSubscription,
} from './persistPushSubscription';

const SUBSCRIPTION_JSON = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  expirationTime: null,
  keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
};

function buildSubscription(): PushSubscription {
  return {
    toJSON: () => SUBSCRIPTION_JSON,
  } as unknown as PushSubscription;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('persistPushSubscription', () => {
  it('toJSON() 결과를 POST /api/push/subscribe로 전송한다', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }));

    await persistPushSubscription(buildSubscription());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/push/subscribe');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(SUBSCRIPTION_JSON);
  });

  it('실패 응답이면 상태 코드와 서버 error 메시지를 포함해 throw한다', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    );

    await expect(persistPushSubscription(buildSubscription())).rejects.toThrow(
      /구독 저장 실패 \(401\): Unauthorized/,
    );
  });

  it('실패 응답 body가 JSON이 아니어도 상태 코드로 throw한다', async () => {
    fetchMock.mockResolvedValue(new Response('oops', { status: 500 }));

    await expect(persistPushSubscription(buildSubscription())).rejects.toThrow(
      /구독 저장 실패 \(500\)/,
    );
  });
});

describe('disablePushSubscription', () => {
  it('DELETE /api/push/subscribe를 호출한다', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await disablePushSubscription();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/push/subscribe');
    expect(init.method).toBe('DELETE');
  });

  it('실패 응답이면 상태 코드와 서버 error 메시지를 포함해 throw한다', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    );

    await expect(disablePushSubscription()).rejects.toThrow(
      /구독 해제 실패 \(401\): Unauthorized/,
    );
  });
});
