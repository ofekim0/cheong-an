/**
 * 라이브 카나리 — 운영 사이트를 매 회차 찔러보고 파서 불변식을 검증한다 (ADR 006).
 *
 * 책임 범위:
 * - 라이브 list API를 1회 호출해 parseListJson 출력에 리스트 불변식을 적용.
 * - 안정 boardId(canaryBoardId) 1건의 view.do를 호출해 parseDetailPage 출력에
 *   디테일 불변식을 적용. 신규 0건인 한산한 회차에도 디테일 파서를 강제로 돌려
 *   사이트 구조 변경(S2)을 감지하기 위함.
 * - 발견한 위반을 CanaryViolation[]로 반환한다. throw 하지 않는다(파싱 자체 예외는
 *   제외) — 위반 시 무엇을 할지(cron 500)는 호출자가 정한다.
 *
 * 책임이 아닌 것:
 * - 신규 공고 감지·저장 (announcementService / route의 일). 카나리는 "파서가 라이브
 *   사이트에 대해 아직 동작하는가"만 본다.
 * - 위반 시 동작 (라우트가 500 매핑).
 *
 * 설계 근거: ADR 006 A안(독립 카나리). 잘 동작하는 announcementService를 건드리지
 * 않도록 접속 설정을 자체 보유한다. 세 번째 소비자가 생기면 공유 모듈로 추출(rule of three).
 */

import { fetchHtml, type FetchHtmlOptions } from './fetchHtml';
import { fetchJsonText, type FetchJsonOptions } from './fetchJsonText';
import { withRetry, type RetryOptions } from './retry';
import { createRateLimiter, type RateLimiter } from './rateLimit';
import { parseListJson } from './parseListJson';
import { parseDetailPage } from './parseDetailPage';
import { isViewErrorPage } from './isViewErrorPage';
import {
  checkListInvariants,
  checkDetailInvariants,
  type InvariantCode,
} from './parserInvariants';

const LIST_URL =
  'https://soco.seoul.go.kr/youth/pgm/home/yohome/bbsListJson.json';

const LIST_BODY: Record<string, string> = {
  bbsId: 'BMSR00015',
  pageIndex: '1',
  searchAdresGu: '',
  searchCondition: '',
  searchKeyword: '',
  optn2: '',
  optn5: '',
};

const REFERER =
  'https://soco.seoul.go.kr/youth/bbs/BMSR00015/list.do?menuNo=400008';

const VIEW_URL_BUILDER = (boardId: number): string =>
  `https://soco.seoul.go.kr/youth/bbs/BMSR00015/view.do?boardId=${boardId}&menuNo=400008`;

const DEFAULT_INTERVAL_MS = 1_000;

/**
 * 카나리 위반 코드. parserInvariants의 InvariantCode에 카나리 고유 코드를 더한다.
 * - CANARY_DETAIL_MISSING: 카나리 boardId가 view.do 에러 페이지로 응답 — 그 공고가
 *   삭제됐거나 CANARY_BOARD_ID가 잘못 설정된 것. 검증을 더 못 하므로 경보 대상.
 */
export type CanaryViolationCode = InvariantCode | 'CANARY_DETAIL_MISSING';

export interface CanaryViolation {
  code: CanaryViolationCode;
  message: string;
}

export interface RunCanaryOptions {
  /**
   * 디테일 불변식을 검증할 안정 boardId. undefined면 디테일 카나리를 건너뛰고
   * 리스트 검증만 한다(건너뜀은 console.warn으로 표면화 — 조용한 누락 금지).
   */
  canaryBoardId?: number;
  /** 호출 간 최소 간격 (ms, 기본 1_000). */
  intervalMs?: number;
  /** JSON API URL override (테스트). */
  listUrl?: string;
  /** form body override. */
  listBody?: Record<string, string>;
  /** JSON API fetcher — 테스트에서 주입. */
  fetcher?: (url: string, options?: FetchJsonOptions) => Promise<string>;
  /** boardId -> view.do URL 빌더 override (테스트). */
  buildViewUrl?: (boardId: number) => string;
  /** view.do HTML fetcher — 테스트에서 주입. */
  viewFetcher?: (url: string, options?: FetchHtmlOptions) => Promise<string>;
  /** 재시도 옵션 — 미지정 시 retry 모듈 기본값. */
  retryOptions?: RetryOptions;
  /** 외부 주입할 RateLimiter. */
  rateLimiter?: RateLimiter;
}

/**
 * 라이브 사이트에 대해 파서 불변식을 검증하고 위반 목록을 반환한다.
 * 빈 배열 = 정상. 비어있지 않으면 사이트 구조 변경 의심.
 */
export async function runCanary(
  options: RunCanaryOptions = {},
): Promise<CanaryViolation[]> {
  const {
    canaryBoardId,
    intervalMs = DEFAULT_INTERVAL_MS,
    listUrl = LIST_URL,
    listBody = LIST_BODY,
    fetcher = fetchJsonText,
    buildViewUrl = VIEW_URL_BUILDER,
    viewFetcher = fetchHtml,
    retryOptions,
    rateLimiter = createRateLimiter({ intervalMs }),
  } = options;

  const violations: CanaryViolation[] = [];

  // 1) 라이브 list 불변식 (S1).
  const jsonText = await rateLimiter
    .acquire()
    .then(() =>
      withRetry(
        () =>
          fetcher(listUrl, { body: listBody, headers: { Referer: REFERER } }),
        retryOptions,
      ),
    );
  violations.push(...checkListInvariants(parseListJson(jsonText)));

  // 2) 디테일 카나리 (S2) — canaryBoardId가 설정된 경우에만.
  if (canaryBoardId === undefined) {
    console.warn(
      '[canary] CANARY_BOARD_ID 미설정 — 디테일 불변식 검증을 건너뜁니다',
    );
    return violations;
  }

  const html = await rateLimiter
    .acquire()
    .then(() =>
      withRetry(
        () =>
          viewFetcher(buildViewUrl(canaryBoardId), {
            headers: { Referer: REFERER },
          }),
        retryOptions,
      ),
    );

  if (isViewErrorPage(html)) {
    violations.push({
      code: 'CANARY_DETAIL_MISSING',
      message: `canary boardId ${canaryBoardId}: view.do가 에러 페이지로 응답 — 카나리 공고 삭제 또는 CANARY_BOARD_ID 오설정`,
    });
    return violations;
  }

  violations.push(
    ...checkDetailInvariants(parseDetailPage(html, canaryBoardId)),
  );
  return violations;
}
