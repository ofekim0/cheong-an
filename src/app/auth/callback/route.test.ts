import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/serverClient', () => ({
  getSupabaseServerClient: vi.fn(),
}));

import { getSupabaseServerClient } from '@/lib/supabase/serverClient';

import { GET } from './route';

type MockClient = {
  auth: { exchangeCodeForSession: ReturnType<typeof vi.fn> };
};

function mockServerClient(exchangeResult: { error: unknown }): MockClient {
  const client: MockClient = {
    auth: { exchangeCodeForSession: vi.fn().mockResolvedValue(exchangeResult) },
  };
  vi.mocked(getSupabaseServerClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof getSupabaseServerClient>>,
  );
  return client;
}

function callbackRequest(query: string): Request {
  return new Request(`http://localhost/auth/callback${query}`);
}

function locationOf(response: Response): string {
  const location = response.headers.get('location');
  if (!location) throw new Error('redirect response has no location header');
  return location;
}

describe('GET /auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('code 누락 시 교환 없이 홈으로 리다이렉트(auth_error)', async () => {
    const response = await GET(callbackRequest(''));

    expect(locationOf(response)).toBe(
      'http://localhost/?auth_error=missing_code',
    );
    expect(getSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('code 교환 성공 시 next(기본 홈)로 리다이렉트', async () => {
    const client = mockServerClient({ error: null });

    const response = await GET(callbackRequest('?code=abc'));

    expect(client.auth.exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(locationOf(response)).toBe('http://localhost/');
  });

  it('code 교환 성공 + next 지정 시 해당 경로로 리다이렉트', async () => {
    mockServerClient({ error: null });

    const response = await GET(callbackRequest('?code=abc&next=/subscribe'));

    expect(locationOf(response)).toBe('http://localhost/subscribe');
  });

  it('외부 경로(//evil.com)는 open redirect 방지로 홈으로', async () => {
    mockServerClient({ error: null });

    const response = await GET(callbackRequest('?code=abc&next=//evil.com'));

    expect(locationOf(response)).toBe('http://localhost/');
  });

  it('code 교환 실패 시 홈으로 리다이렉트(auth_error)', async () => {
    mockServerClient({ error: new Error('invalid code') });

    const response = await GET(callbackRequest('?code=bad'));

    expect(locationOf(response)).toBe(
      'http://localhost/?auth_error=exchange_failed',
    );
  });
});
