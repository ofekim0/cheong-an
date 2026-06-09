/**
 * 크롤링 파이프라인 합성 레이어 (ADR 003 옵션 B 반영).
 *
 * 책임 범위:
 * - JSON 목록 API(bbsListJson.json) 1회 호출로 latestBoardId 산출.
 * - 신규 boardId 전체(= lastBoardId+1 ~ latestBoardId)를 view.do로 직접 호출해
 *   완전한 AnnouncementDetail을 얻는다. JSON 응답에 있든(신규) 없든(gap) 모두 view.do 통일.
 * - 633B 에러 페이지는 skippedBoardIds로 분리.
 * - 각 호출에 rateLimit과 retry를 일관되게 적용.
 * - 호출 순서는 boardId 오름차순 (디버깅·재시도 추적 단순화).
 * - 부트스트랩(lastBoardId=0)에서는 catch-up 루프를 건너뛰고 latestBoardId만 반환
 *   (ADR 005).
 *
 * 책임이 아닌 것:
 * - HTTP 자체 (fetchJsonText / fetchHtml).
 * - 재시도 정책 (retry).
 * - 호출 간 간격 (rateLimit).
 * - JSON / HTML 파싱 (parseListJson, parseDetailPage).
 * - 비존재 boardId 판별 (isViewErrorPage).
 * - DB 저장이나 lastBoardId persistence (호출자의 일).
 *
 * 결정 근거:
 * - ADR 002 옵션 C (하이브리드 데이터 소스 — JSON 주 + view.do 보강).
 * - ADR 003 옵션 B (저장 전 view.do 보강 → 모든 신규는 detail로 통일).
 * - ADR 005 (lastBoardId=0이면 부트스트랩으로 catch-up 생략).
 */

import { fetchHtml, type FetchHtmlOptions } from './fetchHtml';
import { fetchJsonText, type FetchJsonOptions } from './fetchJsonText';
import { withRetry, type RetryOptions } from './retry';
import { createRateLimiter, type RateLimiter } from './rateLimit';
import { parseListJson } from './parseListJson';
import { parseDetailPage } from './parseDetailPage';
import { isViewErrorPage } from './isViewErrorPage';
import type { AnnouncementDetail } from '@/types/announcement';

const DEFAULT_LIST_URL =
  'https://soco.seoul.go.kr/youth/pgm/home/yohome/bbsListJson.json';

const DEFAULT_LIST_BODY: Record<string, string> = {
  bbsId: 'BMSR00015',
  pageIndex: '1',
  searchAdresGu: '',
  searchCondition: '',
  searchKeyword: '',
  optn2: '',
  optn5: '',
};

const DEFAULT_REFERER =
  'https://soco.seoul.go.kr/youth/bbs/BMSR00015/list.do?menuNo=400008';

const DEFAULT_VIEW_URL_BUILDER = (boardId: number): string =>
  `https://soco.seoul.go.kr/youth/bbs/BMSR00015/view.do?boardId=${boardId}&menuNo=400008`;

const DEFAULT_INTERVAL_MS = 1_000;

export interface CrawlAnnouncementsOptions {
  /** 마지막으로 확인한 boardId. 이보다 큰 것만 새 공고 후보. */
  lastBoardId: number;
  /** 호출 간 최소 간격 (ms, 기본 1_000). */
  intervalMs?: number;
  /** JSON API URL (테스트/환경 분리용 override). */
  listUrl?: string;
  /** form body override. */
  listBody?: Record<string, string>;
  /** JSON API fetcher — 테스트에서 MSW로 교체. */
  fetcher?: (url: string, options?: FetchJsonOptions) => Promise<string>;
  /** boardId -> view.do URL 빌더 (테스트 override). */
  buildViewUrl?: (boardId: number) => string;
  /** view.do HTML fetcher — 테스트에서 MSW로 교체. */
  viewFetcher?: (url: string, options?: FetchHtmlOptions) => Promise<string>;
  /** 재시도 옵션 — 미지정 시 retry 모듈 기본값. */
  retryOptions?: RetryOptions;
  /** 외부 주입할 RateLimiter (공유 limiter 패턴). */
  rateLimiter?: RateLimiter;
}

export interface CrawlAnnouncementsResult {
  /**
   * 이번 회차에 새로 발견한 공고의 완전한 detail 목록.
   * - 모든 신규 boardId를 view.do로 확인한 결과.
   * - boardId 오름차순 정렬.
   * - 부트스트랩(lastBoardId=0) 호출에서는 항상 빈 배열.
   */
  newDetails: AnnouncementDetail[];
  /**
   * 응답에서 관측한 가장 큰 boardId.
   * resultList가 비어 있으면 입력 lastBoardId를 그대로 반환.
   */
  latestBoardId: number;
  /**
   * 신규 후보 중 view.do가 633B 에러 페이지로 응답한 boardId.
   * 운영 관찰용(빈 번호가 얼마나 끼는지 추적).
   * boardId 오름차순 정렬.
   */
  skippedBoardIds: number[];
}

export async function crawlNewAnnouncements(
  options: CrawlAnnouncementsOptions,
): Promise<CrawlAnnouncementsResult> {
  const {
    lastBoardId,
    intervalMs = DEFAULT_INTERVAL_MS,
    listUrl = DEFAULT_LIST_URL,
    listBody = DEFAULT_LIST_BODY,
    fetcher = fetchJsonText,
    buildViewUrl = DEFAULT_VIEW_URL_BUILDER,
    viewFetcher = fetchHtml,
    retryOptions,
    rateLimiter = createRateLimiter({ intervalMs }),
  } = options;

  const fetchJsonWithPolicy = (url: string) =>
    rateLimiter.acquire().then(() =>
      withRetry(
        () =>
          fetcher(url, {
            body: listBody,
            headers: { Referer: DEFAULT_REFERER },
          }),
        retryOptions,
      ),
    );

  const fetchViewWithPolicy = (url: string) =>
    rateLimiter
      .acquire()
      .then(() =>
        withRetry(
          () => viewFetcher(url, { headers: { Referer: DEFAULT_REFERER } }),
          retryOptions,
        ),
      );

  // 1) JSON API 1회 호출 → latestBoardId 산출.
  //    JSON 응답은 신규 boardId 발견과 latest 추적 용도만 담당한다(옵션 B).
  const jsonText = await fetchJsonWithPolicy(listUrl);
  const items = parseListJson(jsonText);

  if (items.length === 0) {
    return {
      newDetails: [],
      latestBoardId: lastBoardId,
      skippedBoardIds: [],
    };
  }

  const latestBoardId = items.reduce(
    (max, item) => (item.boardId > max ? item.boardId : max),
    -Infinity,
  );

  // 2) 부트스트랩: lastBoardId=0(마이그레이션 시드)은 "초기 가동" 신호.
  //    과거 게시물은 알림 대상이 아니므로 catch-up 루프를 생략하고
  //    latestBoardId만 반환 → 호출자가 last_board_id에 기록한다(ADR 005).
  if (lastBoardId === 0) {
    return {
      newDetails: [],
      latestBoardId,
      skippedBoardIds: [],
    };
  }

  // 3) 신규 boardId 집합 = lastBoardId+1 ~ latestBoardId 전체.
  //    JSON에 있든(신규) 없든(gap) 모두 view.do로 detail을 확보한다.
  //    오름차순이 곧 자연스러운 호출 순서.
  const newBoardIds: number[] = [];
  for (let id = lastBoardId + 1; id <= latestBoardId; id++) {
    newBoardIds.push(id);
  }

  // 4) 각 boardId를 view.do로 호출.
  //    - 633B 에러 페이지 → 비존재 → skippedBoardIds.
  //    - 정상 → parseDetailPage → newDetails.
  const newDetails: AnnouncementDetail[] = [];
  const skippedBoardIds: number[] = [];

  for (const boardId of newBoardIds) {
    const html = await fetchViewWithPolicy(buildViewUrl(boardId));
    if (isViewErrorPage(html)) {
      skippedBoardIds.push(boardId);
      continue;
    }
    newDetails.push(parseDetailPage(html, boardId));
  }

  return {
    newDetails,
    latestBoardId,
    skippedBoardIds,
  };
}
