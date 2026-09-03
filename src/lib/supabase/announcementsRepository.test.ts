import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import type { AnnouncementDetail } from '@/types/announcement';

import {
  detailToRow,
  getAnnouncementByBoardId,
  listAnnouncements,
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

/**
 * 읽기 경로의 Supabase 체이닝 mock.
 *
 * - 목록 조회: `from().select(cols, {count}).eq()*.order().order().range()` → listResult
 * - count 조회(fallback): `from().select('board_id', {head: true}).eq()*` → countResult
 *   head 옵션 유무로 두 경로를 갈라, 한 mock으로 둘 다 검증한다.
 *
 * count 경로는 `eq` 체이닝 뒤에 그대로 await되므로 thenable로 만든다 — 실제
 * PostgREST 빌더도 필터를 더 붙일 수 있으면서 await 가능한 객체다.
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
  const listEq = vi.fn();
  const chain = { eq: listEq, order, range };
  order.mockReturnValue(chain);
  listEq.mockReturnValue(chain);

  const countEq = vi.fn();
  const countChain = {
    eq: countEq,
    then: (onFulfilled: (value: QueryResult) => unknown) =>
      Promise.resolve(countResult).then(onFulfilled),
  };
  countEq.mockReturnValue(countChain);

  const select = vi.fn((_columns: string, options?: { head?: boolean }) =>
    options?.head ? countChain : chain,
  );
  const from = vi.fn().mockReturnValue({ select });
  const client = { from } as unknown as SupabaseClient;

  return { client, from, select, order, range, listEq, countEq };
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

  describe('필터', () => {
    it('filters를 생략하면 eq 조건을 걸지 않는다', async () => {
      const { client, listEq } = createReadMockClient({});

      await listAnnouncements(client, { page: 1, pageSize: 20 });

      expect(listEq).not.toHaveBeenCalled();
    });

    it('announcementType만 지정하면 그 컬럼에만 eq를 건다', async () => {
      const { client, listEq } = createReadMockClient({});

      await listAnnouncements(client, {
        page: 1,
        pageSize: 20,
        filters: { announcementType: 'public' },
      });

      expect(listEq.mock.calls).toEqual([['announcement_type', 'public']]);
    });

    it('recruitmentType만 지정하면 그 컬럼에만 eq를 건다', async () => {
      const { client, listEq } = createReadMockClient({});

      await listAnnouncements(client, {
        page: 1,
        pageSize: 20,
        filters: { recruitmentType: 'additional' },
      });

      expect(listEq.mock.calls).toEqual([['recruitment_type', 'additional']]);
    });

    it('두 차원을 함께 지정하면 eq를 둘 다 건다', async () => {
      const { client, listEq } = createReadMockClient({});

      await listAnnouncements(client, {
        page: 1,
        pageSize: 20,
        filters: {
          announcementType: 'private',
          recruitmentType: 'initial',
        },
      });

      expect(listEq.mock.calls).toEqual([
        ['announcement_type', 'private'],
        ['recruitment_type', 'initial'],
      ]);
    });

    it('값이 undefined인 차원은 제약 없음으로 취급한다', async () => {
      const { client, listEq } = createReadMockClient({});

      await listAnnouncements(client, {
        page: 1,
        pageSize: 20,
        filters: { announcementType: undefined, recruitmentType: 'initial' },
      });

      expect(listEq.mock.calls).toEqual([['recruitment_type', 'initial']]);
    });

    it('필터를 적용한 total을 반환한다', async () => {
      const { client } = createReadMockClient({
        list: { data: [buildSummaryRow()], count: 12, error: null },
      });

      const result = await listAnnouncements(client, {
        page: 1,
        pageSize: 20,
        filters: { announcementType: 'public' },
      });

      expect(result.total).toBe(12);
    });

    it('범위 초과 시 fallback count 조회에도 같은 필터를 적용한다', async () => {
      const { client, countEq } = createReadMockClient({
        list: {
          data: null,
          count: null,
          error: {
            code: 'PGRST103',
            message: 'Requested range not satisfiable',
          },
        },
        count: { count: 12, error: null },
      });

      const result = await listAnnouncements(client, {
        page: 999,
        pageSize: 20,
        filters: {
          announcementType: 'public',
          recruitmentType: 'initial',
        },
      });

      // 목록과 count에 필터가 같이 걸려야 total이 "필터 적용 후 건수"가 된다.
      expect(countEq.mock.calls).toEqual([
        ['announcement_type', 'public'],
        ['recruitment_type', 'initial'],
      ]);
      expect(result).toEqual({ items: [], total: 12 });
    });
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
 * 목록 쪽 `createReadMockClient`와 분리한 이유: 상세는 `single()`로 끝나 count
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
