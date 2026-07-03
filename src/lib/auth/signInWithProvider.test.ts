import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/browserClient', () => ({
  getSupabaseBrowserClient: vi.fn(),
}));

import { getSupabaseBrowserClient } from '@/lib/supabase/browserClient';

import { signInWithProvider } from './signInWithProvider';

function mockBrowserClient(result: { error: unknown } = { error: null }) {
  const signInWithOAuth = vi.fn().mockResolvedValue(result);
  vi.mocked(getSupabaseBrowserClient).mockReturnValue({
    auth: { signInWithOAuth },
  } as unknown as ReturnType<typeof getSupabaseBrowserClient>);
  return signInWithOAuth;
}

describe('signInWithProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('provider와 next를 담은 콜백 redirectTo로 signInWithOAuth 호출', async () => {
    const signInWithOAuth = mockBrowserClient();

    await signInWithProvider('google', '/subscribe');

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=%2Fsubscribe`,
      },
    });
  });

  it('next 미지정 시 기본 홈(/)으로 복귀하도록 인코딩', async () => {
    const signInWithOAuth = mockBrowserClient();

    await signInWithProvider('kakao');

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'kakao',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=%2F`,
      },
    });
  });

  it('signInWithOAuth 오류를 그대로 전달', async () => {
    const error = new Error('oauth failed');
    mockBrowserClient({ error });

    expect(await signInWithProvider('google')).toEqual({ error });
  });
});
