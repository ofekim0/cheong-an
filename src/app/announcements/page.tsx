import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import { Suspense } from 'react';

import { AnnouncementCard } from '@/components/announcements/AnnouncementCard';
import { AnnouncementFilterBar } from '@/components/announcements/AnnouncementFilterBar';
import { AnnouncementPagination } from '@/components/announcements/AnnouncementPagination';
import {
  ANNOUNCEMENTS_CACHE_TAG,
  ANNOUNCEMENTS_PAGE_SIZE,
} from '@/constants/announcements';
import {
  filtersToSearchParams,
  parseAnnouncementFilters,
  parsePageParam,
  PAGE_PARAM,
} from '@/lib/announcements/parseListParams';
import {
  listAnnouncements,
  type AnnouncementFilters,
  type AnnouncementListPage,
} from '@/lib/supabase/announcementsRepository';
import { getSupabaseAdminClient } from '@/lib/supabase/client';

/**
 * 공고 목록 페이지 (#83, Step c-2 페이지네이션 + Cache Components / c-3 필터).
 *
 * 열람은 공개다(비로그인 허용, ADR 009). 구독 액션만 인증을 요구한다.
 *
 * 조회는 service role 클라이언트로 서버에서만 한다 — `announcements` 테이블은
 * GRANT도 RLS도 없어 anon 키 직접 조회가 401이며(#83 선결 확인), 브라우저는
 * 렌더된 HTML만 받는다.
 *
 * 렌더링 모델은 Cache Components(PPR, ADR 013)다. `searchParams`는 request-time
 * API라 페이지 최상단에서 읽으면 라우트 전체가 동적 렌더링이 되고 캐시가 통째로
 * 사라진다. 그래서 페이지 컴포넌트는 async가 아니고 searchParams를 await하지
 * 않는다 — promise를 Suspense 하위로 내려보내 거기서 읽는다. 헤더는 static
 * shell에 남고, 목록만 요청 시점에 스트리밍된다.
 */

export const metadata: Metadata = {
  title: '공고 목록 — 청안',
  description: '청년안심주택 모집공고를 최신순으로 확인하세요.',
};

/**
 * 한 페이지를 조회한다. 결과는 `page`와 `filters`를 키로 캐시된다.
 *
 * `remote`인 이유: 이 함수는 `searchParams`를 읽은 뒤에 호출되므로 결과가 static
 * shell에 들어가지 못하고 요청 시점으로 밀린다. 그냥 `'use cache'`면 인스턴스별
 * 인메모리 캐시라 서버리스에서 인스턴스 간 공유가 안 되고, 적중률이 낮아 크롤이
 * 태그를 무효화하는 설계 자체가 무의미해진다. 캐시 키 조합은 페이지 수 × 필터
 * 조합으로 작고 데이터는 시간 단위로만 바뀌어 적중률 조건도 맞는다.
 *
 * 캐시 키에는 인자가 포함되므로 페이지·필터 조합마다 항목이 따로 생긴다.
 * `filters`의 키 삽입 순서는 `parseAnnouncementFilters`가 고정하므로 같은 조건이
 * 매번 같은 키로 떨어진다.
 * 무효화는 경로가 아니라 태그로 한다 — 크롤 라우트가 새 공고를 저장한 직후
 * `ANNOUNCEMENTS_CACHE_TAG`를 무효화하면 페이지·필터 조합 수와 무관하게 전부
 * 한 번에 만료된다(ADR 013).
 *
 * `cacheLife('hours')`는 그 무효화가 실패했을 때를 위한 상한이다. 크롤 주기도
 * 1시간이라 정상 경로의 반영 지연은 크롤 주기 이내로 수렴한다.
 *
 * Step b에 있던 "Supabase 자격 증명 부재 시 빈 목록" 가드는 제거했다. 그 가드는
 * env 없이 `pnpm build`를 돌리는 CI에서 빌드가 깨지는 것을 막기 위한 것이었는데,
 * PPR에서는 이 조회가 `searchParams` 뒤에 있어 빌드 시점 프리렌더가 아예 호출하지
 * 않는다(env 없는 빌드로 확인 — 경고 로그가 찍히지 않는다). 근거가 사라진 가드를
 * 남겨두면 자격 증명이 빠진 배포가 에러 대신 "공고 없음"으로 위장된다.
 * `getSupabaseAdminClient()`가 이미 어떤 env가 없는지 짚어 throw한다.
 */
async function fetchAnnouncementPage(
  page: number,
  filters: AnnouncementFilters,
): Promise<AnnouncementListPage> {
  'use cache: remote';
  cacheLife('hours');
  cacheTag(ANNOUNCEMENTS_CACHE_TAG);

  return listAnnouncements(getSupabaseAdminClient(), {
    page,
    pageSize: ANNOUNCEMENTS_PAGE_SIZE,
    filters,
  });
}

/**
 * `searchParams` prop 타입.
 *
 * Next가 생성하는 전역 `PageProps<'/announcements'>` 헬퍼를 쓰지 않는다 — 그 타입은
 * `next dev`·`next build`·`next typegen`이 `.next/types`에 만들어내므로, **빌드 전에
 * `tsc --noEmit`을 돌리는 환경에서 `TS2304: Cannot find name 'PageProps'`로 깨진다.**
 * CI는 typecheck를 build보다 먼저 돌리고, 갓 클론한 저장소도 같은 상태다.
 * 이 라우트는 동적 세그먼트가 없어 헬퍼의 라우트 리터럴 타이핑이 주는 이점도 없다.
 */
type AnnouncementsSearchParams = Promise<{
  [key: string]: string | string[] | undefined;
}>;

/** 목록 로딩 중 static shell에 실려 나가는 자리표시자. */
function AnnouncementListFallback() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="h-24 animate-pulse rounded bg-zinc-100" />
      ))}
    </div>
  );
}

/**
 * `searchParams`를 여기서 읽는다 — Suspense 경계 안이라 헤더는 static shell로 남는다.
 */
async function AnnouncementList({
  searchParams,
}: {
  searchParams: AnnouncementsSearchParams;
}) {
  const params = await searchParams;
  const page = parsePageParam(params[PAGE_PARAM]);
  const filters = parseAnnouncementFilters(params);

  const { items, total } = await fetchAnnouncementPage(page, filters);
  const totalPages = Math.max(1, Math.ceil(total / ANNOUNCEMENTS_PAGE_SIZE));
  const hasFilters = Object.keys(filters).length > 0;

  return (
    <>
      <AnnouncementFilterBar filters={filters} />

      <p className="mb-6 text-sm text-zinc-600">
        {hasFilters ? '조건에 맞는 공고' : '전체'} {total}건
      </p>

      {items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {items.map((announcement) => (
            <AnnouncementCard
              key={announcement.boardId}
              announcement={announcement}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">
          {emptyMessage(total, hasFilters)}
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

/**
 * 목록이 빈 이유를 구분해 알린다.
 *
 * "공고가 하나도 없다"와 "필터에 걸리는 게 없다"와 "이 페이지 번호가 범위를
 * 넘었다"는 사용자가 취할 행동이 다르다 — 각각 기다리기, 필터 풀기, 앞 페이지로
 * 돌아가기다. 한 문구로 뭉치면 필터가 걸린 걸 잊은 방문자가 서비스가 비었다고
 * 오해한다.
 */
function emptyMessage(total: number, hasFilters: boolean): string {
  if (total > 0) {
    return '이 페이지에는 공고가 없습니다.';
  }
  return hasFilters
    ? '조건에 맞는 공고가 없습니다.'
    : '아직 등록된 공고가 없습니다.';
}

export default function AnnouncementsPage({
  searchParams,
}: {
  searchParams: AnnouncementsSearchParams;
}) {
  return (
    <main className="mx-auto w-full max-w-2xl p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">공고 목록</h1>
      </header>

      <Suspense fallback={<AnnouncementListFallback />}>
        <AnnouncementList searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
