import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  disableEmailNotification,
  enableEmailNotification,
} from './emailPreferenceClient';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('enableEmailNotification', () => {
  it('POST /api/notifications/email를 호출한다', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }));

    await enableEmailNotification();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/notifications/email');
    expect(init.method).toBe('POST');
  });

  it('실패 응답이면 상태 코드와 서버 error 메시지를 포함해 throw한다', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    );

    await expect(enableEmailNotification()).rejects.toThrow(
      /이메일 알림 설정 실패 \(401\): Unauthorized/,
    );
  });

  it('실패 응답 body가 JSON이 아니어도 상태 코드로 throw한다', async () => {
    fetchMock.mockResolvedValue(new Response('oops', { status: 500 }));

    await expect(enableEmailNotification()).rejects.toThrow(
      /이메일 알림 설정 실패 \(500\)/,
    );
  });
});

describe('disableEmailNotification', () => {
  it('DELETE /api/notifications/email를 호출한다', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await disableEmailNotification();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/notifications/email');
    expect(init.method).toBe('DELETE');
  });

  it('실패 응답이면 상태 코드와 서버 error 메시지를 포함해 throw한다', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: 'Unauthorized' }, { status: 401 }),
    );

    await expect(disableEmailNotification()).rejects.toThrow(
      /이메일 알림 해제 실패 \(401\): Unauthorized/,
    );
  });
});
