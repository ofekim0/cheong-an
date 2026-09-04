/**
 * 공고 목록의 필터·페이지네이션 계산 (#106, ADR 015 Step a).
 *
 * 전량 요약이 브라우저에 있다는 전제에서 "이 URL이 보여줄 항목"을 고르는 순수
 * 함수들이다. 컴포넌트가 아니라 별도 모듈로 두는 이유는 `parseListParams`와 같다 —
 * 여기에 실제 분기(필터 일치, 범위 밖 page, 총 페이지 계산)가 있고, 데이터 공급원이
 * 바뀌어도(static shell 임베드 → 청크 지연 로드) 이 함수는 그대로 쓰인다.
 *
 * 입력 배열은 이미 정렬돼 있다고 가정한다(`listAllAnnouncementSummaries`가
 * `post_date DESC, board_id DESC`로 준다). 여기서 다시 정렬하지 않는다 — 정렬 기준의
 * 단일 출처는 조회 쪽이고, 같은 규칙을 두 곳에 두면 한쪽만 바뀌는 사고가 난다.
 */

import type {
  AnnouncementSummary,
  AnnouncementType,
  RecruitmentType,
} from '@/types/announcement';

/**
 * 목록에 적용할 필터.
 *
 * 지정하지 않은(`undefined`) 차원은 제약 없음 = 전체다. 두 차원 모두 DB에서 NOT
 * NULL이고 값 집합이 닫힌 enum이라, 필터 옵션을 코드 상수로 고정할 수 있고
 * "미기재"를 어떻게 다룰지 정책을 정할 필요가 없다. `district`는 nullable이고 사이트
 * 원문 문자열이 그대로 들어와 정규화가 안 돼 있어 제외했다(#83 c-1의 판단 그대로).
 *
 * 원래 `announcementsRepository`에 있던 타입이다. 필터가 서버 조회 조건이 아니라
 * 브라우저 계산의 입력이 되면서(ADR 015) 소유자가 이 모듈로 옮겨왔다.
 */
export interface AnnouncementFilters {
  announcementType?: AnnouncementType;
  recruitmentType?: RecruitmentType;
}

/** 필터가 하나라도 걸려 있는가. 빈 목록 문구·건수 문구 분기가 쓴다. */
export function hasActiveFilters(filters: AnnouncementFilters): boolean {
  return (
    filters.announcementType !== undefined ||
    filters.recruitmentType !== undefined
  );
}

/**
 * 필터에 맞는 항목만 남긴다. 지정된 차원은 모두 일치해야 한다(AND).
 *
 * 필터가 비어 있으면 같은 배열을 그대로 돌려준다 — 복사하지 않는다. 호출자가
 * 참조 동일성으로 "전체 그대로"를 알아볼 수 있고, 매 렌더마다 배열을 새로 만들지
 * 않는다.
 */
export function filterAnnouncements(
  items: readonly AnnouncementSummary[],
  filters: AnnouncementFilters,
): readonly AnnouncementSummary[] {
  if (!hasActiveFilters(filters)) {
    return items;
  }

  return items.filter(
    (item) =>
      (filters.announcementType === undefined ||
        item.announcementType === filters.announcementType) &&
      (filters.recruitmentType === undefined ||
        item.recruitmentType === filters.recruitmentType),
  );
}

/**
 * 전체 건수로 총 페이지 수를 계산한다. 0건이어도 1페이지다 — 페이지네이션 UI가
 * "1 / 0"을 그리지 않게 하고, 현재 페이지가 항상 유효한 범위를 갖게 한다.
 */
export function countPages(total: number, pageSize: number): number {
  assertPageSize(pageSize);
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * `page`(1부터)에 해당하는 구간을 잘라낸다.
 *
 * 범위를 벗어난 page는 에러가 아니라 빈 배열이다 — 공개 URL의 `?page=999`는 누구나
 * 만들 수 있고, 그것이 예외가 되어선 안 된다(서버 조회 시절 `PGRST103`을 빈 페이지로
 * 흡수했던 것과 같은 정책). 호출자는 `total`과 함께 "이 페이지에는 공고가 없습니다"를
 * 안내한다.
 *
 * 비정수·1 미만 page는 `RangeError`다. `parsePageParam`이 그 전에 1로 정규화하는
 * 계약이므로 여기 도달하면 호출 순서가 잘못된 것이고, 조용히 1페이지로 바꾸면 그
 * 실수가 묻힌다.
 */
export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): readonly T[] {
  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError(`page must be an integer >= 1, got: ${page}`);
  }
  assertPageSize(pageSize);

  const from = (page - 1) * pageSize;
  return items.slice(from, from + pageSize);
}

export interface SelectListPageParams {
  /** 1부터 시작하는 페이지 번호. */
  page: number;
  /** 페이지당 항목 수. */
  pageSize: number;
  filters: AnnouncementFilters;
}

export interface ListPage {
  /** 현재 페이지에 보여줄 항목. */
  items: readonly AnnouncementSummary[];
  /** 필터 적용 후 전체 건수(현재 페이지 항목 수가 아니다). */
  total: number;
  /** 필터 적용 후 총 페이지 수(최소 1). */
  totalPages: number;
}

/**
 * 필터 → 페이지 슬라이스를 한 번에 한다. 클라이언트 컴포넌트가 URL 하나로 화면에
 * 필요한 세 값을 얻는 진입점이다. 개별 함수는 테스트와 재조합을 위해 그대로 노출한다.
 */
export function selectListPage(
  items: readonly AnnouncementSummary[],
  { page, pageSize, filters }: SelectListPageParams,
): ListPage {
  const filtered = filterAnnouncements(items, filters);
  return {
    items: paginate(filtered, page, pageSize),
    total: filtered.length,
    totalPages: countPages(filtered.length, pageSize),
  };
}

function assertPageSize(pageSize: number): void {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError(`pageSize must be an integer >= 1, got: ${pageSize}`);
  }
}
