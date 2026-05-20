/**
 * 크롤링 파이프라인 합성 레이어
 *
 * 책임 범위:
 * - JSON 목록 API(bbsListJson.json) 1회 호출로 boardId·본문·메타데이터 일괄 수신.
 * - JSON에 빠진 gap(=lastBoardId+1 ~ JSON 최신 boardId 사이의 미관측 ID)을
 *   view.do로 직접 보강 fetch. 633B 에러 페이지는 skippedBoardIds로 분리.
 * - 각 호출에 rateLimit과 retry를 일관되게 적용.
 *
 * 책임이 아닌 것:
 * - HTTP 자체 (fetchJsonText / fetchHtml).
 * - 재시도 정책 (retry).
 * - 호출 간 간격 (rateLimit).
 * - JSON / HTML 파싱 (parseListJson, parseDetailPage).
 * - 비존재 boardId 판별 (isViewErrorPage).
 * - DB 저장이나 lastBoardId persistence (호출자의 일).
 *
 * 데이터 소스 결정 근거: docs/adr/002-crawling-data-source.md (옵션 C 하이브리드)
 */

import { fetchHtml, type FetchHtmlOptions } from './fetchHtml';
import { fetchJsonText, type FetchJsonOptions } from './fetchJsonText';
import { withRetry, type RetryOptions } from './retry';
import { createRateLimiter, type RateLimiter } from './rateLimit';
import { parseListJson } from './parseListJson';
import { parseDetailPage } from './parseDetailPage';
import { isViewErrorPage } from './isViewErrorPage';
import type {
  AnnouncementDetail,
  AnnouncementListItem,
} from '@/types/announcement';

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
  /** 마지막으로 확인한 boardId. 이보다 큰 것만 새 공고. */
  lastBoardId: number;
  /** 호출 간 최소 간격 (ms, 기본 1_000). */
  intervalMs?: number;
  /** JSON API URL (테스트/환경 분리용 override). */
  listUrl?: string;
  /** form body override. */
  listBody?: Record<string, string>;
  /** JSON API fetcher - 테스트에서 MSW로 교체. */
  fetcher?: (url: string, options?: FetchJsonOptions) => Promise<string>;
  /** boardId -> view.do URL 빌더 (테스트 override). */
  buildViewUrl?: (boardId: number) => string;
  /** view.do HTML fetcher - 테스트에서 MSW로 교체. */
  viewFetcher?: (url: string, options?: FetchHtmlOptions) => Promise<string>;
  /** 재시도 옵션 - 미지정 시 retry 모듈 기본값. */
  retryOptions?: RetryOptions;
  /** 외부 주입할 RateLimiter (공유 limiter 패턴). */
  rateLimiter?: RateLimiter;
}

export interface CrawlAnnouncementsResult {
  /**
   * 이번 회차에 새로 발견한 공고 목록.
   * - JSON 응답의 lastBoardId 초과분 + view.do 보강분.
   * - JSON 항목이 앞, view.do 항목이 뒤.
   */
  newAnnouncements: AnnouncementListItem[];
  /**
   * 응답에서 관측한 가장 큰 boardId.
   * resultList가 비어 있으면 입력 lastBoardId를 그대로 반환.
   */
  latestBoardId: number;
  /**
   * gap 후보 중 view.do가 633B 에러 페이지로 응답한 boardId.
   * 운영 관찰용 (빈 번호가 얼마나 끼는지 추적).
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

  // 1) JSON API 1회 호출.
  const jsonText = await fetchJsonWithPolicy(listUrl);
  const items = parseListJson(jsonText);

  if (items.length === 0) {
    return {
      newAnnouncements: [],
      latestBoardId: lastBoardId,
      skippedBoardIds: [],
    };
  }

  const observedIds = new Set(items.map((i) => i.boardId));
  const latestBoardId = items.reduce(
    (max, item) => (item.boardId > max ? item.boardId : max),
    -Infinity,
  );

  // 2) JSON 응답의 lastBoardId 초과분 = 즉시 신규 공고로 채택.
  const newFromJson = items.filter((item) => item.boardId > lastBoardId);

  // 3) gap = lastBoardId+1 ~ latestBoardId 범위에서 JSON에 안 들어온 것들.
  const gap: number[] = [];
  for (let id = lastBoardId + 1; id <= latestBoardId; id++) {
    if (!observedIds.has(id)) gap.push(id);
  }

  // 4) gap의 각 boardId를 view.do로 직접 확인.
  //    - 633B 에러 페이지 → 비존재 → skippedBoardIds.
  //    - 정상 → parseDetailPage → AnnouncementListItem으로 변환 후 newFromView.
  const newFromView: AnnouncementListItem[] = [];
  const skippedBoardIds: number[] = [];

  for (const boardId of gap) {
    const html = await fetchViewWithPolicy(buildViewUrl(boardId));
    if (isViewErrorPage(html)) {
      skippedBoardIds.push(boardId);
      continue;
    }
    const detail = parseDetailPage(html, boardId);
    newFromView.push(detailToListItem(detail));
  }

  return {
    newAnnouncements: [...newFromJson, ...newFromView],
    latestBoardId,
    skippedBoardIds,
  };
}

/**
 * AnnouncementDetail(parseDetailPage 결과)을 AnnouncementListItem 형태로 변환.
 *
 * 매핑 손실:
 * - agency: JSON에는 있고 HTML에는 명시적 필드가 없어 null로 둔다.
 * - attachmentId: attachmentUrl(`fileDown.do?atchFileId=...`)에서 추출.
 *
 * JSON 항목과 view.do 보강 항목을 같은 결과 배열에 담기 위한 어댑터.
 */
function detailToListItem(detail: AnnouncementDetail): AnnouncementListItem {
  return {
    boardId: detail.boardId,
    title: detail.title,
    announcementType: detail.announcementType,
    recruitmentType: detail.recruitmentType,
    agency: null,
    postDate: detail.postDate,
    applicationStartDate: detail.applicationStartDate,
    applicationEndDate: detail.applicationEndDate,
    attachmentId: extractAttachmentId(detail.attachmentUrl),
    rawContent: detail.rawContent,
  };
}

function extractAttachmentId(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/[?&]atchFileId=([^&]+)/);
  return match ? match[1] : null;
}
