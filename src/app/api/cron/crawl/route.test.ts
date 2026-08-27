import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnnouncementDetail } from '@/types/announcement';

vi.mock('@/lib/crawler/announcementService', () => ({
  crawlNewAnnouncements: vi.fn(),
}));
vi.mock('@/lib/crawler/canary', () => ({
  runCanary: vi.fn(),
}));
vi.mock('@/lib/notifications/notificationService', () => ({
  dispatchNotifications: vi.fn(),
}));
// 라우트가 기본 어댑터 인스턴스를 import하므로 모듈째 대체한다 —
// 실제 구현이면 web-push까지 로드되고, 여기선 전달 여부만 검증하면 된다.
vi.mock('@/lib/notifications/webPushAdapter', () => ({
  webPushAdapter: { channel: 'web_push', dispatch: vi.fn() },
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
import { dispatchNotifications } from '@/lib/notifications/notificationService';
import { webPushAdapter } from '@/lib/notifications/webPushAdapter';
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
    // 기본: 발송 no-op. 발송 케이스는 개별 테스트에서 override.
    vi.mocked(dispatchNotifications).mockResolvedValue({
      web_push: { sent: 0, expired: 0, failed: 0 },
    });
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
      invalidBoardIds: [],
    });
    vi.mocked(upsertAnnouncements).mockResolvedValue();
    vi.mocked(updateLastBoardId).mockResolvedValue();
    vi.mocked(dispatchNotifications).mockResolvedValue({
      web_push: { sent: 3, expired: 1, failed: 0 },
    });

    const response = await GET(makeRequest('Bearer test-secret'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      newCount: 2,
      skippedBoardIds: [102],
      invalidBoardIds: [],
      latestBoardId: 103,
      notifications: { web_push: { sent: 3, expired: 1, failed: 0 } },
    });

    expect(getLastBoardId).toHaveBeenCalledWith(client);
    expect(crawlNewAnnouncements).toHaveBeenCalledWith({ lastBoardId: 100 });
    expect(upsertAnnouncements).toHaveBeenCalledWith(client, [
      buildDetail(101),
      buildDetail(103),
    ]);
    expect(updateLastBoardId).toHaveBeenCalledWith(client, 103);
    expect(dispatchNotifications).toHaveBeenCalledWith({
      client,
      details: [buildDetail(101), buildDetail(103)],
      adapters: [webPushAdapter],
    });

    // getLast → crawl → upsert → updateLast → dispatch 순서 보장
    // (발송은 저장·lastBoardId 갱신 완료 후에만 — 중복 알림 방지)
    const getLastOrder = vi.mocked(getLastBoardId).mock.invocationCallOrder[0];
    const crawlOrder = vi.mocked(crawlNewAnnouncements).mock
      .invocationCallOrder[0];
    const upsertOrder =
      vi.mocked(upsertAnnouncements).mock.invocationCallOrder[0];
    const updateOrder =
      vi.mocked(updateLastBoardId).mock.invocationCallOrder[0];
    const dispatchOrder = vi.mocked(dispatchNotifications).mock
      .invocationCallOrder[0];
    expect(getLastOrder).toBeLessThan(crawlOrder);
    expect(crawlOrder).toBeLessThan(upsertOrder);
    expect(upsertOrder).toBeLessThan(updateOrder);
    expect(updateOrder).toBeLessThan(dispatchOrder);
  });

  it('채널 발송 실패 시에도 200 유지, notifications.<channel>.error로 표면화', async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(
      {} as unknown as ReturnType<typeof getSupabaseAdminClient>,
    );
    vi.mocked(getLastBoardId).mockResolvedValue(100);
    vi.mocked(crawlNewAnnouncements).mockResolvedValue({
      newDetails: [buildDetail(101)],
      latestBoardId: 101,
      skippedBoardIds: [],
      invalidBoardIds: [],
    });
    vi.mocked(upsertAnnouncements).mockResolvedValue();
    vi.mocked(updateLastBoardId).mockResolvedValue();
    // 채널 실패는 서비스가 격리해 { error }로 돌려준다(throw 없음) —
    // 라우트는 그 맵을 그대로 응답에 싣는다.
    vi.mocked(dispatchNotifications).mockResolvedValue({
      web_push: { error: 'VAPID env가 설정되지 않았습니다' },
    });

    const response = await GET(makeRequest('Bearer test-secret'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.newCount).toBe(1);
    expect(body.notifications).toEqual({
      web_push: { error: 'VAPID env가 설정되지 않았습니다' },
    });
    // 크롤 성공은 이미 확정 — 발송 실패가 저장·상태 갱신을 되돌리지 않는다.
    expect(updateLastBoardId).toHaveBeenCalled();
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
      invalidBoardIds: [],
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
    expect(dispatchNotifications).not.toHaveBeenCalled();

    errSpy.mockRestore();
  });
});
