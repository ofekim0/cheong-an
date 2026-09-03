/** 공고 유형 */
export type AnnouncementType = 'public' | 'private';

/** 모집 구분 */
export type RecruitmentType = 'initial' | 'additional';

/** 공고 상태 */
export type AnnouncementStatus = 'upcoming' | 'open' | 'closed';

/** 목록 JSON API 응답 1건의 파싱 결과 (boardId 단위 raw 데이터) */
export interface AnnouncementListItem {
  boardId: number;
  title: string;
  announcementType: AnnouncementType;
  recruitmentType: RecruitmentType;
  /** 사업 주체 (예: "태운산업개발(주)") */
  agency: string | null;
  /** 게시일 (KST 기준 YYYY-MM-DD) */
  postDate: string;
  /**
   * 청약신청일 (YYYY-MM-DD).
   *
   * 기간의 시작일이 아니라 단일 지정일이다 — 원본이 노출하는 날짜 항목은
   * '공고게시일'과 '청약신청일' 둘뿐이고 '모집 마감일'은 존재하지 않는다
   * (ADR 014).
   */
  applicationDate: string | null;
  /** 첨부 파일 ID — view.do에서 다운로드 URL 구성에 사용 */
  attachmentId: string | null;
  /**
   * HTML 본문 (sanitize 전). 목록 JSON의 `content` 원문이라 태그가 들어 있다.
   * 저장에는 도달하지 않는다 — 저장 경로는 `parseDetailPage` 출력만 쓴다
   * (ADR 003 옵션 B). DB에 들어가는 본문은 `AnnouncementDetail.rawContent`(평문)다.
   */
  rawContent: string;
}

/** 상세 페이지에서 추출한 공고 전체 정보 */
export interface AnnouncementDetail {
  boardId: number;
  title: string;
  announcementType: AnnouncementType;
  recruitmentType: RecruitmentType;
  complexName: string | null;
  district: string | null;
  address: string | null;
  totalUnits: number | null;
  postDate: string; // YYYY-MM-DD
  /** 청약신청일 — 단일 지정일 (ADR 014) */
  applicationDate: string | null; // YYYY-MM-DD
  attachmentUrl: string | null;
  attachmentName: string | null;
  /**
   * 공고 본문 **평문**. `AnnouncementListItem.rawContent`(목록 JSON의 HTML)와
   * 달리 `parseDetailPage`가 `$('div.board_cont').text()`로 뽑은 텍스트다.
   *
   * 저장되는 것은 항상 이쪽이다(ADR 003 옵션 B — 저장 경로는 detail 출력만 쓴다).
   * 따라서 DB에서 읽은 본문은 렌더 시 HTML sanitize가 필요 없고, 대신 줄바꿈·공백
   * 보존이 표기 과제가 된다(#96).
   */
  rawContent: string;
}

/** DB에 저장되는 공고 레코드 */
export interface AnnouncementRow {
  id: number;
  boardId: number;
  title: string;
  announcementType: AnnouncementType;
  recruitmentType: RecruitmentType;
  complexName: string | null;
  district: string | null;
  address: string | null;
  totalUnits: number | null;
  postDate: string;
  applicationDate: string | null;
  attachmentUrl: string | null;
  attachmentName: string | null;
  rawContent: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 목록 화면에 필요한 필드만 담은 요약.
 *
 * `AnnouncementRow`(전체 레코드)를 재사용하지 않는 이유: `rawContent`는 공고 본문
 * HTML 전체라 row당 수 KB에 달하는데 목록에서는 쓰지 않는다. 조회 시점에 컬럼을
 * 골라 담아 ISR 페이로드를 줄인다. `address`·`attachment*`도 같은 이유로 제외 —
 * 상세 페이지에서 `AnnouncementRow`로 읽는다.
 */
export interface AnnouncementSummary {
  boardId: number;
  title: string;
  announcementType: AnnouncementType;
  recruitmentType: RecruitmentType;
  complexName: string | null;
  district: string | null;
  postDate: string;
  applicationDate: string | null;
}

/** 크롤링 상태 추적 레코드 */
export interface CrawlStateRow {
  id: number;
  lastBoardId: number;
  lastCrawledAt: string;
  updatedAt: string;
}
