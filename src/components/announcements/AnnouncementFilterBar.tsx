import Link from 'next/link';

import { ANNOUNCEMENTS_PATH } from '@/constants/announcements';
import {
  ANNOUNCEMENT_TYPE_LABEL,
  RECRUITMENT_TYPE_LABEL,
} from '@/lib/announcements/formatAnnouncement';
import {
  filtersToSearchParams,
  RECRUITMENT_PARAM,
  TYPE_PARAM,
} from '@/lib/announcements/parseListParams';
import type { AnnouncementFilters } from '@/lib/supabase/announcementsRepository';

/**
 * 공고 목록 필터 (#83, Step c-3).
 *
 * 서버 컴포넌트 — 선택이 전부 URL 링크다. 클라이언트 상태도 JS도 없고, 필터가
 * 걸린 화면이 공유·북마크 가능한 주소를 가진다.
 *
 * **필터를 바꾸면 page를 버린다.** 4페이지를 보던 중 필터를 걸면 결과가 1페이지
 * 뿐일 수 있는데, page를 유지하면 "이 페이지에는 공고가 없습니다"가 뜬다.
 * 필터 변경은 목록의 정체가 바뀌는 일이므로 첫 페이지로 돌아가는 게 맞다.
 *
 * 스타일은 흐름 검증 수준의 최소 형태다. 실제 디자인은 Sprint 2 화면이 모두
 * 잡힌 뒤 일괄 작업한다(/subscribe·카드와 동일한 방침).
 */

/** 한 차원의 선택지. `value: undefined`가 "전체"(그 차원에 제약 없음)다. */
interface FilterOption {
  value: string | undefined;
  label: string;
}

const TYPE_OPTIONS: FilterOption[] = [
  { value: undefined, label: '전체' },
  { value: 'public', label: ANNOUNCEMENT_TYPE_LABEL.public },
  { value: 'private', label: ANNOUNCEMENT_TYPE_LABEL.private },
];

const RECRUITMENT_OPTIONS: FilterOption[] = [
  { value: undefined, label: '전체' },
  { value: 'initial', label: RECRUITMENT_TYPE_LABEL.initial },
  { value: 'additional', label: RECRUITMENT_TYPE_LABEL.additional },
];

export function AnnouncementFilterBar({
  filters,
}: {
  filters: AnnouncementFilters;
}) {
  const current = filtersToSearchParams(filters);

  /**
   * 한 차원만 바꾼 주소를 만든다. 다른 차원은 유지하고 `page`는 넣지 않는다.
   */
  const hrefFor = (param: string, value: string | undefined) => {
    const params = new URLSearchParams(current);
    if (value === undefined) {
      params.delete(param);
    } else {
      params.set(param, value);
    }

    const query = params.toString();
    return query ? `${ANNOUNCEMENTS_PATH}?${query}` : ANNOUNCEMENTS_PATH;
  };

  return (
    <div className="mb-6 flex flex-col gap-2">
      <FilterGroup
        label="유형"
        param={TYPE_PARAM}
        options={TYPE_OPTIONS}
        selected={current[TYPE_PARAM]}
        hrefFor={hrefFor}
      />
      <FilterGroup
        label="모집"
        param={RECRUITMENT_PARAM}
        options={RECRUITMENT_OPTIONS}
        selected={current[RECRUITMENT_PARAM]}
        hrefFor={hrefFor}
      />
    </div>
  );
}

function FilterGroup({
  label,
  param,
  options,
  selected,
  hrefFor,
}: {
  label: string;
  param: string;
  options: FilterOption[];
  /** 현재 선택된 값. 없으면 "전체"가 선택된 상태다. */
  selected: string | undefined;
  hrefFor: (param: string, value: string | undefined) => string;
}) {
  return (
    <nav aria-label={`${label} 필터`} className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-xs text-zinc-500">{label}</span>
      <ul className="flex flex-wrap items-center gap-1">
        {options.map((option) => {
          const isSelected = option.value === selected;

          return (
            <li key={option.value ?? 'all'}>
              {isSelected ? (
                <span
                  aria-current="true"
                  className="rounded-full bg-zinc-900 px-3 py-1 text-sm text-white"
                >
                  {option.label}
                </span>
              ) : (
                <Link
                  href={hrefFor(param, option.value)}
                  className="rounded-full border border-zinc-200 px-3 py-1 text-sm text-zinc-700 hover:bg-zinc-100"
                >
                  {option.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
