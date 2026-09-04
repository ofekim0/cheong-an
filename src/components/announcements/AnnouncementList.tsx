'use client';

import { useSearchParams } from 'next/navigation';

import { AnnouncementCard } from '@/components/announcements/AnnouncementCard';
import { AnnouncementFilterBar } from '@/components/announcements/AnnouncementFilterBar';
import { AnnouncementPagination } from '@/components/announcements/AnnouncementPagination';
import { ANNOUNCEMENTS_PAGE_SIZE } from '@/constants/announcements';
import {
  hasActiveFilters,
  selectListPage,
} from '@/lib/announcements/filterAnnouncements';
import {
  listCountLabel,
  listEmptyMessage,
} from '@/lib/announcements/formatAnnouncement';
import {
  filtersToSearchParams,
  parseListQuery,
} from '@/lib/announcements/parseListParams';
import type { AnnouncementSummary } from '@/types/announcement';

/**
 * 공고 목록 본문 — URL이 결정하는 필터·페이지를 브라우저에서 계산한다 (#106, ADR 015).
 *
 * 전량 요약(`items`)은 서버가 static shell에 실어 props로 넘긴다. 이 컴포넌트는
 * `useSearchParams`로 URL을 읽어 그중 보여줄 것을 고르는 일만 한다 — 필터·페이지
 * 클릭은 `ListLink`가 `pushState`로 URL만 바꾸고, 라우터가 `useSearchParams`를
 * 갱신하면 여기서 다시 고른다. 서버 요청은 없다.
 *
 * 파싱·선택 규칙은 전부 `lib/announcements`에 있고 테스트가 거기 붙어 있다. 이
 * 컴포넌트에는 분기가 없어야 한다 — 분기가 생기면 `lib`으로 내린다(컴포넌트 테스트
 * 도구를 두지 않는 테스트 원칙).
 *
 * `useSearchParams`는 Cache Components 빌드에서 Suspense 경계를 요구한다. 부모
 * (`page.tsx`)가 감싼다. 프리렌더 시 이 하위 트리는 클라이언트 렌더로 빠져 shell에는
 * fallback이 실리고, 하이드레이션 직후 URL대로 그려진다 — 데이터는 이미 페이로드에
 * 있어 서버 왕복은 없다.
 */
export function AnnouncementList({
  items,
}: {
  items: readonly AnnouncementSummary[];
}) {
  const searchParams = useSearchParams();
  const { page, filters } = parseListQuery(searchParams);
  const {
    items: pageItems,
    total,
    totalPages,
  } = selectListPage(items, {
    page,
    pageSize: ANNOUNCEMENTS_PAGE_SIZE,
    filters,
  });
  const hasFilters = hasActiveFilters(filters);

  return (
    <>
      <AnnouncementFilterBar filters={filters} />

      <p className="mb-6 text-sm text-zinc-600">
        {listCountLabel(total, hasFilters)}
      </p>

      {pageItems.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {pageItems.map((announcement) => (
            <AnnouncementCard
              key={announcement.boardId}
              announcement={announcement}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">
          {listEmptyMessage(total, hasFilters)}
        </p>
      )}

      <AnnouncementPagination
        currentPage={page}
        totalPages={totalPages}
        baseParams={filtersToSearchParams(filters)}
      />
    </>
  );
}
