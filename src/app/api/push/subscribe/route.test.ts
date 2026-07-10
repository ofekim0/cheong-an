import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/getSessionUser', () => ({
  getSessionUser: vi.fn(),
}));
vi.mock('@/lib/supabase/serverClient', () => ({
  getSupabaseServerClient: vi.fn(),
}));
vi.mock(
  '@/lib/supabase/pushSubscriptionsRepository',
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import('@/lib/supabase/pushSubscriptionsRepository')
      >();
    return {
      ...original,
      upsertPushSubscription: vi.fn(),
    };
  },
);
vi.mock('@/lib/supabase/pushPreferencesRepository', () => ({
  setPushPreference: vi.fn(),
}));

import { getSessionUser } from '@/lib/auth/getSessionUser';
import { setPushPreference } from '@/lib/supabase/pushPreferencesRepository';
import { upsertPushSubscription } from '@/lib/supabase/pushSubscriptionsRepository';
import { getSupabaseServerClient } from '@/lib/supabase/serverClient';

import { DELETE, POST } from './route';

const USER_ID = 'b7e6a4c2-0000-4000-8000-000000000001';

function buildBody(overrides: Record<string, unknown> = {}) {
  return {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
    ...overrides,
  };
}

function makeRequest(body: unknown, userAgent?: string): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (userAgent !== undefined) headers['user-agent'] = userAgent;
  return new Request('http://localhost/api/push/subscribe', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({
    userId: USER_ID,
    email: 'user@example.com',
  });
  vi.mocked(getSupabaseServerClient).mockResolvedValue(
    {} as Awaited<ReturnType<typeof getSupabaseServerClient>>,
  );
  vi.mocked(upsertPushSubscription).mockResolvedValue(undefined);
  vi.mocked(setPushPreference).mockResolvedValue(undefined);
});

describe('POST /api/push/subscribe', () => {
  it('비로그인이면 401을 반환하고 저장하지 않는다', async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);

    const response = await POST(makeRequest(buildBody()));

    expect(response.status).toBe(401);
    expect(upsertPushSubscription).not.toHaveBeenCalled();
    expect(setPushPreference).not.toHaveBeenCalled();
  });

  it('body가 JSON이 아니면 400', async () => {
    const response = await POST(makeRequest('not-json'));

    expect(response.status).toBe(400);
    expect(upsertPushSubscription).not.toHaveBeenCalled();
  });

  it.each([
    ['endpoint 누락', buildBody({ endpoint: undefined })],
    ['endpoint 빈 문자열', buildBody({ endpoint: '' })],
    ['keys 누락', buildBody({ keys: undefined })],
    ['p256dh 누락', buildBody({ keys: { auth: 'auth-secret' } })],
    ['auth 누락', buildBody({ keys: { p256dh: 'p256dh-key' } })],
  ])('필수 필드 검증 실패(%s)면 400', async (_label, body) => {
    const response = await POST(makeRequest(body));

    expect(response.status).toBe(400);
    expect(upsertPushSubscription).not.toHaveBeenCalled();
  });

  it('유효한 구독이면 L2 채널 UPSERT + L1 enabled=true 후 201', async () => {
    const response = await POST(makeRequest(buildBody(), 'Mozilla/5.0'));

    expect(response.status).toBe(201);
    expect(upsertPushSubscription).toHaveBeenCalledTimes(1);
    const [, row] = vi.mocked(upsertPushSubscription).mock.calls[0];
    expect(row).toEqual({
      user_id: USER_ID,
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      p256dh: 'p256dh-key',
      auth: 'auth-secret',
      user_agent: 'Mozilla/5.0',
    });
    expect(setPushPreference).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      true,
    );
  });

  it('user-agent 헤더가 없으면 null로 저장한다', async () => {
    await POST(makeRequest(buildBody()));

    const [, row] = vi.mocked(upsertPushSubscription).mock.calls[0];
    expect(row.user_agent).toBeNull();
  });

  it('채널 UPSERT가 실패하면 500, L1은 건드리지 않는다', async () => {
    vi.mocked(upsertPushSubscription).mockRejectedValue(
      new Error('connection refused'),
    );

    const response = await POST(makeRequest(buildBody()));

    expect(response.status).toBe(500);
    expect(setPushPreference).not.toHaveBeenCalled();
  });

  it('L1 설정이 실패해도 500', async () => {
    vi.mocked(setPushPreference).mockRejectedValue(
      new Error('connection refused'),
    );

    const response = await POST(makeRequest(buildBody()));

    expect(response.status).toBe(500);
  });
});

describe('DELETE /api/push/subscribe', () => {
  it('비로그인이면 401을 반환하고 아무것도 바꾸지 않는다', async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);

    const response = await DELETE();

    expect(response.status).toBe(401);
    expect(setPushPreference).not.toHaveBeenCalled();
  });

  it('L1 enabled=false만 설정하고 200 — L2 채널은 건드리지 않는다', async () => {
    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(setPushPreference).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      false,
    );
    expect(upsertPushSubscription).not.toHaveBeenCalled();
  });

  it('DB 예외면 500', async () => {
    vi.mocked(setPushPreference).mockRejectedValue(
      new Error('connection refused'),
    );

    const response = await DELETE();

    expect(response.status).toBe(500);
  });
});
