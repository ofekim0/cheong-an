/**
 * E2E 공고 시드 하네스 (#101, ADR 010).
 *
 * 전용 테스트 프로젝트(cheong-an-test)의 `announcements`는 크롤이 돌지 않아
 * 비어 있다(2026-09-04 확인: 0건). 목록 → 상세 이동을 검증하려면 스펙이 직접
 * row를 넣어야 한다. `testUser.ts`가 유저·구독 row를 시드하는 것과 같은 역할이다.
 *
 * 시드는 **결정적 고정값**이다. 로컬은 dev 서버를 재사용하는데(`reuseExistingServer`)
 * 목록·상세가 `'use cache'`라 이전 실행의 캐시가 남을 수 있다. 내용이 매번 같으면
 * 캐시 히트든 미스든 같은 화면이라 판정이 흔들리지 않는다.
 */

import { getAdminClient } from './testUser';

/**
 * 시드 공고. `board_id`는 실제 공고 범위(2026-09 기준 ~6645)와 겹치지 않는 값을 쓴다.
 *
 * 컬럼은 `AnnouncementInsertRow`(announcementsRepository)와 같다 — 스키마가
 * 바뀌면 여기도 함께 깨져야 하므로 타입을 import하지 않고 직접 나열한다(이 모듈은
 * `@/` 별칭 해석이 없는 Playwright 런타임에서 실행된다).
 *
 * `attachment_url`을 null로 두는 이유: #98은 "첨부가 없어도 원본 링크는 항상
 * 노출한다"를 근거로 만들어졌다. 그 경로를 그대로 검증한다.
 */
export const SEED_ANNOUNCEMENT = {
  board_id: 990001,
  title: 'E2E 시드 공고 — 청안테스트 청년안심주택',
  announcement_type: 'private',
  recruitment_type: 'initial',
  complex_name: '청안테스트타워',
  district: '강남구',
  address: '서울특별시 강남구 테스트로 1',
  total_units: 42,
  post_date: '2026-01-15',
  application_date: '2026-02-01',
  attachment_url: null,
  attachment_name: null,
  raw_content:
    'E2E 시드 본문 첫 줄입니다.\n둘째 줄은 줄바꿈 보존을 확인합니다.',
} as const;

/** 시드 공고를 upsert한다(`board_id` 충돌 키 — 멱등). */
export async function seedAnnouncement(): Promise<void> {
  const admin = getAdminClient();
  const { error } = await admin
    .from('announcements')
    .upsert(SEED_ANNOUNCEMENT, { onConflict: 'board_id' });
  if (error) throw error;
}

/** 시드 공고를 삭제한다(`afterAll` 정리용). */
export async function deleteAnnouncement(boardId: number): Promise<void> {
  const admin = getAdminClient();
  const { error } = await admin
    .from('announcements')
    .delete()
    .eq('board_id', boardId);
  if (error) throw error;
}
