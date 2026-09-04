import { describe, expect, it } from 'vitest';

import type { AnnouncementSummary } from '@/types/announcement';

import {
  countPages,
  filterAnnouncements,
  hasActiveFilters,
  paginate,
  selectListPage,
} from './filterAnnouncements';

function buildSummary(
  overrides: Partial<AnnouncementSummary> = {},
): AnnouncementSummary {
  return {
    boardId: 6644,
    title: '테스트 공고',
    announcementType: 'private',
    recruitmentType: 'initial',
    complexName: null,
    district: null,
    postDate: '2026-05-14',
    applicationDate: null,
    ...overrides,
  };
}

// 2×2 조합을 하나씩 갖는 최소 데이터. 정렬은 조회 쪽 책임이라 여기서는 순서만 고정한다.
const PUBLIC_INITIAL = buildSummary({
  boardId: 4,
  announcementType: 'public',
  recruitmentType: 'initial',
});
const PUBLIC_ADDITIONAL = buildSummary({
  boardId: 3,
  announcementType: 'public',
  recruitmentType: 'additional',
});
const PRIVATE_INITIAL = buildSummary({
  boardId: 2,
  announcementType: 'private',
  recruitmentType: 'initial',
});
const PRIVATE_ADDITIONAL = buildSummary({
  boardId: 1,
  announcementType: 'private',
  recruitmentType: 'additional',
});
const ALL = [
  PUBLIC_INITIAL,
  PUBLIC_ADDITIONAL,
  PRIVATE_INITIAL,
  PRIVATE_ADDITIONAL,
];

describe('hasActiveFilters', () => {
  it('빈 필터는 false', () => {
    expect(hasActiveFilters({})).toBe(false);
  });

  it('명시적 undefined도 제약 없음으로 본다', () => {
    expect(
      hasActiveFilters({
        announcementType: undefined,
        recruitmentType: undefined,
      }),
    ).toBe(false);
  });

  it('한 차원만 있어도 true', () => {
    expect(hasActiveFilters({ announcementType: 'public' })).toBe(true);
    expect(hasActiveFilters({ recruitmentType: 'additional' })).toBe(true);
  });
});

describe('filterAnnouncements', () => {
  it('필터가 없으면 같은 배열을 그대로 돌려준다(복사하지 않음)', () => {
    expect(filterAnnouncements(ALL, {})).toBe(ALL);
  });

  it('유형 한 차원으로 거른다', () => {
    expect(filterAnnouncements(ALL, { announcementType: 'public' })).toEqual([
      PUBLIC_INITIAL,
      PUBLIC_ADDITIONAL,
    ]);
  });

  it('모집 한 차원으로 거른다', () => {
    expect(filterAnnouncements(ALL, { recruitmentType: 'additional' })).toEqual(
      [PUBLIC_ADDITIONAL, PRIVATE_ADDITIONAL],
    );
  });

  it('두 차원은 AND로 결합한다', () => {
    expect(
      filterAnnouncements(ALL, {
        announcementType: 'private',
        recruitmentType: 'initial',
      }),
    ).toEqual([PRIVATE_INITIAL]);
  });

  it('입력 순서를 유지한다', () => {
    const result = filterAnnouncements(ALL, { recruitmentType: 'initial' });
    expect(result.map((item) => item.boardId)).toEqual([4, 2]);
  });

  it('입력 배열을 변경하지 않는다', () => {
    const input = [...ALL];
    filterAnnouncements(input, { announcementType: 'public' });
    expect(input).toEqual(ALL);
  });
});

describe('countPages', () => {
  it('0건이어도 1페이지', () => {
    expect(countPages(0, 20)).toBe(1);
  });

  it('올림으로 계산한다', () => {
    expect(countPages(1, 20)).toBe(1);
    expect(countPages(20, 20)).toBe(1);
    expect(countPages(21, 20)).toBe(2);
    expect(countPages(69, 20)).toBe(4);
  });

  it('pageSize가 1 미만이거나 정수가 아니면 RangeError', () => {
    expect(() => countPages(10, 0)).toThrow(RangeError);
    expect(() => countPages(10, 1.5)).toThrow(RangeError);
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 5 }, (_, index) => index + 1);

  it('1페이지는 처음 pageSize개', () => {
    expect(paginate(items, 1, 2)).toEqual([1, 2]);
  });

  it('마지막 페이지는 남은 만큼만', () => {
    expect(paginate(items, 3, 2)).toEqual([5]);
  });

  // 공개 URL의 `?page=999`는 예외가 아니라 빈 페이지다(서버 조회 시절 PGRST103 정책과 동일).
  it('범위를 벗어난 page는 빈 배열', () => {
    expect(paginate(items, 4, 2)).toEqual([]);
    expect(paginate(items, 999, 2)).toEqual([]);
  });

  it('빈 입력의 1페이지는 빈 배열', () => {
    expect(paginate([], 1, 20)).toEqual([]);
  });

  // parsePageParam이 먼저 1로 정규화하는 계약. 여기 도달하면 호출 순서가 잘못된 것이다.
  it.each([0, -1, 1.5, Number.NaN])('page=%s는 RangeError', (page) => {
    expect(() => paginate(items, page, 2)).toThrow(RangeError);
  });

  it('pageSize가 1 미만이면 RangeError', () => {
    expect(() => paginate(items, 1, 0)).toThrow(RangeError);
  });
});

describe('selectListPage', () => {
  it('필터 적용 후 total과 totalPages를 계산하고 해당 페이지를 잘라낸다', () => {
    const result = selectListPage(ALL, {
      page: 1,
      pageSize: 1,
      filters: { announcementType: 'public' },
    });

    expect(result).toEqual({
      items: [PUBLIC_INITIAL],
      total: 2,
      totalPages: 2,
    });
  });

  it('필터가 없으면 전체를 대상으로 한다', () => {
    const result = selectListPage(ALL, { page: 1, pageSize: 20, filters: {} });

    expect(result.items).toEqual(ALL);
    expect(result.total).toBe(4);
    expect(result.totalPages).toBe(1);
  });

  it('조건에 맞는 항목이 없으면 total 0·totalPages 1·빈 items', () => {
    const onlyPublic = [PUBLIC_INITIAL, PUBLIC_ADDITIONAL];
    const result = selectListPage(onlyPublic, {
      page: 1,
      pageSize: 20,
      filters: { announcementType: 'private' },
    });

    expect(result).toEqual({ items: [], total: 0, totalPages: 1 });
  });

  // 목록 페이지가 세 가지 빈 문구를 가르는 근거: total > 0인데 items가 비면 "범위 초과".
  it('범위를 벗어난 page는 items만 비고 total은 유지된다', () => {
    const result = selectListPage(ALL, { page: 5, pageSize: 2, filters: {} });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(4);
    expect(result.totalPages).toBe(2);
  });
});
