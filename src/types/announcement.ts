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
  /** 모집 시작일 (YYYY-MM-DD) */
  applicationStartDate: string | null;
  /** 모집 마감일 (YYYY-MM-DD) */
  applicationEndDate: string | null;
  /** 첨부 파일 ID — view.do에서 다운로드 URL 구성에 사용 */
  attachmentId: string | null;
  /** HTML 본문 (sanitize 전) */
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
  applicationStartDate: string | null; // YYYY-MM-DD
  applicationEndDate: string | null; // YYYY-MM-DD
  resultDate: string | null; // YYYY-MM-DD
  attachmentUrl: string | null;
  attachmentName: string | null;
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
  applicationStartDate: string | null;
  applicationEndDate: string | null;
  resultDate: string | null;
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
  applicationStartDate: string | null;
  applicationEndDate: string | null;
}

/** 크롤링 상태 추적 레코드 */
export interface CrawlStateRow {
  id: number;
  lastBoardId: number;
  lastCrawledAt: string;
  updatedAt: string;
}
