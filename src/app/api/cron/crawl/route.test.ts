import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnnouncementDetail } from '@/types/announcement';

vi.mock('@/lib/crawler/announcementService', () => ({
  crawlNewAnnouncements: vi.fn(),
}));
vi.mock('@/lib/crawler/canary', () => ({
  runCanary: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({
  getSupabaseAdminClient: vi.fn(),
}));
vi.mock('@/lib/supabase/announcementsRepository', () => ({
  upsertAnnouncements: vi.fn(),
}));
vi.mock('@/lib/supabase/crawlStateRepository', () => ({
  getLastBoardId: vi.fn(),
  updateLastBoardId: vi.fn(),
}));

import { crawlNewAnnouncements } from '@/lib/crawler/announcementService';
import { runCanary } from '@/lib/crawler/canary';
import { upsertAnnouncements } from '@/lib/supabase/announcementsRepository';
import { getSupabaseAdminClient } from '@/lib/supabase/client';
import {
  getLastBoardId,
  updateLastBoardId,
} from '@/lib/supabase/crawlStateRepository';

import { GET } from './route';

function buildDetail(boardId: number): AnnouncementDetail {
  return {
    boardId,
    title: `공고 ${boardId}`,
    announcementType: 'public',
    recruitmentType: 'initial',
    complexName: null,
    district: null,
    address: null,
    totalUnits: null,
    postDate: '2026-05-01',
    applicationStartDate: null,
    applicationEndDate: null,
    resultDate: null,
    attachmentUrl: null,
    attachmentName: null,
    rawContent: '',
  };
}

function makeRequest(authHeader?: string): Request {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) headers.authorization = authHeader;
  return new Request('http://localhost/api/cron/crawl', {
    method: 'GET',
    headers,
  });
}

const ORIGINAL_SECRET = process.env.CRON_SECRET;

describe('GET /api/cron/crawl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-secret';
    // 기본: 카나리 통과(위반 0건). 위반 케이스는 개별 테스트에서 override.
    vi.mocked(runCanary).mockResolvedValue([]);
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = ORIGINAL_SECRET;
    }
  });

  it('CRON_SECRET 미설정 시 500', async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(makeRequest('Bearer anything'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'CRON_SECRET is not configured',
    });
    expect(crawlNewAnnouncements).not.toHaveBeenCalled();
  });

  it('Authorization 헤더 누락 시 401', async () => {
    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(crawlNewAnnouncements).not.toHaveBeenCalled();
  });

  it('Bearer 토큰 값 불일치 시 401', async () => {
    const response = await GET(makeRequest('Bearer wrong-secret'));

    expect(response.status).toBe(401);
    expect(crawlNewAnnouncements).not.toHaveBeenCalled();
  });

  it('카나리 위반 시 500, crawl·DB 접근 전에 멈춤', async () => {
    vi.mocked(runCanary).mockResolvedValue([
      { code: 'LIST_EMPTY', message: 'list parser returned 0 items' },
    ]);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET(makeRequest('Bearer test-secret'));

    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe('Canary verification failed');
    expect(getSupabaseAdminClient).not.toHaveBeenCalled();
    expect(crawlNewAnnouncements).not.toHaveBeenCalled();

    errSpy.mockRestore();
  });

  it('정상 흐름: 호출 순서 + 응답 페이로드', async () => {
    const client = {} as unknown as ReturnType<typeof getSupabaseAdminClient>;
    vi.mocked(getSupabaseAdminClient).mockReturnValue(client);
    vi.mocked(getLastBoardId).mockResolvedValue(100);
    vi.mocked(crawlNewAnnouncements).mockResolvedValue({
      newDetails: [buildDetail(101), buildDetail(103)],
      latestBoardId: 103,
      skippedBoardIds: [102],
    });
    vi.mocked(upsertAnnouncements).mockResolvedValue();
    vi.mocked(updateLastBoardId).mockResolvedValue();

    const response = await GET(makeRequest('Bearer test-secret'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      newCount: 2,
      skippedBoardIds: [102],
      latestBoardId: 103,
    });

    expect(getLastBoardId).toHaveBeenCalledWith(client);
    expect(crawlNewAnnouncements).toHaveBeenCalledWith({ lastBoardId: 100 });
    expect(upsertAnnouncements).toHaveBeenCalledWith(client, [
      buildDetail(101),
      buildDetail(103),
    ]);
    expect(updateLastBoardId).toHaveBeenCalledWith(client, 103);

    // getLast → crawl → upsert → updateLast 순서 보장
    const getLastOrder = vi.mocked(getLastBoardId).mock.invocationCallOrder[0];
    const crawlOrder = vi.mocked(crawlNewAnnouncements).mock
      .invocationCallOrder[0];
    const upsertOrder =
      vi.mocked(upsertAnnouncements).mock.invocationCallOrder[0];
    const updateOrder =
      vi.mocked(updateLastBoardId).mock.invocationCallOrder[0];
    expect(getLastOrder).toBeLessThan(crawlOrder);
    expect(crawlOrder).toBeLessThan(upsertOrder);
    expect(upsertOrder).toBeLessThan(updateOrder);
  });

  it('upsert 실패 시 500 + 메시지 노출, updateLastBoardId 호출 안 됨', async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(
      {} as unknown as ReturnType<typeof getSupabaseAdminClient>,
    );
    vi.mocked(getLastBoardId).mockResolvedValue(100);
    vi.mocked(crawlNewAnnouncements).mockResolvedValue({
      newDetails: [buildDetail(101)],
      latestBoardId: 101,
      skippedBoardIds: [],
    });
    vi.mocked(upsertAnnouncements).mockRejectedValue(new Error('db down'));

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET(makeRequest('Bearer test-secret'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Crawl failed',
      message: 'db down',
    });
    expect(updateLastBoardId).not.toHaveBeenCalled();

    errSpy.mockRestore();
  });
});
