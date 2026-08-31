import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { AnnouncementDetail } from '@/types/announcement';

import {
  detailToRow,
  listAnnouncements,
  rowToSummary,
  upsertAnnouncements,
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
    applicationStartDate: '2026-05-10',
    applicationEndDate: '2026-05-20',
    resultDate: '2026-06-01',
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
      application_start_date: '2026-05-10',
      application_end_date: '2026-05-20',
      result_date: '2026-06-01',
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
      applicationStartDate: null,
      applicationEndDate: null,
      resultDate: null,
      attachmentUrl: null,
      attachmentName: null,
    });
    const row = detailToRow(detail);

    expect(row.complex_name).toBeNull();
    expect(row.district).toBeNull();
    expect(row.address).toBeNull();
    expect(row.total_units).toBeNull();
    expect(row.application_start_date).toBeNull();
    expect(row.application_end_date).toBeNull();
    expect(row.result_date).toBeNull();
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
    application_start_date: '2026-09-01',
    application_end_date: '2026-09-10',
    ...overrides,
  };
}

interface QueryResult {
  data?: unknown;
  count?: number | null;
  error?: { message: string; code?: string } | null;
}

/**
 * 읽기 경로의 Supabase 체이닝 mock.
 *
 * - 목록 조회: `from().select(cols, {count}).order().order().range()` → listResult
 * - count 조회(fallback): `from().select('board_id', {head: true})` → countResult
 *   head 옵션 유무로 두 경로를 갈라, 한 mock으로 둘 다 검증한다.
 */
function createReadMockClient(results: {
  list?: QueryResult;
  count?: QueryResult;
}) {
  const listResult: QueryResult = results.list ?? {
    data: [],
    count: 0,
    error: null,
  };
  const countResult: QueryResult = results.count ?? { count: 0, error: null };

  const range = vi.fn().mockResolvedValue(listResult);
  const order = vi.fn();
  const chain = { order, range };
  order.mockReturnValue(chain);

  const select = vi.fn((_columns: string, options?: { head?: boolean }) =>
    options?.head ? Promise.resolve(countResult) : chain,
  );
  const from = vi.fn().mockReturnValue({ select });
  const client = { from } as unknown as SupabaseClient;

  return { client, from, select, order, range };
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
      applicationStartDate: '2026-09-01',
      applicationEndDate: '2026-09-10',
    });
  });

  it('nullable 필드의 null을 보존한다', () => {
    const summary = rowToSummary(
      buildSummaryRow({
        complex_name: null,
        district: null,
        application_start_date: null,
        application_end_date: null,
      }),
    );

    expect(summary.complexName).toBeNull();
    expect(summary.district).toBeNull();
    expect(summary.applicationStartDate).toBeNull();
    expect(summary.applicationEndDate).toBeNull();
  });
});

describe('listAnnouncements', () => {
  it('announcements 테이블을 exact count와 함께 조회한다', async () => {
    const { client, from, select } = createReadMockClient({});

    await listAnnouncements(client, { page: 1, pageSize: 20 });

    expect(from).toHaveBeenCalledWith('announcements');
    const [, options] = select.mock.calls[0];
    expect(options).toEqual({ count: 'exact' });
  });

  it('목록에 불필요한 raw_content를 select하지 않는다', async () => {
    const { client, select } = createReadMockClient({});

    await listAnnouncements(client, { page: 1, pageSize: 20 });

    const [columns] = select.mock.calls[0] as [string];
    expect(columns).not.toContain('raw_content');
    expect(columns).toContain('board_id');
    expect(columns).toContain('post_date');
  });

  it('post_date DESC 다음 board_id DESC로 전순서를 만든다', async () => {
    const { client, order } = createReadMockClient({});

    await listAnnouncements(client, { page: 1, pageSize: 20 });

    expect(order.mock.calls).toEqual([
      ['post_date', { ascending: false }],
      ['board_id', { ascending: false }],
    ]);
  });

  it('page/pageSize를 0-based range로 변환한다', async () => {
    const { client, range } = createReadMockClient({});

    await listAnnouncements(client, { page: 3, pageSize: 20 });

    expect(range).toHaveBeenCalledWith(40, 59);
  });

  it('row를 요약으로 매핑하고 total을 함께 반환한다', async () => {
    const { client } = createReadMockClient({
      list: {
        data: [
          buildSummaryRow({ board_id: 6644 }),
          buildSummaryRow({ board_id: 6643 }),
        ],
        count: 68,
        error: null,
      },
    });

    const result = await listAnnouncements(client, { page: 1, pageSize: 20 });

    expect(result.total).toBe(68);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].boardId).toBe(6644);
    expect(result.items[1].boardId).toBe(6643);
  });

  it('결과가 없으면 빈 items와 total 0을 반환한다', async () => {
    const { client } = createReadMockClient({
      list: { data: [], count: 0, error: null },
    });

    await expect(
      listAnnouncements(client, { page: 1, pageSize: 20 }),
    ).resolves.toEqual({ items: [], total: 0 });
  });

  it('범위를 벗어난 page(PGRST103)는 에러가 아니라 빈 페이지 + 실제 total', async () => {
    const { client, select } = createReadMockClient({
      list: {
        data: null,
        count: null,
        error: {
          code: 'PGRST103',
          message: 'Requested range not satisfiable',
        },
      },
      count: { count: 68, error: null },
    });

    const result = await listAnnouncements(client, { page: 999, pageSize: 20 });

    expect(result).toEqual({ items: [], total: 68 });
    // 두 번째 호출이 head 모드 count 조회
    expect(select.mock.calls[1][1]).toEqual({ count: 'exact', head: true });
  });

  it('그 밖의 Supabase 에러는 page/pageSize를 담아 throw', async () => {
    const { client } = createReadMockClient({
      list: {
        data: null,
        count: null,
        error: { code: '42501', message: 'permission denied' },
      },
    });

    await expect(
      listAnnouncements(client, { page: 2, pageSize: 20 }),
    ).rejects.toThrow(
      /Failed to list announcements \(page=2, pageSize=20\): permission denied/,
    );
  });

  it('count 조회 자체가 실패하면 throw', async () => {
    const { client } = createReadMockClient({
      list: {
        data: null,
        count: null,
        error: { code: 'PGRST103', message: 'range not satisfiable' },
      },
      count: { count: null, error: { message: 'connection lost' } },
    });

    await expect(
      listAnnouncements(client, { page: 999, pageSize: 20 }),
    ).rejects.toThrow(/Failed to count announcements: connection lost/);
  });

  it.each([0, -1, 1.5, Number.NaN])(
    'page=%s면 조회 전에 RangeError',
    async (page) => {
      const { client, from } = createReadMockClient({});

      await expect(
        listAnnouncements(client, { page, pageSize: 20 }),
      ).rejects.toThrow(RangeError);
      expect(from).not.toHaveBeenCalled();
    },
  );

  it.each([0, -5, 2.5])(
    'pageSize=%s면 조회 전에 RangeError',
    async (pageSize) => {
      const { client, from } = createReadMockClient({});

      await expect(
        listAnnouncements(client, { page: 1, pageSize }),
      ).rejects.toThrow(RangeError);
      expect(from).not.toHaveBeenCalled();
    },
  );
});
