/**
 * 크롤링 파이프라인 합성 레이어 (ADR 007 — 목록 기반 크롤).
 *
 * 책임 범위:
 * - JSON 목록 API(bbsListJson.json)를 호출해 BMSR00015에 실제 존재하는
 *   boardId만 신규 후보로 삼는다. boardId는 게시판을 가로지르는 전역 시퀀스라
 *   숫자 gap을 채우면 타 게시판(BMSR00013 등) 공고가 섞이므로 gap-fill을 폐기한다.
 * - 폴링 사이 1페이지를 넘겨 밀려난 신규를 보전하기 위해, 페이지 최소 boardId가
 *   아직 lastBoardId보다 크고 다음 페이지가 있으면 추가 페이지를 조회한다.
 * - 신규 boardId마다 view.do를 호출해 완전한 AnnouncementDetail을 얻는다(ADR 003 옵션 B).
 * - 633B 에러 페이지는 skippedBoardIds로 분리.
 * - 저장 전 파서 불변식(checkDetailInvariants)을 통과하지 못한 detail은
 *   invalidBoardIds로 격리한다 — 단일 불량 row가 배치 전체를 실패시켜 파이프라인을
 *   동결시키는 것을 막는다(ADR 006/007).
 * - 목록 파싱 단계에서 row 단위로 격리된 항목(parseListJson.isolated)은
 *   isolatedListRows로 표면화한다. latestBoardId는 격리 row의 boardId도 포함해
 *   전진한다 — 미포함이면 격리 항목이 매 회차 재관측되므로, 상세 경로
 *   invalidBoardIds와 같은 수준에서 알림 유실을 수용한다(ADR 012).
 * - 각 호출에 rateLimit과 retry를 일관되게 적용. 호출 순서는 boardId 오름차순.
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
 * - ADR 007 (전역 boardId gap-fill 폐기, 목록에 존재하는 boardId만 크롤).
 * - ADR 012 (목록 파서 row 격리 — 격리 vs 중단 경계).
 */

import { fetchHtml, type FetchHtmlOptions } from './fetchHtml';
import { fetchJsonText, type FetchJsonOptions } from './fetchJsonText';
import { withRetry, type RetryOptions } from './retry';
import { createRateLimiter, type RateLimiter } from './rateLimit';
import {
  parseListJson,
  parseTotalPages,
  type IsolatedListRow,
  type ParseListJsonResult,
} from './parseListJson';
import { parseDetailPage } from './parseDetailPage';
import { isViewErrorPage } from './isViewErrorPage';
import { checkDetailInvariants } from './parserInvariants';
import type {
  AnnouncementDetail,
  AnnouncementListItem,
} from '@/types/announcement';

/** 페이지네이션 폭주 방지 상한 (정상 운영에선 1페이지로 충분). */
const MAX_LIST_PAGES = 20;

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
   * - 목록에 존재하는 신규 boardId를 view.do로 확인하고 불변식을 통과한 결과.
   * - boardId 오름차순 정렬.
   * - 부트스트랩(lastBoardId=0) 호출에서는 항상 빈 배열.
   */
  newDetails: AnnouncementDetail[];
  /**
   * 응답에서 관측한 가장 큰 boardId (격리 row 포함 — ADR 012).
   * 유효 항목이 0건이면(빈 resultList 또는 전 항목 격리) 입력 lastBoardId를
   * 그대로 반환해 전진시키지 않는다.
   */
  latestBoardId: number;
  /**
   * 신규 후보 중 view.do가 633B 에러 페이지로 응답한 boardId.
   * 운영 관찰용(목록·상세 사이 경쟁 상황 추적).
   * boardId 오름차순 정렬.
   */
  skippedBoardIds: number[];
  /**
   * view.do는 정상이었으나 파서 불변식(checkDetailInvariants)을 위반해 저장에서
   * 제외한 boardId. 사이트 구조 변경이나 예외적 공고 형식 신호 — 운영 관찰용.
   * boardId 오름차순 정렬.
   */
  invalidBoardIds: number[];
  /**
   * 목록 파싱 단계에서 row 단위 실패로 격리된 항목 (ADR 012).
   * 국지적 오입력 신호 — 운영 관찰용. latestBoardId는 격리 row의 boardId도
   * 포함해 전진하므로 격리 항목은 다음 회차에 재관측되지 않는다(알림 유실 수용).
   */
  isolatedListRows: IsolatedListRow[];
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

  const fetchListPage = (pageIndex: number) =>
    rateLimiter.acquire().then(() =>
      withRetry(
        () =>
          fetcher(listUrl, {
            body: { ...listBody, pageIndex: String(pageIndex) },
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

  // 1) 목록 1페이지 호출 → latestBoardId 산출.
  const firstText = await fetchListPage(1);
  const firstPage = parseListJson(firstText);

  if (firstPage.items.length === 0) {
    // 유효 항목 0건 = 빈 resultList(키 소실) 또는 전 항목 격리 — 둘 다 전면 붕괴
    // 신호다. latestBoardId를 전진시키지 않아 다음 회차에 재관측되게 두고,
    // 카나리의 LIST_EMPTY가 500으로 잡게 한다 (ADR 006/012 경계).
    return {
      newDetails: [],
      latestBoardId: lastBoardId,
      skippedBoardIds: [],
      invalidBoardIds: [],
      isolatedListRows: firstPage.isolated,
    };
  }

  // 격리 row의 boardId도 latest 산출에 포함한다 — 최신 항목이 격리되면 그
  // boardId를 넘기지 못해 매 회차 재관측되므로(영구 노이즈), 알림 유실을
  // 수용하고 전진시킨다 (ADR 012).
  const latestBoardId = maxBoardId(firstPage);

  // 2) 부트스트랩: lastBoardId=0(마이그레이션 시드)은 "초기 가동" 신호.
  //    과거 게시물은 알림 대상이 아니므로 catch-up 루프를 생략하고
  //    latestBoardId만 반환 → 호출자가 last_board_id에 기록한다(ADR 005).
  if (lastBoardId === 0) {
    return {
      newDetails: [],
      latestBoardId,
      skippedBoardIds: [],
      invalidBoardIds: [],
      isolatedListRows: firstPage.isolated,
    };
  }

  // 3) 신규 후보 = 목록에 존재하고 boardId > lastBoardId인 **유효** 항목 (ADR 007/012).
  //    숫자 gap은 채우지 않는다 — 전역 시퀀스라 타 게시판 공고가 섞이기 때문.
  //    1페이지 최소 boardId(=가장 오래된 항목)가 아직 lastBoardId보다 크면 신규가 페이지를 넘쳤을 수
  //    있으므로, 다음 페이지가 있는 한 추가로 조회해 누락을 보전한다.
  const { boardIds: newBoardIds, isolated: isolatedListRows } =
    await collectNewBoardIds({
      lastBoardId,
      firstText,
      firstPage,
      fetchListPage,
    });

  // 4) 각 신규 boardId를 view.do로 호출.
  //    - 633B 에러 페이지 → skippedBoardIds.
  //    - 정상이나 불변식 위반 → invalidBoardIds (저장 제외, 격리).
  //    - 정상 + 불변식 통과 → newDetails.
  const newDetails: AnnouncementDetail[] = [];
  const skippedBoardIds: number[] = [];
  const invalidBoardIds: number[] = [];

  for (const boardId of newBoardIds) {
    const html = await fetchViewWithPolicy(buildViewUrl(boardId));
    if (isViewErrorPage(html)) {
      skippedBoardIds.push(boardId);
      continue;
    }
    const detail = parseDetailPage(html, boardId);
    const violations = checkDetailInvariants(detail);
    if (violations.length > 0) {
      console.warn(
        `[crawl] boardId ${boardId} 불변식 위반 → 저장 제외:`,
        violations.map((v) => v.code).join(', '),
      );
      invalidBoardIds.push(boardId);
      continue;
    }
    newDetails.push(detail);
  }

  return {
    newDetails,
    latestBoardId,
    skippedBoardIds,
    invalidBoardIds,
    isolatedListRows,
  };
}

/** 유효 항목과 격리 row(boardId 읽을 수 있는 것)를 합친 최대 boardId (ADR 012). */
function maxBoardId(page: ParseListJsonResult): number {
  const ids = [
    ...page.items.map((item) => item.boardId),
    ...page.isolated
      .map((row) => row.boardId)
      .filter((boardId): boardId is number => boardId !== null),
  ];
  return ids.reduce((max, id) => (id > max ? id : max), -Infinity);
}

/**
 * 목록을 페이지네이션하며 boardId > lastBoardId인 신규 항목의 boardId를
 * 오름차순·중복 제거해 모은다. 조회한 모든 페이지의 격리 row도 함께 모아
 * 반환한다(운영 표면화용, ADR 012).
 *
 * 1페이지는 이미 받아둔 것을 재사용한다. 다음 페이지로 넘어가는 조건은:
 * - 현재 페이지 최소 boardId가 아직 lastBoardId보다 큼(경계를 못 넘음), AND
 * - pagingInfo.totPage 기준 더 볼 페이지가 남음.
 * totPage가 없으면(키 소실·단일 페이지) 추가 조회하지 않는다.
 *
 * 경계 판단(minBoardId)과 후보 수집은 모두 **유효 항목** 기준이다. 격리 row는
 * 목록 데이터가 이미 신뢰할 수 없다는 뜻이라 크롤 후보로 삼지 않는다.
 */
async function collectNewBoardIds(params: {
  lastBoardId: number;
  firstText: string;
  firstPage: ParseListJsonResult;
  fetchListPage: (pageIndex: number) => Promise<string>;
}): Promise<{ boardIds: number[]; isolated: IsolatedListRow[] }> {
  const { lastBoardId, firstText, firstPage, fetchListPage } = params;

  const collected = new Set<number>();
  const isolated: IsolatedListRow[] = [];
  const addNew = (items: AnnouncementListItem[]) => {
    for (const item of items) {
      if (item.boardId > lastBoardId) collected.add(item.boardId);
    }
  };
  const minBoardId = (items: AnnouncementListItem[]) =>
    items.reduce(
      (min, item) => (item.boardId < min ? item.boardId : min),
      Infinity,
    );

  addNew(firstPage.items);
  isolated.push(...firstPage.isolated);
  let pageItems = firstPage.items;
  let pageText = firstText;
  let page = 1;

  while (minBoardId(pageItems) > lastBoardId) {
    const totPage = parseTotalPages(pageText);
    if (totPage === null || page >= totPage || page >= MAX_LIST_PAGES) {
      if (page >= MAX_LIST_PAGES) {
        console.warn(
          `[crawl] 페이지네이션 상한(${MAX_LIST_PAGES}) 도달 — 더 오래된 신규가 누락될 수 있음`,
        );
      }
      break;
    }
    page += 1;
    pageText = await fetchListPage(page);
    const parsed = parseListJson(pageText);
    isolated.push(...parsed.isolated);
    pageItems = parsed.items;
    if (pageItems.length === 0) break;
    addNew(pageItems);
  }

  return { boardIds: [...collected].sort((a, b) => a - b), isolated };
}
