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
  resultList?: BbsListJsonItem[] | null;
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
