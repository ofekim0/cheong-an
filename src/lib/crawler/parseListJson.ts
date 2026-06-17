/**
 * 청년안심주택 모집공고 목록 JSON API 응답을 파싱한다.
 *
 * 책임 범위:
 * - `POST /youth/pgm/home/yohome/bbsListJson.json` 응답 본문(JSON 문자열)을
 *   AnnouncementListItem 배열로 변환한다.
 * - JSON 응답에서만 얻을 수 있는 분류 코드/타임스탬프를 도메인 enum과
 *   KST 기준 날짜 문자열로 정규화한다.
 *
 * 책임이 아닌 것:
 * - HTTP 호출 (호출자가 fetch 후 본문 문자열을 전달).
 * - 상세 페이지(view.do) 보강 fetch (announcementService의 일).
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

interface BbsListJsonItem {
  boardId: number;
  nttSj: string;
  content: string | null;
  optn1: string | null;
  optn2: string | null;
  optn3: string | null;
  optn4: string | null;
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

export function parseListJson(jsonText: string): AnnouncementListItem[] {
  let parsed: BbsListJsonResponse;
  try {
    parsed = JSON.parse(jsonText) as BbsListJsonResponse;
  } catch (err) {
    throw new ParseListJsonError(
      `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const list = parsed.resultList ?? [];
  return list.map((item, index) => toListItem(item, index));
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

function toListItem(
  item: BbsListJsonItem,
  index: number,
): AnnouncementListItem {
  return {
    boardId: item.boardId,
    title: item.nttSj.trim(),
    announcementType: toAnnouncementType(item.optn2, index),
    recruitmentType: toRecruitmentType(item.optn5, index),
    agency: nullIfEmpty(item.optn3),
    postDate: toKstDateString(item.regDate),
    applicationStartDate: nullIfEmpty(item.optn1),
    applicationEndDate: nullIfEmpty(item.optn4),
    attachmentId: nullIfEmpty(item.atchFileId),
    rawContent: item.content ?? '',
  };
}

function toAnnouncementType(
  value: string | null,
  index: number,
): AnnouncementType {
  if (value === '1') return 'public';
  if (value === '2') return 'private';
  throw new ParseListJsonError(
    `resultList[${index}].optn2: unknown announcement type code "${value ?? ''}"`,
  );
}

function toRecruitmentType(
  value: string | null,
  index: number,
): RecruitmentType {
  if (value === '1') return 'initial';
  if (value === '2') return 'additional';
  throw new ParseListJsonError(
    `resultList[${index}].optn5: unknown recruitment type code "${value ?? ''}"`,
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
