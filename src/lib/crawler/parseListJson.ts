/**
 * 청년안심주택 모집공고 목록 JSON API 응답을 파싱한다.
 *
 * 책임 범위:
 * - `POST /youth/pgm/home/yohome/bbsListJson.json` 응답 본문(JSON 문자열)을
 *   유효 AnnouncementListItem 배열 + 격리 항목으로 분리해 반환한다 (ADR 012).
 * - JSON 응답에서만 얻을 수 있는 분류 코드/타임스탬프를 도메인 enum과
 *   KST 기준 날짜 문자열로 정규화한다.
 * - 항목 단위 실패(미지의 분류 코드, 필드 누락, 이상 타임스탬프)는 해당 row만
 *   격리한다 — 한 항목의 오입력이 목록 전체를 중단시켜 크롤을 동결시키는 것을
 *   막는다(#68, ADR 012). 응답 자체가 invalid JSON이면 구조 변경이므로 throw.
 *   전 항목이 격리되면 유효 배열이 비어 리스트 불변식(LIST_EMPTY, ADR 006)이
 *   cron 500으로 차단한다 — 격리 vs 중단의 경계는 ADR 012.
 *
 * 책임이 아닌 것:
 * - HTTP 호출 (호출자가 fetch 후 본문 문자열을 전달).
 * - 상세 페이지(view.do) 보강 fetch (announcementService의 일).
 * - 격리 항목의 표면화(응답·로그)와 위반 시 동작 (호출자의 일).
 */

import type {
  AnnouncementListItem,
  AnnouncementType,
  RecruitmentType,
} from '@/types/announcement';

/** KST는 UTC+9. epoch(ms)에 더해 toISOString().slice(0,10)으로 YYYY-MM-DD 추출. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

interface BbsListJsonResponse {
  pagingInfo?: BbsPagingInfo | null;
  resultList?: BbsListJsonItem[] | null;
}

interface BbsPagingInfo {
  totPage?: number | null;
}

/**
 * API가 준다고 기대하는 항목 shape. 런타임에는 어떤 필드든 어긋날 수 있으므로
 * toListItem이 방어 검증한다 — 이 타입은 "기대"이지 보장이 아니다 (ADR 012).
 */
interface BbsListJsonItem {
  boardId: number;
  nttSj: string;
  content: string | null;
  /** 공고게시일 — regDate 파생 postDate와 같은 값이라 매핑에 쓰지 않는다 (#86). */
  optn1: string | null;
  /** 공고 유형 코드 */
  optn2: string | null;
  /** 사업 주체 */
  optn3: string | null;
  /** 청약신청일 */
  optn4: string | null;
  /** 모집 구분 코드 */
  optn5: string | null;
  atchFileId: string | null;
  regDate: number;
}

export class ParseListJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseListJsonError';
  }
}

/** row 단위 매핑 실패로 격리된 목록 항목 (ADR 012). */
export interface IsolatedListRow {
  /** 격리된 항목의 boardId. boardId 자체가 읽을 수 없는 값이면 null. */
  boardId: number | null;
  /** 격리 사유 — 크롤 응답·로그 표면화용. */
  reason: string;
}

export interface ParseListJsonResult {
  /** 매핑에 성공한 유효 항목. */
  items: AnnouncementListItem[];
  /** row 단위 실패로 배제된 항목. 표면화는 호출자의 일. */
  isolated: IsolatedListRow[];
}

export function parseListJson(jsonText: string): ParseListJsonResult {
  let parsed: BbsListJsonResponse;
  try {
    parsed = JSON.parse(jsonText) as BbsListJsonResponse;
  } catch (err) {
    throw new ParseListJsonError(
      `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const list = parsed.resultList ?? [];
  const items: AnnouncementListItem[] = [];
  const isolated: IsolatedListRow[] = [];

  list.forEach((item, index) => {
    try {
      items.push(toListItem(item, index));
    } catch (err) {
      isolated.push({
        boardId: extractBoardId(item),
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return { items, isolated };
}

/**
 * 같은 JSON 응답의 `pagingInfo.totPage`(총 페이지 수)를 추출한다.
 *
 * 목록 기반 크롤(ADR 007)에서 폴링 사이 1페이지를 넘겨 밀려난 신규를 보전하려면
 * "다음 페이지가 있는가"를 알아야 한다. 양의 정수가 아니면(키 소실·구조 변경 포함)
 * null을 반환해 호출자가 "추가 페이지 없음"으로 안전하게 처리하게 한다.
 */
export function parseTotalPages(jsonText: string): number | null {
  let parsed: BbsListJsonResponse;
  try {
    parsed = JSON.parse(jsonText) as BbsListJsonResponse;
  } catch (err) {
    throw new ParseListJsonError(
      `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const totPage = parsed.pagingInfo?.totPage;
  if (
    typeof totPage !== 'number' ||
    !Number.isInteger(totPage) ||
    totPage < 1
  ) {
    return null;
  }
  return totPage;
}

/**
 * 항목 1건을 도메인 모델로 매핑한다. 실패는 throw — 호출자(parseListJson)가
 * row 단위로 잡아 격리한다. 여기의 명시적 shape 가드는 격리 사유를 읽을 수 있게
 * 만들기 위한 것이고, 가드 밖의 예기치 못한 실패도 같은 경로로 격리된다.
 */
function toListItem(
  item: BbsListJsonItem,
  index: number,
): AnnouncementListItem {
  if (!Number.isInteger(item.boardId) || item.boardId <= 0) {
    throw new ParseListJsonError(
      `resultList[${index}].boardId is not a positive integer: ${JSON.stringify(item.boardId)}`,
    );
  }
  if (typeof item.nttSj !== 'string' || item.nttSj.trim().length === 0) {
    throw new ParseListJsonError(
      `resultList[${index}].nttSj is missing or empty: ${JSON.stringify(item.nttSj)}`,
    );
  }
  if (typeof item.regDate !== 'number' || !Number.isFinite(item.regDate)) {
    throw new ParseListJsonError(
      `resultList[${index}].regDate is not a finite number: ${JSON.stringify(item.regDate)}`,
    );
  }

  return {
    boardId: item.boardId,
    title: item.nttSj.trim(),
    announcementType: toAnnouncementType(item.optn2, item.nttSj, index),
    recruitmentType: toRecruitmentType(item.optn5, item.nttSj, index),
    agency: nullIfEmpty(item.optn3),
    postDate: toKstDateString(item.regDate),
    // optn4가 '청약신청일'이다. optn1('공고게시일')을 시작일로, optn4를 마감일로
    // 매핑하던 것이 #86 — 원본 view.do 메타 영역의 날짜 항목은 '공고게시일'과
    // '청약신청일' 둘뿐이라 '모집 마감일'은 소스에 존재하지 않는다 (ADR 014).
    applicationDate: nullIfEmpty(item.optn4),
    attachmentId: nullIfEmpty(item.atchFileId),
    rawContent: item.content ?? '',
  };
}

/** 격리 항목의 boardId를 최대한 살려서 보고한다 — 읽을 수 없으면 null. */
function extractBoardId(item: BbsListJsonItem): number | null {
  return Number.isInteger(item.boardId) && item.boardId > 0
    ? item.boardId
    : null;
}

function toAnnouncementType(
  value: string | null,
  title: string,
  index: number,
): AnnouncementType {
  if (value === '1') return 'public';
  if (value === '2') return 'private';
  // #68(optn5 미기재 → 크롤 동결)의 쌍둥이 예방(#71). 미기재는 parseDetailPage와
  // 동일한 제목 휴리스틱으로 폴백한다 — 폴백은 "복원 가능한 미기재"를 데이터로
  // 살리고, 미지의 코드는 복원 불가능하므로 throw → row 격리(ADR 012).
  if (value == null || value.trim() === '') {
    return title.includes('공공임대') ? 'public' : 'private';
  }
  throw new ParseListJsonError(
    `resultList[${index}].optn2: unknown announcement type code "${value}"`,
  );
}

function toRecruitmentType(
  value: string | null,
  title: string,
  index: number,
): RecruitmentType {
  if (value === '1') return 'initial';
  if (value === '2') return 'additional';
  // 미기재(null/빈 값)는 실측된 상태다 — boardId 6624(2026-08, 공공임대)가
  // optn5 없이 게시돼 크롤이 동결됐다(#68). parseDetailPage와 동일한 제목
  // 휴리스틱으로 폴백한다. 미기재가 아닌 미지의 코드는 복원 불가능하므로
  // throw → row 격리(ADR 012). 전면 도입이면 LIST_EMPTY 불변식이 잡는다.
  if (value == null || value.trim() === '') {
    return title.includes('추가모집') ? 'additional' : 'initial';
  }
  throw new ParseListJsonError(
    `resultList[${index}].optn5: unknown recruitment type code "${value}"`,
  );
}

function nullIfEmpty(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function toKstDateString(epochMs: number): string {
  return new Date(epochMs + KST_OFFSET_MS).toISOString().slice(0, 10);
}
