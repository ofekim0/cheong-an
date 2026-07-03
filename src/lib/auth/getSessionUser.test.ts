import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/serverClient', () => ({
  getSupabaseServerClient: vi.fn(),
}));

import { getSupabaseServerClient } from '@/lib/supabase/serverClient';

import { getSessionUser } from './getSessionUser';

type GetClaimsResult = {
  data: { claims: Record<string, unknown> } | null;
  error: unknown;
};

function mockServerClient(result: GetClaimsResult): void {
  const client = {
    auth: { getClaims: vi.fn().mockResolvedValue(result) },
  };
  vi.mocked(getSupabaseServerClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof getSupabaseServerClient>>,
  );
}

describe('getSessionUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('유효한 클레임이면 userId·email을 도출한다', async () => {
    mockServerClient({
      data: { claims: { sub: 'user-123', email: 'a@b.com' } },
      error: null,
    });

    expect(await getSessionUser()).toEqual({
      userId: 'user-123',
      email: 'a@b.com',
    });
  });

  it('email 클레임이 없으면 email은 null', async () => {
    mockServerClient({ data: { claims: { sub: 'user-123' } }, error: null });

    expect(await getSessionUser()).toEqual({ userId: 'user-123', email: null });
  });

  it('error가 있으면 null', async () => {
    mockServerClient({ data: null, error: new Error('invalid') });

    expect(await getSessionUser()).toBeNull();
  });

  it('claims 또는 sub가 없으면 null(비로그인)', async () => {
    mockServerClient({ data: null, error: null });
    expect(await getSessionUser()).toBeNull();

    mockServerClient({ data: { claims: {} }, error: null });
    expect(await getSessionUser()).toBeNull();
  });
});
