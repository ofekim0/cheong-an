import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/getSessionUser', () => ({
  getSessionUser: vi.fn(),
}));
vi.mock('@/lib/supabase/serverClient', () => ({
  getSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/supabase/notificationPreferencesRepository', () => ({
  setChannelPreference: vi.fn(),
}));

import { getSessionUser } from '@/lib/auth/getSessionUser';
import { setChannelPreference } from '@/lib/supabase/notificationPreferencesRepository';
import { getSupabaseServerClient } from '@/lib/supabase/serverClient';

import { DELETE, POST } from './route';

const USER_ID = 'b7e6a4c2-0000-4000-8000-000000000001';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionUser).mockResolvedValue({
    userId: USER_ID,
    email: 'user@example.com',
  });
  vi.mocked(getSupabaseServerClient).mockResolvedValue(
    {} as Awaited<ReturnType<typeof getSupabaseServerClient>>,
  );
  vi.mocked(setChannelPreference).mockResolvedValue(undefined);
});

describe('POST /api/notifications/email', () => {
  it('비로그인이면 401을 반환하고 저장하지 않는다', async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(401);
    expect(setChannelPreference).not.toHaveBeenCalled();
  });

  it('이메일 주소가 없는 계정이면 400 — 역량 게이팅', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      userId: USER_ID,
      email: null,
    });

    const response = await POST();

    expect(response.status).toBe(400);
    expect(setChannelPreference).not.toHaveBeenCalled();
  });

  it('이메일 있는 계정이면 email_enabled=true 설정 후 201', async () => {
    const response = await POST();

    expect(response.status).toBe(201);
    expect(setChannelPreference).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      'email',
      true,
    );
  });

  it('DB 예외면 500', async () => {
    vi.mocked(setChannelPreference).mockRejectedValue(
      new Error('connection refused'),
    );

    const response = await POST();

    expect(response.status).toBe(500);
  });
});

describe('DELETE /api/notifications/email', () => {
  it('비로그인이면 401을 반환하고 아무것도 바꾸지 않는다', async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);

    const response = await DELETE();

    expect(response.status).toBe(401);
    expect(setChannelPreference).not.toHaveBeenCalled();
  });

  it('이메일 주소 유무와 무관하게 email_enabled=false 설정 후 200', async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      userId: USER_ID,
      email: null,
    });

    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(setChannelPreference).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      'email',
      false,
    );
  });

  it('DB 예외면 500', async () => {
    vi.mocked(setChannelPreference).mockRejectedValue(
      new Error('connection refused'),
    );

    const response = await DELETE();

    expect(response.status).toBe(500);
  });
});
