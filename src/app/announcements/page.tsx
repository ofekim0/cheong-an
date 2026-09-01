import type { Metadata } from 'next';

import { AnnouncementCard } from '@/components/announcements/AnnouncementCard';
import { ANNOUNCEMENTS_PAGE_SIZE } from '@/constants/announcements';
import {
  listAnnouncements,
  type AnnouncementListPage,
} from '@/lib/supabase/announcementsRepository';
import { getSupabaseAdminClient } from '@/lib/supabase/client';

/**
 * 공고 목록 페이지 (#83, Step b — 라우트 + ISR).
 *
 * 열람은 공개다(비로그인 허용, ADR 009). 구독 액션만 인증을 요구한다.
 *
 * 조회는 service role 클라이언트로 서버에서만 한다 — `announcements` 테이블은
 * GRANT도 RLS도 없어 anon 키 직접 조회가 401이며(#83 선결 확인), 이 페이지는
 * SSG + ISR이라 브라우저는 완성된 HTML만 받는다. Step c의 필터·페이지네이션도
 * 클라이언트 직결 쿼리 대신 URL searchParams + 서버 컴포넌트로 처리한다.
 *
 * Step b는 첫 페이지만 렌더한다. page 파싱과 페이지네이션 UI는 Step c —
 * 그때 `listAnnouncements`가 범위 초과 page를 빈 페이지 + 실제 total로 돌려주는
 * 계약(throw 아님)을 받아 404·리다이렉트를 판단한다.
 */

/**
 * ISR 안전망: 최대 1시간까지 캐시된 HTML을 재사용한다.
 *
 * 정상 경로에서는 크롤이 새 공고를 저장한 직후 `/api/cron/crawl`이
 * revalidatePath로 즉시 무효화하므로 1시간을 기다리지 않는다. 이 값은 그 트리거가
 * 실패했을 때를 위한 상한이다. 크롤 주기도 1시간이라 실질 지연은 크롤 주기 이내로
 * 수렴한다.
 *
 * 리터럴이어야 한다 — Next가 빌드 시점에 정적 분석한다.
 */
export const revalidate = 3600;

export const metadata: Metadata = {
  title: '공고 목록 — 청안',
  description: '청년안심주택 모집공고를 최신순으로 확인하세요.',
};

/**
 * 첫 페이지를 조회한다.
 *
 * Supabase 자격 증명이 없으면 조회를 건너뛰고 빈 목록을 돌려준다. 이 페이지는
 * 빌드 시점에 프리렌더되는데 CI(`.github/workflows/ci.yml`)는 env 없이
 * `pnpm build`를 돌리므로, 그대로 두면 자격 증명 부재가 빌드 실패가 된다.
 * env 부재만 좁게 흡수하고 조회 자체의 실패(네트워크·권한·쿼리 오류)는 그대로
 * throw해 에러 페이지로 표면화한다 — DB 장애를 "공고 없음"으로 위장하지 않는다.
 *
 * 프로덕션 빌드(Vercel)는 env가 주입돼 있어 실데이터로 프리렌더된다.
 */
async function fetchFirstPage(): Promise<AnnouncementListPage> {
  const hasCredentials = Boolean(
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  if (!hasCredentials) {
    console.warn(
      '[announcements] Supabase 자격 증명이 없어 빈 목록으로 렌더합니다. ' +
        '(env 없는 빌드 환경에서만 기대되는 경로)',
    );
    return { items: [], total: 0 };
  }

  return listAnnouncements(getSupabaseAdminClient(), {
    page: 1,
    pageSize: ANNOUNCEMENTS_PAGE_SIZE,
  });
}

export default async function AnnouncementsPage() {
  const { items, total } = await fetchFirstPage();

  return (
    <main className="mx-auto w-full max-w-2xl p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">공고 목록</h1>
        <p className="mt-1 text-sm text-zinc-600">전체 {total}건</p>
      </header>

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
        <p className="text-sm text-zinc-500">아직 등록된 공고가 없습니다.</p>
      )}
    </main>
  );
}
