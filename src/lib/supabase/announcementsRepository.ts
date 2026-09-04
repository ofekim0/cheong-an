/**
 * announcements 테이블 리포지터리 (쓰기: 크롤러 UPSERT / 읽기: 목록 조회).
 *
 * - 쓰기 입력: AnnouncementDetail[] (크롤러가 view.do로 확보한 detail).
 *   board_id UNIQUE 제약을 키로 UPSERT.
 * - 읽기: 공개 목록 페이지(#83 → #106)용 전량 요약 조회 + 상세 페이지(#96)용 단건 조회.
 * - 클라이언트는 인자로 받아 테스트에서 모킹하기 쉽게 한다.
 *
 * 매핑 정책: ADR 003 옵션 B (저장 전 view.do 보강) — 모든 row가 완전한 detail을 가진다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  AnnouncementDetail,
  AnnouncementRow,
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
  application_date: string | null;
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
    application_date: detail.applicationDate,
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
 * `raw_content`(공고 본문, row당 수 KB)를 비롯해 목록에서 쓰지 않는 컬럼은
 * 제외한다 — 응답 페이로드와 캐시 항목 크기에 직접 영향을 준다. 상세 조회는
 * 이 제외를 적용하지 않는다(`getAnnouncementByBoardId` — 1건이고 본문이 렌더 대상).
 */
const SUMMARY_COLUMNS = [
  'board_id',
  'title',
  'announcement_type',
  'recruitment_type',
  'complex_name',
  'district',
  'post_date',
  'application_date',
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
  application_date: string | null;
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
    applicationDate: row.application_date,
  };
}

/**
 * 전량 요약 조회 (#106, ADR 015 Step a).
 *
 * 필터·페이지네이션을 브라우저가 계산하는 모델의 데이터 공급원이다. `range`도
 * `count`도 없다 — 전체를 한 번에 읽어 static shell에 임베드하고, 고르는 일은
 * `filterAnnouncements`가 맡는다.
 *
 * 정렬은 `post_date DESC, board_id DESC`. 보조 키가 필요한 이유는 `post_date`가
 * DATE(일 단위)라 같은 날짜에 여러 공고가 게시되기 때문이다(실제 데이터에도 다수
 * 존재). 동률을 남겨두면 Postgres의 정렬이 비결정적이어서 페이지 경계의 row가
 * 누락되거나 중복 노출될 수 있다. board_id는 UNIQUE라 전순서를 보장한다. 이 정렬이
 * 목록 순서의 단일 출처이고 브라우저 쪽은 다시 정렬하지 않는다.
 *
 * 서버 측 페이지 단위 조회(`listAnnouncements` + `count: 'exact'` + 범위 초과
 * fallback)는 ADR 015로 삭제됐다 — 호출자가 없고, 남겨두면 "필터 조건마다 서버가
 * 잘라 준다" 모델이 되살아나는 입구가 된다.
 *
 * 컬럼은 `SUMMARY_COLUMNS`로 고른다. `raw_content`(row당 수 KB)를 전량 실으면
 * shell 크기가 곧바로 터진다 — ADR 015의 성장 트리거(압축 후 50KB)가 이 선택을
 * 전제로 잡혀 있다.
 *
 * 조회는 service role 클라이언트(RLS 우회)를 전제로 한다 — 빌드·재검증 시점에
 * 서버에서만 실행된다(#83 선결 확인: anon 키 직접 조회는 401).
 */
export async function listAllAnnouncementSummaries(
  client: SupabaseClient,
): Promise<AnnouncementSummary[]> {
  const { data, error } = await client
    .from(TABLE)
    .select(SUMMARY_COLUMNS)
    .order('post_date', { ascending: false })
    .order('board_id', { ascending: false });

  if (error) {
    throw new Error(`Failed to list all announcements: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as AnnouncementSummaryRow[];
  return rows.map(rowToSummary);
}

/* ------------------------------------------------------------------ */
/* 읽기 경로 — 공개 상세 조회 (#96)                                     */
/* ------------------------------------------------------------------ */

/**
 * PostgREST가 `.single()`에 "행이 정확히 1개가 아님"으로 사용하는 에러 코드.
 * 0건도 여기로 온다(에러이지 빈 데이터가 아니다).
 */
const PGRST_NO_ROWS = 'PGRST116';

/** 상세 조회 결과 row 형태 (snake_case). 표시하지 않는 컬럼도 포함한 전체 레코드. */
export interface AnnouncementFullRow {
  id: number;
  board_id: number;
  title: string;
  announcement_type: AnnouncementType;
  recruitment_type: RecruitmentType;
  complex_name: string | null;
  district: string | null;
  address: string | null;
  total_units: number | null;
  post_date: string;
  application_date: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
  raw_content: string;
  created_at: string;
  updated_at: string;
}

/**
 * DB row (snake_case) → AnnouncementRow (camelCase, 도메인 타입).
 * 순수 함수. `rowToSummary`의 전체 레코드 버전.
 */
export function rowToAnnouncement(row: AnnouncementFullRow): AnnouncementRow {
  return {
    id: row.id,
    boardId: row.board_id,
    title: row.title,
    announcementType: row.announcement_type,
    recruitmentType: row.recruitment_type,
    complexName: row.complex_name,
    district: row.district,
    address: row.address,
    totalUnits: row.total_units,
    postDate: row.post_date,
    applicationDate: row.application_date,
    attachmentUrl: row.attachment_url,
    attachmentName: row.attachment_name,
    rawContent: row.raw_content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * boardId로 공고 1건을 조회한다 (#96 상세 페이지).
 *
 * 없는 boardId는 throw가 아니라 `null`이다 — 공개 페이지의 경로는 사용자가 임의로
 * 바꿀 수 있고(`/announcements/999999`), 그것이 500이 되어선 안 된다. 404로 낼지
 * 다른 처리를 할지는 호출자가 판단한다.
 *
 * `SUMMARY_COLUMNS`처럼 컬럼을 골라 담지 않고 전체를 읽는다. 목록이 컬럼을 고른
 * 이유는 `raw_content`(row당 수 KB)를 20건 실어 보내는 비용이었는데, 상세는 1건이고
 * `raw_content`가 렌더 대상 본문 그 자체라 절약할 것이 없다.
 *
 * 조회는 service role 클라이언트(RLS 우회)를 전제로 한다 — `announcements`는 GRANT도
 * RLS도 없어 anon 키 직접 조회가 401이다(#83 선결 확인).
 */
export async function getAnnouncementByBoardId(
  client: SupabaseClient,
  boardId: number,
): Promise<AnnouncementRow | null> {
  if (!Number.isInteger(boardId) || boardId <= 0) {
    throw new RangeError(`boardId must be a positive integer, got: ${boardId}`);
  }

  const { data, error } = await client
    .from(TABLE)
    .select('*')
    .eq('board_id', boardId)
    .single();

  if (error) {
    if (error.code === PGRST_NO_ROWS) {
      return null;
    }
    throw new Error(
      `Failed to get announcement (boardId=${boardId}): ${error.message}`,
    );
  }

  return rowToAnnouncement(data as unknown as AnnouncementFullRow);
}
