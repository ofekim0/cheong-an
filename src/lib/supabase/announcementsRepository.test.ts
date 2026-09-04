import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { AnnouncementDetail } from '@/types/announcement';

import {
  detailToRow,
  getAnnouncementByBoardId,
  listAllAnnouncementSummaries,
  rowToAnnouncement,
  rowToSummary,
  upsertAnnouncements,
  type AnnouncementFullRow,
  type AnnouncementSummaryRow,
} from './announcementsRepository';

function buildDetail(
  overrides: Partial<AnnouncementDetail> = {},
): AnnouncementDetail {
  return {
    boardId: 1001,
    title: '청년안심주택 ○○ 단지 입주자 모집공고',
    announcementType: 'public',
    recruitmentType: 'initial',
    complexName: '○○ 청년안심주택',
    district: '강남구',
    address: '서울특별시 강남구 ...',
    totalUnits: 100,
    postDate: '2026-05-01',
    applicationDate: '2026-05-10',
    attachmentUrl: 'https://example.com/file.pdf',
    attachmentName: '모집공고문.pdf',
    rawContent: '<div>raw html</div>',
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

describe('detailToRow', () => {
  it('모든 필드를 camelCase → snake_case로 매핑한다', () => {
    const detail = buildDetail();
    const row = detailToRow(detail);

    expect(row).toEqual({
      board_id: 1001,
      title: '청년안심주택 ○○ 단지 입주자 모집공고',
      announcement_type: 'public',
      recruitment_type: 'initial',
      complex_name: '○○ 청년안심주택',
      district: '강남구',
      address: '서울특별시 강남구 ...',
      total_units: 100,
      post_date: '2026-05-01',
      application_date: '2026-05-10',
      attachment_url: 'https://example.com/file.pdf',
      attachment_name: '모집공고문.pdf',
      raw_content: '<div>raw html</div>',
    });
  });

  it('nullable 필드의 null 값을 그대로 전달한다', () => {
    const detail = buildDetail({
      complexName: null,
      district: null,
      address: null,
      totalUnits: null,
      applicationDate: null,
      attachmentUrl: null,
      attachmentName: null,
    });
    const row = detailToRow(detail);

    expect(row.complex_name).toBeNull();
    expect(row.district).toBeNull();
    expect(row.address).toBeNull();
    expect(row.total_units).toBeNull();
    expect(row.application_date).toBeNull();
    expect(row.attachment_url).toBeNull();
    expect(row.attachment_name).toBeNull();
  });
});

describe('upsertAnnouncements', () => {
  it('빈 배열이면 Supabase를 호출하지 않는다', async () => {
    const { client, from } = createMockClient({ error: null });

    await upsertAnnouncements(client, []);

    expect(from).not.toHaveBeenCalled();
  });

  it('announcements 테이블에 board_id 기준 UPSERT를 호출한다', async () => {
    const { client, from, upsert } = createMockClient({ error: null });
    const details = [
      buildDetail({ boardId: 1001 }),
      buildDetail({ boardId: 1002 }),
    ];

    await upsertAnnouncements(client, details);

    expect(from).toHaveBeenCalledWith('announcements');
    expect(upsert).toHaveBeenCalledTimes(1);
    const [rows, options] = upsert.mock.calls[0];
    expect(rows).toHaveLength(2);
    expect(rows[0].board_id).toBe(1001);
    expect(rows[1].board_id).toBe(1002);
    expect(options).toEqual({ onConflict: 'board_id' });
  });

  it('Supabase가 에러를 반환하면 throw + 메시지에 건수 포함', async () => {
    const { client } = createMockClient({
      error: { message: 'duplicate key' },
    });

    await expect(
      upsertAnnouncements(client, [
        buildDetail(),
        buildDetail({ boardId: 1002 }),
      ]),
    ).rejects.toThrow(/Failed to upsert 2 announcement\(s\): duplicate key/);
  });
});

/* ------------------------------------------------------------------ */
/* 읽기 경로                                                           */
/* ------------------------------------------------------------------ */

function buildSummaryRow(
  overrides: Partial<AnnouncementSummaryRow> = {},
): AnnouncementSummaryRow {
  return {
    board_id: 6644,
    title: '[민간임대] 강변역 비바힐스강변 추가모집공고',
    announcement_type: 'private',
    recruitment_type: 'additional',
    complex_name: '비바힐스강변',
    district: '광진구',
    post_date: '2026-08-27',
    application_date: '2026-09-01',
    ...overrides,
  };
}

interface QueryResult {
  data?: unknown;
  count?: number | null;
  error?: { message: string; code?: string } | null;
}

describe('rowToSummary', () => {
  it('snake_case row를 camelCase 요약으로 매핑한다', () => {
    expect(rowToSummary(buildSummaryRow())).toEqual({
      boardId: 6644,
      title: '[민간임대] 강변역 비바힐스강변 추가모집공고',
      announcementType: 'private',
      recruitmentType: 'additional',
      complexName: '비바힐스강변',
      district: '광진구',
      postDate: '2026-08-27',
      applicationDate: '2026-09-01',
    });
  });

  it('nullable 필드의 null을 보존한다', () => {
    const summary = rowToSummary(
      buildSummaryRow({
        complex_name: null,
        district: null,
        application_date: null,
      }),
    );

    expect(summary.complexName).toBeNull();
    expect(summary.district).toBeNull();
    expect(summary.applicationDate).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 상세 조회 (#96)                                                     */
/* ------------------------------------------------------------------ */

function buildFullRow(
  overrides: Partial<AnnouncementFullRow> = {},
): AnnouncementFullRow {
  return {
    id: 42,
    board_id: 6644,
    title: '[민간임대] 강변역 비바힐스강변 추가모집공고',
    announcement_type: 'private',
    recruitment_type: 'additional',
    complex_name: '비바힐스강변',
    district: '광진구',
    address: '서울특별시 광진구 ...',
    total_units: 120,
    post_date: '2026-08-27',
    application_date: '2026-08-31',
    attachment_url: 'https://soco.seoul.go.kr/youth/fileDown.do?id=abc',
    attachment_name: '모집공고문.pdf',
    raw_content: '단지명: 비바힐스강변\n주택위치: 서울특별시 광진구 ...',
    created_at: '2026-08-27T00:00:00Z',
    updated_at: '2026-08-27T00:00:00Z',
    ...overrides,
  };
}

/**
 * `from().select('*').eq().single()` 체인 mock.
 * 목록 쪽 mock(`createListAllMockClient`)과 분리한 이유: 상세는 `single()`로 끝나 count
 * 분기가 없고, 한 mock에 두 형태를 합치면 어느 경로가 검증됐는지 흐려진다.
 */
function createSingleMockClient(result: QueryResult) {
  const single = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  const client = { from } as unknown as SupabaseClient;
  return { client, from, select, eq, single };
}

describe('rowToAnnouncement', () => {
  it('전체 row를 camelCase 도메인 타입으로 매핑한다', () => {
    expect(rowToAnnouncement(buildFullRow())).toEqual({
      id: 42,
      boardId: 6644,
      title: '[민간임대] 강변역 비바힐스강변 추가모집공고',
      announcementType: 'private',
      recruitmentType: 'additional',
      complexName: '비바힐스강변',
      district: '광진구',
      address: '서울특별시 광진구 ...',
      totalUnits: 120,
      postDate: '2026-08-27',
      applicationDate: '2026-08-31',
      attachmentUrl: 'https://soco.seoul.go.kr/youth/fileDown.do?id=abc',
      attachmentName: '모집공고문.pdf',
      rawContent: '단지명: 비바힐스강변\n주택위치: 서울특별시 광진구 ...',
      createdAt: '2026-08-27T00:00:00Z',
      updatedAt: '2026-08-27T00:00:00Z',
    });
  });

  it('nullable 필드의 null을 보존한다', () => {
    const row = rowToAnnouncement(
      buildFullRow({
        complex_name: null,
        district: null,
        address: null,
        total_units: null,
        application_date: null,
        attachment_url: null,
        attachment_name: null,
      }),
    );

    expect(row.complexName).toBeNull();
    expect(row.district).toBeNull();
    expect(row.address).toBeNull();
    expect(row.totalUnits).toBeNull();
    expect(row.applicationDate).toBeNull();
    expect(row.attachmentUrl).toBeNull();
    expect(row.attachmentName).toBeNull();
  });
});

describe('getAnnouncementByBoardId', () => {
  it('board_id로 조회해 도메인 타입으로 반환한다', async () => {
    const { client, from, select, eq } = createSingleMockClient({
      data: buildFullRow(),
      error: null,
    });

    const row = await getAnnouncementByBoardId(client, 6644);

    expect(from).toHaveBeenCalledWith('announcements');
    // 목록과 달리 컬럼을 고르지 않는다 — 1건이고 본문이 렌더 대상이다.
    expect(select).toHaveBeenCalledWith('*');
    expect(eq).toHaveBeenCalledWith('board_id', 6644);
    expect(row?.boardId).toBe(6644);
    expect(row?.rawContent).toContain('비바힐스강변');
  });

  it('없는 boardId는 throw가 아니라 null을 반환한다', async () => {
    // PostgREST의 single()은 0건을 빈 데이터가 아니라 PGRST116 에러로 돌려준다.
    const { client } = createSingleMockClient({
      data: null,
      error: { message: 'no rows', code: 'PGRST116' },
    });

    await expect(getAnnouncementByBoardId(client, 999999)).resolves.toBeNull();
  });

  it('그 밖의 Supabase 에러는 throw한다', async () => {
    const { client } = createSingleMockClient({
      data: null,
      error: { message: 'permission denied', code: '42501' },
    });

    await expect(getAnnouncementByBoardId(client, 6644)).rejects.toThrow(
      /permission denied/,
    );
  });

  it('양의 정수가 아닌 boardId는 RangeError', async () => {
    const { client, from } = createSingleMockClient({
      data: null,
      error: null,
    });

    await expect(getAnnouncementByBoardId(client, 0)).rejects.toThrow(
      RangeError,
    );
    await expect(getAnnouncementByBoardId(client, -1)).rejects.toThrow(
      RangeError,
    );
    await expect(getAnnouncementByBoardId(client, 1.5)).rejects.toThrow(
      RangeError,
    );
    await expect(getAnnouncementByBoardId(client, NaN)).rejects.toThrow(
      RangeError,
    );
    // 검증이 먼저라 Supabase를 부르지 않는다.
    expect(from).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* listAllAnnouncementSummaries (#106, ADR 015 Step a)                 */
/* ------------------------------------------------------------------ */

/**
 * 전량 조회 체이닝 mock: `from().select(cols).order().order()` → result.
 * `range`·`count`가 없는 것이 이 함수의 요점이라 그 둘은 mock에 두지 않는다 —
 * 호출하면 TypeError로 드러난다.
 */
function createListAllMockClient(result: QueryResult) {
  const secondOrder = vi.fn().mockResolvedValue(result);
  const firstOrder = vi.fn().mockReturnValue({ order: secondOrder });
  const select = vi.fn().mockReturnValue({ order: firstOrder });
  const from = vi.fn().mockReturnValue({ select });
  const client = { from } as unknown as SupabaseClient;

  return { client, from, select, firstOrder, secondOrder };
}

describe('listAllAnnouncementSummaries', () => {
  it('announcements 테이블에서 요약 컬럼만 count 없이 조회한다', async () => {
    const { client, from, select } = createListAllMockClient({
      data: [],
      error: null,
    });

    await listAllAnnouncementSummaries(client);

    expect(from).toHaveBeenCalledWith('announcements');
    expect(select).toHaveBeenCalledTimes(1);
    const [columns, options] = select.mock.calls[0] as [string, unknown];
    expect(options).toBeUndefined();
    expect(columns).not.toContain('raw_content');
    expect(columns).toContain('board_id');
    expect(columns).toContain('post_date');
  });

  it('post_date DESC 다음 board_id DESC로 전순서를 만든다', async () => {
    const { client, firstOrder, secondOrder } = createListAllMockClient({
      data: [],
      error: null,
    });

    await listAllAnnouncementSummaries(client);

    expect(firstOrder).toHaveBeenCalledWith('post_date', { ascending: false });
    expect(secondOrder).toHaveBeenCalledWith('board_id', { ascending: false });
  });

  it('row를 요약으로 매핑해 순서대로 돌려준다', async () => {
    const { client } = createListAllMockClient({
      data: [
        buildSummaryRow({ board_id: 6644 }),
        buildSummaryRow({ board_id: 6643 }),
      ],
      error: null,
    });

    const result = await listAllAnnouncementSummaries(client);

    expect(result.map((item) => item.boardId)).toEqual([6644, 6643]);
    expect(result[0]).toEqual(
      rowToSummary(buildSummaryRow({ board_id: 6644 })),
    );
  });

  it('data가 null이면 빈 배열', async () => {
    const { client } = createListAllMockClient({ data: null, error: null });

    await expect(listAllAnnouncementSummaries(client)).resolves.toEqual([]);
  });

  it('Supabase 에러는 메시지를 담아 throw한다', async () => {
    const { client } = createListAllMockClient({
      data: null,
      error: { message: 'connection refused' },
    });

    await expect(listAllAnnouncementSummaries(client)).rejects.toThrow(
      'Failed to list all announcements: connection refused',
    );
  });
});
