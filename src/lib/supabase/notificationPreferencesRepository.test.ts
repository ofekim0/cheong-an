import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import {
  getChannelPreference,
  setChannelPreference,
} from './notificationPreferencesRepository';

const USER_ID = 'b7e6a4c2-0000-4000-8000-000000000001';

/**
 * Supabase 메서드 체이닝 mock 헬퍼.
 * - setChannelPreference: `from().upsert()` — Promise 반환.
 * - getChannelPreference: `from().select().eq().maybeSingle()` — 종단만 Promise.
 */
function createMockClient(result: {
  data?: Record<string, unknown> | null;
  error: { message: string } | null;
}) {
  const upsert = vi.fn().mockResolvedValue(result);
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ upsert, select });
  const client = { from } as unknown as SupabaseClient;
  return { client, from, upsert, select, eq };
}

describe('setChannelPreference', () => {
  it('web_push는 notification_preferences에 web_push_enabled만 UPSERT한다', async () => {
    const { client, from, upsert } = createMockClient({ error: null });

    await setChannelPreference(client, USER_ID, 'web_push', true);

    expect(from).toHaveBeenCalledWith('notification_preferences');
    expect(upsert).toHaveBeenCalledWith(
      { user_id: USER_ID, web_push_enabled: true },
      { onConflict: 'user_id' },
    );
  });

  it('email은 email_enabled만 UPSERT한다 — 다른 채널 컬럼은 페이로드에 없다', async () => {
    const { client, upsert } = createMockClient({ error: null });

    await setChannelPreference(client, USER_ID, 'email', true);

    expect(upsert).toHaveBeenCalledWith(
      { user_id: USER_ID, email_enabled: true },
      { onConflict: 'user_id' },
    );
  });

  it('enabled = false(해제)도 같은 UPSERT 경로를 쓴다', async () => {
    const { client, upsert } = createMockClient({ error: null });

    await setChannelPreference(client, USER_ID, 'email', false);

    expect(upsert).toHaveBeenCalledWith(
      { user_id: USER_ID, email_enabled: false },
      { onConflict: 'user_id' },
    );
  });

  it('Supabase가 에러를 반환하면 채널명을 포함해 throw한다', async () => {
    const { client } = createMockClient({
      error: { message: 'connection refused' },
    });

    await expect(
      setChannelPreference(client, USER_ID, 'email', true),
    ).rejects.toThrow(/Failed to set email preference: connection refused/);
  });
});

describe('getChannelPreference', () => {
  it('해당 채널 컬럼을 select해 그 값을 반환한다', async () => {
    const { client, select, eq } = createMockClient({
      data: { web_push_enabled: true },
      error: null,
    });

    const enabled = await getChannelPreference(client, USER_ID, 'web_push');

    expect(enabled).toBe(true);
    expect(select).toHaveBeenCalledWith('web_push_enabled');
    expect(eq).toHaveBeenCalledWith('user_id', USER_ID);
  });

  it('row가 없으면(설정한 적 없음) false를 반환한다', async () => {
    const { client } = createMockClient({ data: null, error: null });

    const enabled = await getChannelPreference(client, USER_ID, 'email');

    expect(enabled).toBe(false);
  });

  it('해당 채널만 꺼져 있으면 false를 반환한다', async () => {
    const { client } = createMockClient({
      data: { email_enabled: false },
      error: null,
    });

    const enabled = await getChannelPreference(client, USER_ID, 'email');

    expect(enabled).toBe(false);
  });

  it('Supabase가 에러를 반환하면 채널명을 포함해 throw한다', async () => {
    const { client } = createMockClient({
      data: null,
      error: { message: 'connection refused' },
    });

    await expect(
      getChannelPreference(client, USER_ID, 'web_push'),
    ).rejects.toThrow(/Failed to get web_push preference: connection refused/);
  });
});
