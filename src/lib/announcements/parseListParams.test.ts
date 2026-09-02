import { describe, expect, it } from 'vitest';

import {
  filtersToSearchParams,
  parseAnnouncementFilters,
  parsePageParam,
} from './parseListParams';

describe('parsePageParam', () => {
  it('값이 없으면 1페이지', () => {
    expect(parsePageParam(undefined)).toBe(1);
  });

  it('1 이상의 정수 문자열은 그대로 쓴다', () => {
    expect(parsePageParam('1')).toBe(1);
    expect(parsePageParam('3')).toBe(3);
    expect(parsePageParam('999')).toBe(999);
  });

  // listAnnouncements가 RangeError를 던지는 입력들. 공개 쿼리스트링이 500이
  // 되어선 안 되므로 조회 전에 여기서 1로 정규화한다.
  it.each(['0', '-1', '1.5', 'abc', '', ' ', 'NaN', 'Infinity'])(
    'page=%s는 1페이지로 정규화한다',
    (raw) => {
      expect(parsePageParam(raw)).toBe(1);
    },
  );

  it('같은 키가 여러 번 오면 첫 값을 쓴다', () => {
    expect(parsePageParam(['2', '5'])).toBe(2);
  });

  it('빈 배열은 1페이지', () => {
    expect(parsePageParam([])).toBe(1);
  });
});

describe('parseAnnouncementFilters', () => {
  it('쿼리가 비어 있으면 빈 필터', () => {
    expect(parseAnnouncementFilters({})).toEqual({});
  });

  it('허용된 type을 필터로 반영한다', () => {
    expect(parseAnnouncementFilters({ type: 'public' })).toEqual({
      announcementType: 'public',
    });
    expect(parseAnnouncementFilters({ type: 'private' })).toEqual({
      announcementType: 'private',
    });
  });

  it('허용된 recruitment를 필터로 반영한다', () => {
    expect(parseAnnouncementFilters({ recruitment: 'initial' })).toEqual({
      recruitmentType: 'initial',
    });
    expect(parseAnnouncementFilters({ recruitment: 'additional' })).toEqual({
      recruitmentType: 'additional',
    });
  });

  it('두 차원을 함께 반영한다', () => {
    expect(
      parseAnnouncementFilters({ type: 'public', recruitment: 'additional' }),
    ).toEqual({
      announcementType: 'public',
      recruitmentType: 'additional',
    });
  });

  // 화이트리스트 밖의 값을 그대로 넘기면 DB에 없는 값으로 조회해 빈 목록이
  // 되거나(오해를 부름), enum 컬럼에서 쿼리 오류가 난다.
  it.each(['PUBLIC', 'public ', 'unknown', '', 'null', '1'])(
    'type=%s처럼 허용 목록 밖의 값은 무시한다',
    (raw) => {
      expect(parseAnnouncementFilters({ type: raw })).toEqual({});
    },
  );

  it.each(['INITIAL', 'first', '', 'true'])(
    'recruitment=%s처럼 허용 목록 밖의 값은 무시한다',
    (raw) => {
      expect(parseAnnouncementFilters({ recruitment: raw })).toEqual({});
    },
  );

  it('한 차원이 잘못돼도 나머지 차원은 살린다', () => {
    expect(
      parseAnnouncementFilters({ type: 'nope', recruitment: 'initial' }),
    ).toEqual({ recruitmentType: 'initial' });
  });

  it('같은 키가 여러 번 오면 첫 값을 쓴다', () => {
    expect(parseAnnouncementFilters({ type: ['private', 'public'] })).toEqual({
      announcementType: 'private',
    });
  });

  it('관계없는 쿼리 파라미터는 무시한다', () => {
    expect(
      parseAnnouncementFilters({ page: '2', utm_source: 'kakao' }),
    ).toEqual({});
  });

  it('지정되지 않은 차원은 키 자체를 넣지 않는다', () => {
    const filters = parseAnnouncementFilters({ type: 'public' });

    expect(Object.keys(filters)).toEqual(['announcementType']);
  });
});

describe('filtersToSearchParams', () => {
  it('빈 필터는 빈 객체', () => {
    expect(filtersToSearchParams({})).toEqual({});
  });

  it('필터를 쿼리 파라미터 이름으로 되돌린다', () => {
    expect(
      filtersToSearchParams({
        announcementType: 'private',
        recruitmentType: 'initial',
      }),
    ).toEqual({ type: 'private', recruitment: 'initial' });
  });

  // 파싱 → 역변환 → 파싱이 같은 결과여야 한다. 한쪽에서만 파라미터 이름을
  // 바꾸면 페이지네이션 링크가 필터를 잃는다.
  it('파싱의 역방향이다 (round-trip)', () => {
    const query = { type: 'public', recruitment: 'additional' };
    const filters = parseAnnouncementFilters(query);

    expect(filtersToSearchParams(filters)).toEqual(query);
    expect(parseAnnouncementFilters(filtersToSearchParams(filters))).toEqual(
      filters,
    );
  });
});
