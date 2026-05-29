import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { getLastBoardId, updateLastBoardId } from './crawlStateRepository';

/**
 * getLastBoardId용 mock: from().select().order().limit().single() 체인.
 */
function createReadMock(result: {
  data: { last_board_id: number } | null;
  error: { message: string } | null;
}) {
  const single = vi.fn().mockResolvedValue(result);
  const limit = vi.fn().mockReturnValue({ single });
  const order = vi.fn().mockReturnValue({ limit });
  const select = vi.fn().mockReturnValue({ order });
  const from = vi.fn().mockReturnValue({ select });
  const client = { from } as unknown as SupabaseClient;
  return { client, from, select, order, limit, single };
}

/**
 * updateLastBoardId용 mock: from().update().gte() 체인.
 * - update는 chainable, gte가 await 대상이므로 Promise를 반환.
 */
function createUpdateMock(result: { error: { message: string } | null }) {
  const gte = vi.fn().mockResolvedValue(result);
  const update = vi.fn().mockReturnValue({ gte });
  const from = vi.fn().mockReturnValue({ update });
  const client = { from } as unknown as SupabaseClient;
  return { client, from, update, gte };
}

describe('getLastBoardId', () => {
  it('crawl_state 첫 행의 last_board_id를 반환한다', async () => {
    const { client, from, select, order, limit } = createReadMock({
      data: { last_board_id: 1234 },
      error: null,
    });

    const result = await getLastBoardId(client);

    expect(result).toBe(1234);
    expect(from).toHaveBeenCalledWith('crawl_state');
    expect(select).toHaveBeenCalledWith('last_board_id');
    expect(order).toHaveBeenCalledWith('id', { ascending: true });
    expect(limit).toHaveBeenCalledWith(1);
  });

  it('Supabase 에러 시 throw', async () => {
    const { client } = createReadMock({
      data: null,
      error: { message: 'row not found' },
    });

    await expect(getLastBoardId(client)).rejects.toThrow(
      /Failed to read crawl_state: row not found/,
    );
  });
});

describe('updateLastBoardId', () => {
  it('last_board_id와 last_crawled_at(ISO)을 갱신하고 gte(id, 0) 필터를 건다', async () => {
    const { client, from, update, gte } = createUpdateMock({ error: null });
    const before = Date.now();

    await updateLastBoardId(client, 5678);

    const after = Date.now();
    expect(from).toHaveBeenCalledWith('crawl_state');
    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][0];
    expect(payload.last_board_id).toBe(5678);
    expect(typeof payload.last_crawled_at).toBe('string');
    const ts = Date.parse(payload.last_crawled_at);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
    expect(gte).toHaveBeenCalledWith('id', 0);
  });

  it('Supabase 에러 시 throw + 메시지에 boardId 포함', async () => {
    const { client } = createUpdateMock({
      error: { message: 'permission denied' },
    });

    await expect(updateLastBoardId(client, 9999)).rejects.toThrow(
      /Failed to update crawl_state\.last_board_id=9999: permission denied/,
    );
  });
});
