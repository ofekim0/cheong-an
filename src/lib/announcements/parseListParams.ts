/**
 * URL 쿼리 → 목록 조회 파라미터 변환 (#83, Step c).
 *
 * 컴포넌트가 아니라 별도 모듈로 두는 이유는 `formatAnnouncement`와 같다 — UI
 * 스타일링은 테스트하지 않지만(CLAUDE.md), 여기에는 **잘못된 입력을 어떻게
 * 다루는가**라는 실제 분기가 있다. 공개 페이지의 쿼리스트링은 누구나 임의로
 * 바꿀 수 있으므로 이 분기가 곧 방어선이다.
 *
 * 원칙: **모르는 값은 무시한다(제약 없음으로 취급).** 400이나 500으로 응답하지
 * 않는다 — 링크를 잘못 복사한 방문자에게 에러 페이지를 보여줄 이유가 없고,
 * 목록은 필터가 하나 빠진 채로도 의미가 온전하다.
 */

import type { AnnouncementType, RecruitmentType } from '@/types/announcement';
import type { AnnouncementFilters } from '@/lib/supabase/announcementsRepository';

/** URL 쿼리 파라미터 이름. 필터 UI·페이지네이션·파싱이 공유한다. */
export const PAGE_PARAM = 'page';
export const TYPE_PARAM = 'type';
export const RECRUITMENT_PARAM = 'recruitment';

/** Next의 `searchParams`가 돌려주는 값의 형태. */
type ParamValue = string | string[] | undefined;

/** 허용 값 화이트리스트. enum이라 닫힌 집합으로 검증할 수 있다. */
const ANNOUNCEMENT_TYPES: readonly AnnouncementType[] = ['public', 'private'];
const RECRUITMENT_TYPES: readonly RecruitmentType[] = ['initial', 'additional'];

/**
 * 같은 키가 여러 번 온 경우(`?type=public&type=private`) 첫 값만 쓴다.
 *
 * 배열을 그대로 넘기면 화이트리스트 검사가 전부 실패해 필터가 조용히 사라진다.
 * 첫 값을 택하는 편이 사용자의 의도에 가깝다.
 */
function firstValue(raw: ParamValue): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * `?page=` 값을 1 이상의 정수로 정규화한다.
 *
 * `listAnnouncements`는 비정수·1 미만 page에 `RangeError`를 던지는 계약이므로
 * 조회 전에 여기서 걸러야 한다. 잘못된 값은 첫 페이지로 본다.
 */
export function parsePageParam(raw: ParamValue): number {
  const value = firstValue(raw);
  if (value === undefined) {
    return 1;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/**
 * 쿼리에서 필터를 뽑는다. 허용 목록에 없는 값은 그 차원을 지정하지 않은 것으로 본다.
 *
 * 지정되지 않은 차원은 키를 아예 넣지 않는다 — `{ announcementType: undefined }`도
 * 리포지토리가 제약 없음으로 처리하지만(`applyFilters`), 키가 없는 편이 캐시 키와
 * 로그에서 읽기 쉽다.
 */
export function parseAnnouncementFilters(params: {
  [key: string]: ParamValue;
}): AnnouncementFilters {
  const filters: AnnouncementFilters = {};

  const type = firstValue(params[TYPE_PARAM]);
  if (type !== undefined && isAnnouncementType(type)) {
    filters.announcementType = type;
  }

  const recruitment = firstValue(params[RECRUITMENT_PARAM]);
  if (recruitment !== undefined && isRecruitmentType(recruitment)) {
    filters.recruitmentType = recruitment;
  }

  return filters;
}

function isAnnouncementType(value: string): value is AnnouncementType {
  return (ANNOUNCEMENT_TYPES as readonly string[]).includes(value);
}

function isRecruitmentType(value: string): value is RecruitmentType {
  return (RECRUITMENT_TYPES as readonly string[]).includes(value);
}

/**
 * 필터를 다시 쿼리 문자열 형태로 되돌린다.
 *
 * 페이지네이션 링크가 필터를 유지하는 데 쓴다. 파싱의 역방향이라 같은 모듈에
 * 두어, 파라미터 이름이 한쪽에서만 바뀌는 일을 막는다.
 */
export function filtersToSearchParams(
  filters: AnnouncementFilters,
): Record<string, string> {
  const params: Record<string, string> = {};

  if (filters.announcementType !== undefined) {
    params[TYPE_PARAM] = filters.announcementType;
  }
  if (filters.recruitmentType !== undefined) {
    params[RECRUITMENT_PARAM] = filters.recruitmentType;
  }

  return params;
}
