import Link from 'next/link';

import { ANNOUNCEMENTS_PATH } from '@/constants/announcements';

/**
 * 공고 목록 페이지네이션 (#83, Step c-2).
 *
 * 서버 컴포넌트 — 이동이 전부 URL 링크라 클라이언트 상태가 없다. 덕분에 각 페이지가
 * 공유·북마크 가능한 주소를 가지고, 뒤로 가기가 그대로 동작한다.
 *
 * 1페이지는 `?page=1`을 붙이지 않는다. 같은 내용이 두 주소(`/announcements`와
 * `?page=1`)로 갈리면 캐시 항목도 둘로 나뉘고 canonical URL도 모호해진다.
 *
 * 페이지 번호를 생략 부호 없이 전부 렌더한다 — 현재 데이터가 68건·페이지당 20건이라
 * 총 4페이지 규모다. 수백 페이지가 되기 전까지 생략 로직은 순수한 복잡도다.
 */
export function AnnouncementPagination({
  currentPage,
  totalPages,
  baseParams,
}: {
  currentPage: number;
  totalPages: number;
  /** page 외의 현재 쿼리(필터 등). 페이지를 옮겨도 유지된다. */
  baseParams?: Record<string, string>;
}) {
  if (totalPages <= 1) {
    return null;
  }

  const hrefForPage = (page: number) => {
    const params = new URLSearchParams(baseParams);
    if (page > 1) {
      params.set('page', String(page));
    }
    const query = params.toString();
    return query ? `${ANNOUNCEMENTS_PATH}?${query}` : ANNOUNCEMENTS_PATH;
  };

  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);

  return (
    <nav aria-label="페이지 이동" className="mt-8 flex justify-center">
      <ul className="flex items-center gap-1">
        <li>
          {currentPage > 1 ? (
            <Link
              href={hrefForPage(currentPage - 1)}
              rel="prev"
              className="rounded px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
            >
              이전
            </Link>
          ) : (
            <span
              aria-hidden="true"
              className="px-3 py-2 text-sm text-zinc-300"
            >
              이전
            </span>
          )}
        </li>

        {pages.map((page) => (
          <li key={page}>
            {page === currentPage ? (
              <span
                aria-current="page"
                className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white"
              >
                {page}
              </span>
            ) : (
              <Link
                href={hrefForPage(page)}
                className="rounded px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
              >
                {page}
              </Link>
            )}
          </li>
        ))}

        <li>
          {currentPage < totalPages ? (
            <Link
              href={hrefForPage(currentPage + 1)}
              rel="next"
              className="rounded px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
            >
              다음
            </Link>
          ) : (
            <span
              aria-hidden="true"
              className="px-3 py-2 text-sm text-zinc-300"
            >
              다음
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
