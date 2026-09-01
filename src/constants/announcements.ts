/**
 * 공고 목록 화면 상수 (#83).
 *
 * revalidate 주기는 여기 두지 않는다 — Next가 세그먼트 설정을 빌드 시점에 정적
 * 분석하므로 `export const revalidate`는 반드시 리터럴이어야 하고, import한
 * 값으로는 동작하지 않는다.
 */

/** 목록 한 페이지에 표시할 공고 수. Step c의 페이지네이션 UI가 총 페이지 계산에 함께 쓴다. */
export const ANNOUNCEMENTS_PAGE_SIZE = 20;

/**
 * 공고 목록 페이지 경로.
 *
 * 페이지가 자기 위치를 아는 것으로는 부족하다 — 크롤 라우트가 저장 직후 이 경로의
 * ISR 캐시를 무효화해야 하므로(revalidatePath), 문자열이 두 곳에서 어긋나지 않도록
 * 한곳에 둔다.
 */
export const ANNOUNCEMENTS_PATH = '/announcements';
