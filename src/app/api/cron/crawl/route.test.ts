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
// 실제 구현이면 web-push·resend까지 로드되고, 여기선 전달 여부만 검증하면 된다.
vi.mock('@/lib/notifications/webPushAdapter', () => ({
  webPushAdapter: { channel: 'web_push', dispatch: vi.fn() },
}));
vi.mock('@/lib/notifications/emailAdapter', () => ({
  emailAdapter: { channel: 'email', dispatch: vi.fn() },
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
// 목록 조회 캐시의 태그 무효화(#83 Step c-2, ADR 013). Next 런타임 밖에서 호출하면
// 실제 구현이 throw하므로 모킹하고, 여기서는 "언제 부르는가"만 검증한다.
vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}));

import { revalidateTag } from 'next/cache';

import { crawlNewAnnouncements } from '@/lib/crawler/announcementService';
import { runCanary } from '@/lib/crawler/canary';
import { emailAdapter } from '@/lib/notifications/emailAdapter';
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
      email: { sent: 0, expired: 0, failed: 0 },
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
      isolatedListRows: [],
    });
    vi.mocked(upsertAnnouncements).mockResolvedValue();
    vi.mocked(updateLastBoardId).mockResolvedValue();
    vi.mocked(dispatchNotifications).mockResolvedValue({
      web_push: { sent: 3, expired: 1, failed: 0 },
      email: { sent: 2, expired: 0, failed: 0 },
    });

    const response = await GET(makeRequest('Bearer test-secret'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      newCount: 2,
      skippedBoardIds: [102],
      invalidBoardIds: [],
      isolatedListRows: [],
      latestBoardId: 103,
      notifications: {
        web_push: { sent: 3, expired: 1, failed: 0 },
        email: { sent: 2, expired: 0, failed: 0 },
      },
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
      adapters: [webPushAdapter, emailAdapter],
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

  // #83 Step b: 저장이 끝난 뒤 목록 페이지의 ISR 캐시를 버려야 새 공고가
  //   1시간(revalidate 상한)을 기다리지 않고 웹에 반영된다.
  it('신규 공고가 있으면 목록 페이지 캐시를 무효화한다 (저장 후, 발송 전)', async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(
      {} as unknown as ReturnType<typeof getSupabaseAdminClient>,
    );
    vi.mocked(getLastBoardId).mockResolvedValue(100);
    vi.mocked(crawlNewAnnouncements).mockResolvedValue({
      newDetails: [buildDetail(101)],
      latestBoardId: 101,
      skippedBoardIds: [],
      invalidBoardIds: [],
      isolatedListRows: [],
    });
    vi.mocked(upsertAnnouncements).mockResolvedValue();
    vi.mocked(updateLastBoardId).mockResolvedValue();

    const response = await GET(makeRequest('Bearer test-secret'));

    expect(response.status).toBe(200);
    // 경로가 아니라 태그를 버린다 — 쿼리 조합(`?page=2` 등)마다 캐시 항목이
    // 따로 생기는데 경로 무효화로는 그것들을 지목할 수 없다.
    // `{ expire: 0 }`이어야 stale을 내보내지 않는다: 알림을 받고 들어온 첫
    // 방문자가 그 공고가 빠진 목록을 보면 안 된다.
    expect(revalidateTag).toHaveBeenCalledWith('announcements', { expire: 0 });

    // 저장·lastBoardId 갱신 후에 무효화해야 한다 — 먼저 버리면 아직 저장되지 않은
    // 상태를 다시 읽어 캐시에 굳힌다.
    const updateOrder =
      vi.mocked(updateLastBoardId).mock.invocationCallOrder[0];
    const revalidateOrder =
      vi.mocked(revalidateTag).mock.invocationCallOrder[0];
    const dispatchOrder = vi.mocked(dispatchNotifications).mock
      .invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(revalidateOrder);
    expect(revalidateOrder).toBeLessThan(dispatchOrder);
  });

  it('신규 공고가 없으면 캐시를 무효화하지 않는다', async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(
      {} as unknown as ReturnType<typeof getSupabaseAdminClient>,
    );
    vi.mocked(getLastBoardId).mockResolvedValue(100);
    vi.mocked(crawlNewAnnouncements).mockResolvedValue({
      newDetails: [],
      latestBoardId: 100,
      skippedBoardIds: [],
      invalidBoardIds: [],
      isolatedListRows: [],
    });
    vi.mocked(upsertAnnouncements).mockResolvedValue();
    vi.mocked(updateLastBoardId).mockResolvedValue();

    const response = await GET(makeRequest('Bearer test-secret'));

    expect(response.status).toBe(200);
    expect((await response.json()).newCount).toBe(0);
    // 내용이 그대로인데 캐시를 버리면 다음 방문자가 전체 렌더 비용만 다시 문다.
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('upsert 실패 시 캐시를 무효화하지 않는다', async () => {
    vi.mocked(getSupabaseAdminClient).mockReturnValue(
      {} as unknown as ReturnType<typeof getSupabaseAdminClient>,
    );
    vi.mocked(getLastBoardId).mockResolvedValue(100);
    vi.mocked(crawlNewAnnouncements).mockResolvedValue({
      newDetails: [buildDetail(101)],
      latestBoardId: 101,
      skippedBoardIds: [],
      invalidBoardIds: [],
      isolatedListRows: [],
    });
    vi.mocked(upsertAnnouncements).mockRejectedValue(new Error('db down'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await GET(makeRequest('Bearer test-secret'));

    expect(response.status).toBe(500);
    expect(revalidateTag).not.toHaveBeenCalled();

    errSpy.mockRestore();
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
      isolatedListRows: [],
    });
    vi.mocked(upsertAnnouncements).mockResolvedValue();
    vi.mocked(updateLastBoardId).mockResolvedValue();
    // 채널 실패는 서비스가 격리해 { error }로 돌려준다(throw 없음) —
    // 라우트는 그 맵을 그대로 응답에 싣는다. 한 채널의 실패가 다른 채널의
    // 집계를 가리지 않는다.
    vi.mocked(dispatchNotifications).mockResolvedValue({
      web_push: { error: 'VAPID env가 설정되지 않았습니다' },
      email: { sent: 1, expired: 0, failed: 0 },
    });

    const response = await GET(makeRequest('Bearer test-secret'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.newCount).toBe(1);
    expect(body.notifications).toEqual({
      web_push: { error: 'VAPID env가 설정되지 않았습니다' },
      email: { sent: 1, expired: 0, failed: 0 },
    });
    // 크롤 성공은 이미 확정 — 발송 실패가 저장·상태 갱신을 되돌리지 않는다.
    expect(updateLastBoardId).toHaveBeenCalled();
  });

  // ADR 012: 목록 row 격리는 크롤을 멈추지 않되 조용히 넘기지도 않는다 —
  //   응답과 로그가 관찰 창구다.
  it('목록 row 격리는 200 유지 + isolatedListRows·로그로 표면화', async () => {
    const isolated = [
      { boardId: 6624, reason: 'resultList[1].optn5: unknown code "9"' },
      {
        boardId: null,
        reason: 'resultList[2].boardId is not a positive integer',
      },
    ];
    vi.mocked(getSupabaseAdminClient).mockReturnValue(
      {} as unknown as ReturnType<typeof getSupabaseAdminClient>,
    );
    vi.mocked(getLastBoardId).mockResolvedValue(6620);
    vi.mocked(crawlNewAnnouncements).mockResolvedValue({
      newDetails: [buildDetail(6625)],
      latestBoardId: 6625,
      skippedBoardIds: [],
      invalidBoardIds: [],
      isolatedListRows: isolated,
    });
    vi.mocked(upsertAnnouncements).mockResolvedValue();
    vi.mocked(updateLastBoardId).mockResolvedValue();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await GET(makeRequest('Bearer test-secret'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.isolatedListRows).toEqual(isolated);
    // 격리에도 유효 공고는 정상 저장·발송된다.
    expect(body.newCount).toBe(1);
    expect(updateLastBoardId).toHaveBeenCalledWith(expect.anything(), 6625);
    expect(warnSpy).toHaveBeenCalledWith(
      '[cron/crawl] 목록 row 격리:',
      isolated,
    );

    warnSpy.mockRestore();
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
      isolatedListRows: [],
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
