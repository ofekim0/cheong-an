/**
 * announcements 테이블 UPSERT 리포지터리.
 *
 * - 입력: AnnouncementDetail[] (크롤러가 view.do로 확보한 detail).
 * - 동작: board_id UNIQUE 제약을 키로 UPSERT.
 * - 클라이언트는 인자로 받아 테스트에서 모킹하기 쉽게 한다.
 *
 * 매핑 정책: ADR 003 옵션 B (저장 전 view.do 보강) — 모든 row가 완전한 detail을 가진다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  AnnouncementDetail,
  AnnouncementType,
  RecruitmentType,
} from '@/types/announcement';

const TABLE = 'announcements';

/** Supabase에 INSERT/UPSERT로 전달하는 row 형태 (snake_case). */
export interface AnnouncementInsertRow {
  board_id: number;
  title: string;
  announcement_type: AnnouncementType;
  recruitment_type: RecruitmentType;
  complex_name: string | null;
  district: string | null;
  address: string | null;
  total_units: number | null;
  post_date: string;
  application_start_date: string | null;
  application_end_date: string | null;
  result_date: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
  raw_content: string;
}

/**
 * AnnouncementDetail (camelCase, 도메인 타입) → DB row (snake_case).
 * 순수 함수. 단위 테스트로 매핑 정확성을 검증한다.
 */
export function detailToRow(detail: AnnouncementDetail): AnnouncementInsertRow {
  return {
    board_id: detail.boardId,
    title: detail.title,
    announcement_type: detail.announcementType,
    recruitment_type: detail.recruitmentType,
    complex_name: detail.complexName,
    district: detail.district,
    address: detail.address,
    total_units: detail.totalUnits,
    post_date: detail.postDate,
    application_start_date: detail.applicationStartDate,
    application_end_date: detail.applicationEndDate,
    result_date: detail.resultDate,
    attachment_url: detail.attachmentUrl,
    attachment_name: detail.attachmentName,
    raw_content: detail.rawContent,
  };
}

/**
 * 신규 detail 목록을 announcements 테이블에 UPSERT.
 *
 * - board_id를 충돌 키로 사용 (마이그레이션의 UNIQUE 제약과 일치).
 * - 빈 배열이면 Supabase 호출 없이 즉시 반환.
 * - Supabase 에러는 throw로 표면화 → 호출자(Route Handler)에서 5xx로 매핑.
 */
export async function upsertAnnouncements(
  client: SupabaseClient,
  details: AnnouncementDetail[],
): Promise<void> {
  if (details.length === 0) return;

  const rows = details.map(detailToRow);
  const { error } = await client
    .from(TABLE)
    .upsert(rows, { onConflict: 'board_id' });

  if (error) {
    throw new Error(
      `Failed to upsert ${details.length} announcement(s): ${error.message}`,
    );
  }
}
