/**
 * crawl_state 테이블 리포지터리.
 *
 * - crawl_state는 단일 행으로 운영한다 (마이그레이션의 INSERT ... VALUES (0)로 보장).
 * - last_board_id: 직전 크롤링 사이클까지 저장된 가장 큰 boardId.
 * - last_crawled_at: 마지막 크롤링 시각 (성공 시 갱신).
 * - updated_at: DB 트리거가 자동 갱신.
 *
 * 클라이언트는 인자로 받아 테스트에서 모킹하기 쉽게 한다.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const TABLE = 'crawl_state';

/**
 * 단일 행에서 last_board_id를 조회한다.
 *
 * - id 오름차순 첫 행을 선택 (단일 행 가정, 그래도 정렬을 명시해 안정성 확보).
 * - 행이 없거나 Supabase 에러면 throw — 마이그레이션이 깨졌거나 권한 문제 신호.
 */
export async function getLastBoardId(client: SupabaseClient): Promise<number> {
  const { data, error } = await client
    .from(TABLE)
    .select('last_board_id')
    .order('id', { ascending: true })
    .limit(1)
    .single();

  if (error) {
    throw new Error(`Failed to read crawl_state: ${error.message}`);
  }
  return data.last_board_id as number;
}

/**
 * 단일 행의 last_board_id와 last_crawled_at을 갱신한다.
 *
 * - last_crawled_at은 호출 시각(ISO)으로 명시 설정.
 * - Supabase는 update에 필터를 요구하므로 gte('id', 0) 트리비얼 필터로 단일 행 전체를 갱신.
 * - updated_at은 DB 트리거가 처리.
 */
export async function updateLastBoardId(
  client: SupabaseClient,
  lastBoardId: number,
): Promise<void> {
  const { error } = await client
    .from(TABLE)
    .update({
      last_board_id: lastBoardId,
      last_crawled_at: new Date().toISOString(),
    })
    .gte('id', 0);

  if (error) {
    throw new Error(
      `Failed to update crawl_state.last_board_id=${lastBoardId}: ${error.message}`,
    );
  }
}
