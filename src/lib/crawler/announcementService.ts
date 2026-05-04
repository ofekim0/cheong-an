/**
 * 크롤링 파이프라인 합성 레이어
 *
 * 책임 범위:
 * - 메인 페이지 1회 fetch -> 새 boardId 후보 산출 -> 각 후보의 상세 fetch+parse.
 * - 각 HTTP 호출에 rateLimit과 retry를 일관되게 적용.
 * - 후보 중 404는 "존재하지 않는 빈 번호"로 보고 건너뜀.
 *
 * 책임이 아닌 것:
 * - HTTP 자체 (fetchHtml).
 * - 재시도 정책 (retry).
 * - 호출 간 간격 (rateLimit).
 * - HTML 파싱 (parseMainPage / parseDetailPage).
 * - DB 저장이나 lastBoardId persistence (호출자의 일).
 */

import { fetchHtml, HttpError, type FetchHtmlOptions } from './fetchHtml';
import { withRetry, type RetryOptions } from './retry';
import { createRateLimiter, type RateLimiter } from './rateLimit';
import { parseMainPage } from './parseMainPage';
import { parseDetailPage } from './parseDetailPage';
import { findNewBoardIds } from './checkBoardId';
import type { AnnouncementDetail } from '@/types/announcement';

/** 청년안심주택 모집공고 메인 페이지. (운영 URL 확정 시 갱신) */
const DEFAULT_MAIN_PAGE_URL =
  'https://soco.seoul.go.kr/youth/pgm/home/yohome/bbsListJ.do?menuNo=400008';

/** 상세 페이지 URL 빌더 - boardId 외 파라미터는 메인과 동일 */
const DEFAULT_DETAIL_URL_BUILDER = (boardId: number): string =>
  `https://soco.seoul.go.kr/youth/pgm/home/yohome/bbsView.do?menuNo=400008&boardId=${boardId}`;

/** 호출 간 기본 간격 - 서버 부담 최소화 + 차단 회피 */
const DEFAULT_INTERVAL_MS = 1_000;

export interface CrawlAnnouncementsOptions {
  /** 마지막으로 확인한 boardId. 이보다 큰 것만 새 공고 */
  lastBoardId: number;
  /** 호출 간 최소 간격 (ms, 기본 1_000) */
  intervalMs?: number;
  /** 메인 페이지 URL (테스트/환경 분리용 override) */
  mainPageUrl?: string;
  /** boardId -> 상세 URL 변환기 */
  buildDetailUrl?: (boardId: number) => string;
  /** HTTP fetch 구현 - 테스트에서 MSW 또는 fake로 교체 */
  fetcher?: (url: string, options?: FetchHtmlOptions) => Promise<string>;
  /** 재시도 옵션 - 미지정 시 retry 모듈 기본값. */
  retryOptions?: RetryOptions;
  /**
   * 외부에서 주입할 RateLimiter.
   * 미지정 시 intervalMs로 새 인스턴스를 만든다.
   * (여러 service 호출이 같은 limiter를 공유해야 하면 직접 주입.)
   */
  rateLimiter?: RateLimiter;
}

export interface CrawlAnnouncementsResult {
  /** 이번 회차에 새로 발견한 공고 상세. */
  newAnnouncements: AnnouncementDetail[];
  /**
   * 메인 페이지에서 관측한 가장 큰 boardId.
   * 다음 회차의 lastBoardId로 사용해 같은 후보를 다시 찾지 않게 한다.
   * 메인이 비어 있으면 입력 lastBoardId를 그대로 반환
   */
  latestBoardId: number;
  /**
   * 후보였지만 404로 존재하지 않는 boardId.
   * 운영 관찰용 (얼마나 빈 번호가 끼어있는지 모니터링).
   */
  skippedBoardIds: number[];
}

/**
 * 새 공고를 한 회차 분 크롤링한다.
 *
 * 합성 순서: rateLimit OUTSIDE retry.
 *  - acquire()로 호출 슬롯을 잡은 뒤 withRetry가 안에서 시도/대기/재시도.
 *  - 재시도 백오프와 호출 간격이 서로 간섭하지 않는다.
 */
export async function crawlNewAnnouncements(
  options: CrawlAnnouncementsOptions,
): Promise<CrawlAnnouncementsResult> {
  const {
    lastBoardId,
    intervalMs = DEFAULT_INTERVAL_MS,
    mainPageUrl = DEFAULT_MAIN_PAGE_URL,
    buildDetailUrl = DEFAULT_DETAIL_URL_BUILDER,
    fetcher = fetchHtml,
    retryOptions,
    rateLimiter = createRateLimiter({ intervalMs }),
  } = options;

  const fetchWithPolicy = (url: string) =>
    rateLimiter
      .acquire()
      .then(() => withRetry(() => fetcher(url), retryOptions));

  // 1) 메인 페이지 -> 후보 산출
  const mainHtml = await fetchWithPolicy(mainPageUrl);
  const summaries = parseMainPage(mainHtml);

  if (summaries.length === 0) {
    return {
      newAnnouncements: [],
      latestBoardId: lastBoardId,
      skippedBoardIds: [],
    };
  }

  const observedIds = summaries.map((s) => s.boardId);
  const latestBoardId = Math.max(...observedIds);
  const candidates = findNewBoardIds(observedIds, lastBoardId);

  // 2) 후보 상세 순회 (직렬: limiter가 어차피 간격을 강제하므로 병렬 이득 없음)
  const newAnnouncements: AnnouncementDetail[] = [];
  const skippedBoardIds: number[] = [];

  for (const boardId of candidates) {
    try {
      const detailHtml = await fetchWithPolicy(buildDetailUrl(boardId));
      newAnnouncements.push(parseDetailPage(detailHtml, boardId));
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        // 빈 번호 - 정상 케이스
        skippedBoardIds.push(boardId);
        continue;
      }
      // 그 외 에러는 호출자에게 전파 (한 회차 실패 = 다음 스케줄에서 재시도)
      throw err;
    }
  }

  return { newAnnouncements, latestBoardId, skippedBoardIds };
}
