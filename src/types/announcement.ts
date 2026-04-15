/** 공고 유형 */
export type AnnouncementType = 'public' | 'private';

/** 모집 구분 */
export type RecruitmentType = 'initial' | 'additional';

/** 공고 상태 */
export type AnnouncementStatus = 'upcoming' | 'open' | 'closed';

/** 메인 페이지에서 추출한 공고 요약 정보 */
export interface AnnouncementSummary {
  boardId: number;
  title: string;
  postDate: string; // YYYY-MM-DD
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

/** 크롤링 상태 추적 레코드 */
export interface CrawlStateRow {
  id: number;
  lastBoardId: number;
  lastCrawledAt: string;
  updatedAt: string;
}
