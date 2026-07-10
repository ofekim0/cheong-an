import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import {
  getPushPreference,
  setPushPreference,
} from './pushPreferencesRepository';

const USER_ID = 'b7e6a4c2-0000-4000-8000-000000000001';

/**
 * Supabase 메서드 체이닝 mock 헬퍼.
 * - setPushPreference: `from().upsert()` — Promise 반환.
 * - getPushPreference: `from().select().eq().maybeSingle()` — 종단만 Promise.
 */
function createMockClient(result: {
  data?: { enabled: boolean } | null;
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

describe('setPushPreference', () => {
  it('push_preferences 테이블에 user_id 기준 UPSERT를 호출한다', async () => {
    const { client, from, upsert } = createMockClient({ error: null });

    await setPushPreference(client, USER_ID, true);

    expect(from).toHaveBeenCalledWith('push_preferences');
    expect(upsert).toHaveBeenCalledWith(
      { user_id: USER_ID, enabled: true },
      { onConflict: 'user_id' },
    );
  });

  it('enabled = false(구독 해제)도 같은 UPSERT 경로를 쓴다', async () => {
    const { client, upsert } = createMockClient({ error: null });

    await setPushPreference(client, USER_ID, false);

    expect(upsert).toHaveBeenCalledWith(
      { user_id: USER_ID, enabled: false },
      { onConflict: 'user_id' },
    );
  });

  it('Supabase가 에러를 반환하면 throw로 표면화한다', async () => {
    const { client } = createMockClient({
      error: { message: 'connection refused' },
    });

    await expect(setPushPreference(client, USER_ID, true)).rejects.toThrow(
      /Failed to set push preference: connection refused/,
    );
  });
});

describe('getPushPreference', () => {
  it('본인 row의 enabled 값을 반환한다', async () => {
    const { client, eq } = createMockClient({
      data: { enabled: true },
      error: null,
    });

    const enabled = await getPushPreference(client, USER_ID);

    expect(enabled).toBe(true);
    expect(eq).toHaveBeenCalledWith('user_id', USER_ID);
  });

  it('row가 없으면(구독한 적 없음) false를 반환한다', async () => {
    const { client } = createMockClient({ data: null, error: null });

    const enabled = await getPushPreference(client, USER_ID);

    expect(enabled).toBe(false);
  });

  it('Supabase가 에러를 반환하면 throw로 표면화한다', async () => {
    const { client } = createMockClient({
      data: null,
      error: { message: 'connection refused' },
    });

    await expect(getPushPreference(client, USER_ID)).rejects.toThrow(
      /Failed to get push preference: connection refused/,
    );
  });
});
