import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { PushSubscriptionJson } from '@/types/push';

import {
  subscriptionToRow,
  upsertPushSubscription,
} from './pushSubscriptionsRepository';

const USER_ID = 'b7e6a4c2-0000-4000-8000-000000000001';

function buildSubscription(
  overrides: Partial<PushSubscriptionJson> = {},
): PushSubscriptionJson {
  return {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
    keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
    ...overrides,
  };
}

/**
 * Supabase 메서드 체이닝(`from().upsert()`)을 위한 mock 헬퍼.
 * - upsert는 `await` 대상이므로 Promise를 반환.
 */
function createMockClient(result: { error: { message: string } | null }) {
  const upsert = vi.fn().mockResolvedValue(result);
  const from = vi.fn().mockReturnValue({ upsert });
  const client = { from } as unknown as SupabaseClient;
  return { client, from, upsert };
}

describe('subscriptionToRow', () => {
  it('userId + PushSubscription JSON을 snake_case row로 매핑한다', () => {
    const row = subscriptionToRow(USER_ID, buildSubscription(), 'Mozilla/5.0');

    expect(row).toEqual({
      user_id: USER_ID,
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      p256dh: 'p256dh-key',
      auth: 'auth-secret',
      user_agent: 'Mozilla/5.0',
    });
  });

  it('userAgent가 없으면 null을 그대로 전달한다', () => {
    const row = subscriptionToRow(USER_ID, buildSubscription(), null);

    expect(row.user_agent).toBeNull();
  });
});

describe('upsertPushSubscription', () => {
  it('push_subscriptions 테이블에 (user_id, endpoint) 기준 UPSERT를 호출한다', async () => {
    const { client, from, upsert } = createMockClient({ error: null });
    const row = subscriptionToRow(USER_ID, buildSubscription(), null);

    await upsertPushSubscription(client, row);

    expect(from).toHaveBeenCalledWith('push_subscriptions');
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(row, {
      onConflict: 'user_id,endpoint',
    });
  });

  it('Supabase가 에러를 반환하면 throw로 표면화한다', async () => {
    const { client } = createMockClient({
      error: { message: 'connection refused' },
    });
    const row = subscriptionToRow(USER_ID, buildSubscription(), null);

    await expect(upsertPushSubscription(client, row)).rejects.toThrow(
      /Failed to upsert push subscription: connection refused/,
    );
  });
});
