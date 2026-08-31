/**
 * announcements 테이블 리포지터리 (쓰기: 크롤러 UPSERT / 읽기: 목록 조회).
 *
 * - 쓰기 입력: AnnouncementDetail[] (크롤러가 view.do로 확보한 detail).
 *   board_id UNIQUE 제약을 키로 UPSERT.
 * - 읽기: 공개 목록 페이지(#83)용 페이지네이션 조회.
 * - 클라이언트는 인자로 받아 테스트에서 모킹하기 쉽게 한다.
 *
 * 매핑 정책: ADR 003 옵션 B (저장 전 view.do 보강) — 모든 row가 완전한 detail을 가진다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  AnnouncementDetail,
  AnnouncementSummary,
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

/* ------------------------------------------------------------------ */
/* 읽기 경로 — 공개 목록 조회                                          */
/* ------------------------------------------------------------------ */

/**
 * 목록 조회가 select하는 컬럼.
 *
 * `raw_content`(공고 본문 HTML, row당 수 KB)를 비롯해 목록에서 쓰지 않는 컬럼은
 * 제외한다 — ISR 페이로드와 빌드 시간에 직접 영향을 준다.
 */
const SUMMARY_COLUMNS = [
  'board_id',
  'title',
  'announcement_type',
  'recruitment_type',
  'complex_name',
  'district',
  'post_date',
  'application_start_date',
  'application_end_date',
].join(', ');

/** 목록 조회 결과 row 형태 (snake_case). */
export interface AnnouncementSummaryRow {
  board_id: number;
  title: string;
  announcement_type: AnnouncementType;
  recruitment_type: RecruitmentType;
  complex_name: string | null;
  district: string | null;
  post_date: string;
  application_start_date: string | null;
  application_end_date: string | null;
}

/**
 * DB row (snake_case) → AnnouncementSummary (camelCase, 도메인 타입).
 * 순수 함수. `detailToRow`의 반대 방향.
 */
export function rowToSummary(row: AnnouncementSummaryRow): AnnouncementSummary {
  return {
    boardId: row.board_id,
    title: row.title,
    announcementType: row.announcement_type,
    recruitmentType: row.recruitment_type,
    complexName: row.complex_name,
    district: row.district,
    postDate: row.post_date,
    applicationStartDate: row.application_start_date,
    applicationEndDate: row.application_end_date,
  };
}

export interface ListAnnouncementsParams {
  /** 1부터 시작하는 페이지 번호. */
  page: number;
  /** 페이지당 항목 수. */
  pageSize: number;
}

export interface AnnouncementListPage {
  items: AnnouncementSummary[];
  /** 필터 적용 전후를 통틀어 조건에 맞는 전체 건수 (페이지네이션 UI가 총 페이지 계산에 사용). */
  total: number;
}

/**
 * PostgREST가 "offset이 전체 건수를 넘음"에 사용하는 에러 코드.
 * 범위를 벗어난 offset은 빈 배열이 아니라 HTTP 416으로 돌아온다.
 */
const PGRST_RANGE_NOT_SATISFIABLE = 'PGRST103';

/** 조건에 맞는 전체 건수만 조회한다 (row 본문은 전송하지 않음). */
async function countAnnouncements(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .from(TABLE)
    .select('board_id', { count: 'exact', head: true });

  if (error) {
    throw new Error(`Failed to count announcements: ${error.message}`);
  }
  return count ?? 0;
}

/**
 * 공고 목록을 최신순으로 페이지 단위 조회한다.
 *
 * 정렬은 `post_date DESC, board_id DESC`. 보조 키가 필요한 이유는 `post_date`가
 * DATE(일 단위)라 같은 날짜에 여러 공고가 게시되기 때문이다(실제 데이터에도 다수
 * 존재). 동률을 남겨두면 Postgres의 정렬이 비결정적이어서 페이지 경계의 row가
 * 누락되거나 중복 노출될 수 있다. board_id는 UNIQUE라 전순서를 보장한다.
 *
 * 범위를 벗어난 page는 에러가 아니라 빈 페이지로 처리한다 — 공개 페이지의 URL은
 * 사용자가 임의로 바꿀 수 있고(`?page=999`), 그것이 500이 되어선 안 된다. 이때
 * total은 별도 count 조회로 채워 호출자가 404·리다이렉트를 판단할 수 있게 한다.
 *
 * 조회는 service role 클라이언트(RLS 우회)를 전제로 한다 — 목록 페이지는
 * SSG + ISR이라 서버에서만 조회한다(#83 선결 확인).
 */
export async function listAnnouncements(
  client: SupabaseClient,
  { page, pageSize }: ListAnnouncementsParams,
): Promise<AnnouncementListPage> {
  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError(`page must be an integer >= 1, got: ${page}`);
  }
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError(`pageSize must be an integer >= 1, got: ${pageSize}`);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, count, error } = await client
    .from(TABLE)
    .select(SUMMARY_COLUMNS, { count: 'exact' })
    .order('post_date', { ascending: false })
    .order('board_id', { ascending: false })
    .range(from, to);

  if (error) {
    if (error.code === PGRST_RANGE_NOT_SATISFIABLE) {
      return { items: [], total: await countAnnouncements(client) };
    }
    throw new Error(
      `Failed to list announcements (page=${page}, pageSize=${pageSize}): ${error.message}`,
    );
  }

  const rows = (data ?? []) as unknown as AnnouncementSummaryRow[];
  return { items: rows.map(rowToSummary), total: count ?? 0 };
}
