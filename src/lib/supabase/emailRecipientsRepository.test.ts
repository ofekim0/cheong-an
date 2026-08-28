import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getEmailRecipients } from './emailRecipientsRepository';

const USER_A = 'b7e6a4c2-0000-4000-8000-000000000001';
const USER_B = 'b7e6a4c2-0000-4000-8000-000000000002';

/**
 * Supabase 메서드 체이닝 mock 헬퍼.
 * - notification_preferences: `from().select().eq()` — 종단 eq가 Promise.
 * - auth.admin.getUserById: userId → 결과 맵으로 응답.
 */
function createMockClient(results: {
  preferences?: { data: unknown; error: { message: string } | null };
  users?: Record<
    string,
    | { data: { user: { email?: string } | null }; error: null }
    | { data: { user: null }; error: { message: string } }
  >;
}) {
  const prefEq = vi
    .fn()
    .mockResolvedValue(results.preferences ?? { data: [], error: null });
  const prefSelect = vi.fn().mockReturnValue({ eq: prefEq });
  const from = vi.fn().mockReturnValue({ select: prefSelect });

  const getUserById = vi.fn(async (userId: string) => {
    return (
      results.users?.[userId] ?? {
        data: { user: null },
        error: { message: 'User not found' },
      }
    );
  });

  const client = {
    from,
    auth: { admin: { getUserById } },
  } as unknown as SupabaseClient;
  return { client, from, prefSelect, prefEq, getUserById };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getEmailRecipients', () => {
  it('email_enabled 계정의 user_id로 주소를 조회해 수신자를 만든다', async () => {
    const { client, from, prefSelect, prefEq, getUserById } = createMockClient({
      preferences: {
        data: [{ user_id: USER_A }, { user_id: USER_B }],
        error: null,
      },
      users: {
        [USER_A]: {
          data: { user: { email: 'a@example.com' } },
          error: null,
        },
        [USER_B]: {
          data: { user: { email: 'b@example.com' } },
          error: null,
        },
      },
    });

    const recipients = await getEmailRecipients(client);

    expect(recipients).toEqual([
      { userId: USER_A, email: 'a@example.com' },
      { userId: USER_B, email: 'b@example.com' },
    ]);
    expect(from).toHaveBeenCalledWith('notification_preferences');
    expect(prefSelect).toHaveBeenCalledWith('user_id');
    expect(prefEq).toHaveBeenCalledWith('email_enabled', true);
    expect(getUserById).toHaveBeenCalledTimes(2);
  });

  it('email_enabled 계정이 없으면 사용자 조회 없이 빈 배열', async () => {
    const { client, getUserById } = createMockClient({
      preferences: { data: [], error: null },
    });

    const recipients = await getEmailRecipients(client);

    expect(recipients).toEqual([]);
    expect(getUserById).not.toHaveBeenCalled();
  });

  it('주소가 없는 계정은 스킵한다 (opt-in 후 주소가 사라진 엣지)', async () => {
    const { client } = createMockClient({
      preferences: {
        data: [{ user_id: USER_A }, { user_id: USER_B }],
        error: null,
      },
      users: {
        [USER_A]: { data: { user: {} }, error: null },
        [USER_B]: {
          data: { user: { email: 'b@example.com' } },
          error: null,
        },
      },
    });

    const recipients = await getEmailRecipients(client);

    expect(recipients).toEqual([{ userId: USER_B, email: 'b@example.com' }]);
  });

  it('개별 사용자 조회 실패는 그 계정만 스킵하고 로그를 남긴다 (계정별 격리)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client } = createMockClient({
      preferences: {
        data: [{ user_id: USER_A }, { user_id: USER_B }],
        error: null,
      },
      users: {
        [USER_A]: { data: { user: null }, error: { message: 'boom' } },
        [USER_B]: {
          data: { user: { email: 'b@example.com' } },
          error: null,
        },
      },
    });

    const recipients = await getEmailRecipients(client);

    expect(recipients).toEqual([{ userId: USER_B, email: 'b@example.com' }]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(USER_A));
  });

  it('preferences 조회 실패는 throw로 표면화한다 (전 수신자 공통 실패)', async () => {
    const { client } = createMockClient({
      preferences: { data: null, error: { message: 'permission denied' } },
    });

    await expect(getEmailRecipients(client)).rejects.toThrow(
      /Failed to get email-enabled preferences: permission denied/,
    );
  });
});
