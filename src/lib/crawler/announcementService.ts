/**
 * 크롤링 파이프라인 합성 레이어
 *
 * 책임 범위:
 * - JSON 목록 API(bbsListJson.json) 1회 호출로 boardId·본문·메타데이터 일괄 수신.
 * - 각 호출에 rateLimit과 retry를 일관되게 적용.
 * - lastBoardId 초과분만 새 공고로 반환.
 *
 * 책임이 아닌 것:
 * - HTTP 자체 (fetchJsonText).
 * - 재시도 정책 (retry).
 * - 호출 간 간격 (rateLimit).
 * - JSON 파싱 (parseListJson).
 * - view.do 보강 fetch (PR D 이후에 별도 도입 예정).
 * - DB 저장이나 lastBoardId persistence (호출자의 일).
 *
 * 데이터 소스 결정 근거: docs/adr/002-crawling-data-source.md
 */

import { fetchJsonText, type FetchJsonOptions } from './fetchJsonText';
import { withRetry, type RetryOptions } from './retry';
import { createRateLimiter, type RateLimiter } from './rateLimit';
import { parseListJson } from './parseListJson';
import type { AnnouncementListItem } from '@/types/announcement';

/** 청년안심주택 모집공고 목록 JSON API. */
const DEFAULT_LIST_URL =
  'https://soco.seoul.go.kr/youth/pgm/home/yohome/bbsListJson.json';

/** JSON API에 보내는 form body 기본값. bbsId=BMSR00015가 모집공고 게시판. */
const DEFAULT_LIST_BODY: Record<string, string> = {
  bbsId: 'BMSR00015',
  pageIndex: '1',
  searchAdresGu: '',
  searchCondition: '',
  searchKeyword: '',
  optn2: '',
  optn5: '',
};

/** Referer가 없으면 사이트가 거부할 수 있어 동일 출처 list.do를 명시. */
const DEFAULT_REFERER =
  'https://soco.seoul.go.kr/youth/bbs/BMSR00015/list.do?menuNo=400008';

/** 호출 간 기본 간격 - 서버 부담 최소화 + 차단 회피. */
const DEFAULT_INTERVAL_MS = 1_000;

export interface CrawlAnnouncementsOptions {
  /** 마지막으로 확인한 boardId. 이보다 큰 것만 새 공고. */
  lastBoardId: number;
  /** 호출 간 최소 간격 (ms, 기본 1_000). */
  intervalMs?: number;
  /** JSON API URL (테스트/환경 분리용 override). */
  listUrl?: string;
  /** form body override. */
  listBody?: Record<string, string>;
  /** 외부 주입용 fetcher - 테스트에서 MSW 또는 fake로 교체. */
  fetcher?: (url: string, options?: FetchJsonOptions) => Promise<string>;
  /** 재시도 옵션 - 미지정 시 retry 모듈 기본값. */
  retryOptions?: RetryOptions;
  /** 외부 주입할 RateLimiter (여러 service 호출이 같은 limiter를 공유하려면). */
  rateLimiter?: RateLimiter;
}

export interface CrawlAnnouncementsResult {
  /** 이번 회차에 새로 발견한 공고 목록 (boardId > lastBoardId). */
  newAnnouncements: AnnouncementListItem[];
  /**
   * 응답에서 관측한 가장 큰 boardId.
   * 다음 회차의 lastBoardId로 사용한다.
   * resultList가 비어 있으면 입력 lastBoardId를 그대로 반환.
   */
  latestBoardId: number;
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
    listUrl = DEFAULT_LIST_URL,
    listBody = DEFAULT_LIST_BODY,
    fetcher = fetchJsonText,
    retryOptions,
    rateLimiter = createRateLimiter({ intervalMs }),
  } = options;

  const fetchWithPolicy = (url: string) =>
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

  const jsonText = await fetchWithPolicy(listUrl);
  const items = parseListJson(jsonText);

  if (items.length === 0) {
    return { newAnnouncements: [], latestBoardId: lastBoardId };
  }

  const latestBoardId = items.reduce(
    (max, item) => (item.boardId > max ? item.boardId : max),
    -Infinity,
  );
  const newAnnouncements = items.filter((item) => item.boardId > lastBoardId);

  return { newAnnouncements, latestBoardId };
}
