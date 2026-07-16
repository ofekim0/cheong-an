import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import {
  deleteChannelsByEndpoint,
  getEnabledChannels,
  rowToChannel,
} from './pushChannelsRepository';

const USER_A = 'b7e6a4c2-0000-4000-8000-000000000001';
const USER_B = 'b7e6a4c2-0000-4000-8000-000000000002';

const CHANNEL_ROW_A = {
  user_id: USER_A,
  endpoint: 'https://fcm.googleapis.com/fcm/send/aaa',
  p256dh: 'p256dh-a',
  auth: 'auth-a',
};

const CHANNEL_ROW_B = {
  user_id: USER_B,
  endpoint: 'https://fcm.googleapis.com/fcm/send/bbb',
  p256dh: 'p256dh-b',
  auth: 'auth-b',
};

/**
 * Supabase 메서드 체이닝 mock 헬퍼.
 * - push_preferences: `from().select().eq()` — 종단 eq가 Promise.
 * - push_subscriptions 조회: `from().select().in()` — 종단 in이 Promise.
 * - push_subscriptions 삭제: `from().delete().eq()` — 종단 eq가 Promise.
 * 테이블명으로 분기해 각 테이블에 다른 결과를 돌려준다.
 */
function createMockClient(results: {
  preferences?: { data: unknown; error: { message: string } | null };
  channels?: { data: unknown; error: { message: string } | null };
  deletion?: { error: { message: string } | null };
}) {
  const prefEq = vi
    .fn()
    .mockResolvedValue(results.preferences ?? { data: [], error: null });
  const prefSelect = vi.fn().mockReturnValue({ eq: prefEq });

  const channelIn = vi
    .fn()
    .mockResolvedValue(results.channels ?? { data: [], error: null });
  const channelSelect = vi.fn().mockReturnValue({ in: channelIn });

  const deleteEq = vi
    .fn()
    .mockResolvedValue(results.deletion ?? { error: null });
  const deleteFn = vi.fn().mockReturnValue({ eq: deleteEq });

  const from = vi.fn((table: string) =>
    table === 'push_preferences'
      ? { select: prefSelect }
      : { select: channelSelect, delete: deleteFn },
  );

  const client = { from } as unknown as SupabaseClient;
  return {
    client,
    from,
    prefSelect,
    prefEq,
    channelSelect,
    channelIn,
    deleteEq,
  };
}

describe('rowToChannel', () => {
  it('snake_case row를 camelCase 도메인 채널로 매핑한다', () => {
    expect(rowToChannel(CHANNEL_ROW_A)).toEqual({
      userId: USER_A,
      endpoint: 'https://fcm.googleapis.com/fcm/send/aaa',
      p256dh: 'p256dh-a',
      auth: 'auth-a',
    });
  });
});

describe('getEnabledChannels', () => {
  it('enabled 계정의 채널을 전부 조회해 도메인 타입으로 반환한다', async () => {
    const { client, prefEq, channelIn } = createMockClient({
      preferences: {
        data: [{ user_id: USER_A }, { user_id: USER_B }],
        error: null,
      },
      channels: { data: [CHANNEL_ROW_A, CHANNEL_ROW_B], error: null },
    });

    const channels = await getEnabledChannels(client);

    expect(prefEq).toHaveBeenCalledWith('enabled', true);
    expect(channelIn).toHaveBeenCalledWith('user_id', [USER_A, USER_B]);
    expect(channels).toEqual([
      rowToChannel(CHANNEL_ROW_A),
      rowToChannel(CHANNEL_ROW_B),
    ]);
  });

  it('enabled 계정이 없으면 채널 조회 없이 빈 배열을 반환한다', async () => {
    const { client, channelSelect } = createMockClient({
      preferences: { data: [], error: null },
    });

    const channels = await getEnabledChannels(client);

    expect(channels).toEqual([]);
    expect(channelSelect).not.toHaveBeenCalled();
  });

  it('enabled 계정은 있으나 등록된 채널이 없으면 빈 배열을 반환한다', async () => {
    const { client } = createMockClient({
      preferences: { data: [{ user_id: USER_A }], error: null },
      channels: { data: [], error: null },
    });

    const channels = await getEnabledChannels(client);

    expect(channels).toEqual([]);
  });

  it('push_preferences 조회 에러를 throw로 표면화한다', async () => {
    const { client } = createMockClient({
      preferences: { data: null, error: { message: 'connection refused' } },
    });

    await expect(getEnabledChannels(client)).rejects.toThrow(
      /Failed to get enabled preferences: connection refused/,
    );
  });

  it('push_subscriptions 조회 에러를 throw로 표면화한다', async () => {
    const { client } = createMockClient({
      preferences: { data: [{ user_id: USER_A }], error: null },
      channels: { data: null, error: { message: 'connection refused' } },
    });

    await expect(getEnabledChannels(client)).rejects.toThrow(
      /Failed to get delivery channels: connection refused/,
    );
  });
});

describe('deleteChannelsByEndpoint', () => {
  it('endpoint 기준으로 push_subscriptions row를 삭제한다', async () => {
    const { client, from, deleteEq } = createMockClient({});

    await deleteChannelsByEndpoint(client, CHANNEL_ROW_A.endpoint);

    expect(from).toHaveBeenCalledWith('push_subscriptions');
    expect(deleteEq).toHaveBeenCalledWith('endpoint', CHANNEL_ROW_A.endpoint);
  });

  it('Supabase가 에러를 반환하면 throw로 표면화한다', async () => {
    const { client } = createMockClient({
      deletion: { error: { message: 'connection refused' } },
    });

    await expect(
      deleteChannelsByEndpoint(client, CHANNEL_ROW_A.endpoint),
    ).rejects.toThrow(/Failed to delete push channels: connection refused/);
  });
});
