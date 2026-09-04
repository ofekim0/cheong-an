/**
 * 공고 목록 화면 상수 (#83).
 *
 * 캐시 수명(`cacheLife`)은 여기 두지 않는다 — 페이지 쪽 `'use cache'` 함수에
 * 프로파일 이름으로 직접 적는다(ADR 013).
 */

/** 목록 한 페이지에 표시할 공고 수. Step c의 페이지네이션 UI가 총 페이지 계산에 함께 쓴다. */
export const ANNOUNCEMENTS_PAGE_SIZE = 20;

/** 공고 목록 페이지 경로. 홈의 링크와 목록 내부 페이지네이션 링크가 공유한다. */
export const ANNOUNCEMENTS_PATH = '/announcements';

/**
 * 공고 상세 페이지 경로 (#96).
 *
 * 목록 카드와 알림 URL 빌더가 공유한다 — 둘이 같은 곳을 가리켜야 하고,
 * 경로 문자열이 갈라지면 한쪽만 404가 된다.
 */
export function buildAnnouncementPath(boardId: number): string {
  return `${ANNOUNCEMENTS_PATH}/${boardId}`;
}

/**
 * 공고 조회 캐시에 붙이는 태그. 목록(전량 요약 1건, ADR 015)과 상세(boardId별
 * 항목, #96)가 공유한다.
 *
 * 크롤 라우트가 새 공고를 저장한 직후 이 태그를 무효화한다(ADR 013). 경로가 아니라
 * 태그를 쓰는 이유: 상세 캐시가 boardId마다 따로 생기는데 경로 무효화로는 그
 * 항목들을 지목할 수 없다. 태그는 항목 수와 무관하게 한 번에 전부 무효화한다.
 * (ADR 013 시점에는 목록도 쿼리 조합별 항목이었다 — ADR 015로 1건이 됐다.)
 *
 * 문자열이 어긋나면 조용히 실패하므로(무효화가 아무것도 안 지운다) 한곳에 둔다.
 */
export const ANNOUNCEMENTS_CACHE_TAG = 'announcements';
