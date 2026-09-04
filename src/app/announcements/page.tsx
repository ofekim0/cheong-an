import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import { Suspense } from 'react';

import { AnnouncementList } from '@/components/announcements/AnnouncementList';
import { ANNOUNCEMENTS_CACHE_TAG } from '@/constants/announcements';
import { listAllAnnouncementSummaries } from '@/lib/supabase/announcementsRepository';
import { getSupabaseAdminClient } from '@/lib/supabase/client';
import type { AnnouncementSummary } from '@/types/announcement';

/**
 * 공고 목록 페이지 (#83 → #106, ADR 015).
 *
 * 열람은 공개다(비로그인 허용, ADR 009). 구독 액션만 인증을 요구한다.
 *
 * 조회는 service role 클라이언트로 서버에서만 한다 — `announcements` 테이블은
 * GRANT도 RLS도 없어 anon 키 직접 조회가 401이며(#83 선결 확인), 브라우저는
 * 렌더된 결과만 받는다.
 *
 * **데이터 전달 모델(ADR 015)**: 전량 요약을 한 번에 읽어 static shell에 임베드하고,
 * 필터·페이지네이션은 `AnnouncementList`(클라이언트)가 URL을 읽어 브라우저에서
 * 계산한다. 이 페이지는 `searchParams`를 **읽지 않는다** — request-time 값을 읽지
 * 않으므로 조회 결과가 빌드 산출물에 들어가고, 필터·페이지 클릭은 서버 왕복 없이
 * URL만 바꾼다(`ListLink`). 이전 모델(ADR 013: `searchParams`를 Suspense 하위에서
 * 읽고 조합별로 `'use cache: remote'`)은 클릭마다 서버 응답을 기다려야 했다.
 */

export const metadata: Metadata = {
  title: '공고 목록 — 청안',
  description: '청년안심주택 모집공고를 최신순으로 확인하세요.',
};

/**
 * 전량 요약을 조회한다. 캐시 항목은 하나다(인자가 없다).
 *
 * `'use cache'`이고 `remote`가 아닌 이유(ADR 015 세부 판단 1): 이 호출은 request-time
 * 값 앞에 있어 프리렌더 때 실행되고 결과가 static shell의 일부로 CDN에서 나간다.
 * ADR 013이 remote를 택한 근거("`searchParams` 뒤에 있어 요청 시점으로 밀린다")가
 * 여기서는 성립하지 않는다.
 *
 * 무효화는 태그로 한다 — 크롤 라우트가 새 공고를 저장한 직후 `ANNOUNCEMENTS_CACHE_TAG`를
 * `{ expire: 0 }`으로 만료시키면 다음 요청에서 shell이 다시 만들어진다. 태그는 상세
 * 페이지(boardId별 항목)와 공유한다. `cacheLife('hours')`는 그 무효화가 실패했을 때의
 * 상한이다.
 *
 * 빌드가 실제로 DB를 읽는다 — CI `pnpm build`에는 test 프로젝트 자격 증명이
 * 주입된다(ADR 015 세부 판단 4). env가 없으면 `getSupabaseAdminClient()`가 어떤
 * 변수가 빠졌는지 짚어 throw하고 빌드가 실패한다. 빈 목록으로 위장하는 폴백은
 * 두지 않는다(ADR 013 배제한 접근).
 */
async function fetchAllAnnouncements(): Promise<AnnouncementSummary[]> {
  'use cache';
  cacheLife('hours');
  cacheTag(ANNOUNCEMENTS_CACHE_TAG);

  return listAllAnnouncementSummaries(getSupabaseAdminClient());
}

/**
 * 목록 자리표시자. `useSearchParams`를 쓰는 하위 트리는 프리렌더 시 클라이언트 렌더로
 * 빠지므로 static shell에는 이것이 실리고, 하이드레이션 직후 URL대로 그려진다.
 */
function AnnouncementListFallback() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="h-24 animate-pulse rounded bg-zinc-100" />
      ))}
    </div>
  );
}

export default async function AnnouncementsPage() {
  const items = await fetchAllAnnouncements();

  return (
    <main className="mx-auto w-full max-w-2xl p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">공고 목록</h1>
      </header>

      <Suspense fallback={<AnnouncementListFallback />}>
        <AnnouncementList items={items} />
      </Suspense>
    </main>
  );
}
