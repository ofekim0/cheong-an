/**
 * 크롤링 트리거 엔드포인트 (#13).
 *
 * 호출자: GitHub Actions scheduled workflow (ADR 004).
 *   `curl --fail -H "Authorization: Bearer $CRON_SECRET" $DEPLOY_URL/api/cron/crawl`
 *
 * 흐름:
 *   1. Bearer 토큰 검증 (CRON_SECRET).
 *   2. 라이브 카나리 검증 (파서 불변식, ADR 006) — 위반 시 즉시 500, 저장 안 함.
 *   3. crawl_state.last_board_id 조회.
 *   4. 목록 기반 크롤 + view.do 보강으로 신규 detail 확보 (ADR 002/003/007).
 *   5. announcements UPSERT (불변식 위반 row는 이미 invalidBoardIds로 격리됨).
 *   6. crawl_state.last_board_id / last_crawled_at 갱신.
 *   7. JSON 응답: { newCount, skippedBoardIds, invalidBoardIds, latestBoardId }.
 *
 * 환경변수:
 *   - CRON_SECRET (필수): Bearer 인증.
 *   - CANARY_BOARD_ID (선택): 디테일 카나리에 쓸 안정 boardId. 미설정 시 리스트
 *     불변식만 검증(canary가 console.warn). 모집 종료 후 내려갈 수 있으므로 env로 분리.
 *
 * 에러 매핑:
 *   - 401: 토큰 누락 또는 불일치.
 *   - 500: CRON_SECRET 미설정, 카나리 검증 위반, 또는 크롤러/DB 예외.
 *
 * 캐싱: cron 트리거이므로 dynamic = 'force-dynamic'으로 매 호출 실행 보장.
 */

import { NextResponse } from 'next/server';

import { crawlNewAnnouncements } from '@/lib/crawler/announcementService';
import { runCanary } from '@/lib/crawler/canary';
import { upsertAnnouncements } from '@/lib/supabase/announcementsRepository';
import { getSupabaseAdminClient } from '@/lib/supabase/client';
import {
  getLastBoardId,
  updateLastBoardId,
} from '@/lib/supabase/crawlStateRepository';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured' },
      { status: 500 },
    );
  }

  const header = request.headers.get('authorization');
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 라이브 카나리: 파서가 라이브 사이트에 대해 아직 동작하는지 검증한다.
    // 위반 시 저장 단계로 가기 전에 멈춰 S2(빈 껍데기 레코드) 오염을 막는다 (ADR 006).
    const canaryBoardId = process.env.CANARY_BOARD_ID
      ? Number(process.env.CANARY_BOARD_ID)
      : undefined;
    const violations = await runCanary({ canaryBoardId });
    if (violations.length > 0) {
      console.error('[cron/crawl] 카나리 검증 실패:', violations);
      return NextResponse.json(
        { error: 'Canary verification failed', violations },
        { status: 500 },
      );
    }

    const client = getSupabaseAdminClient();
    const lastBoardId = await getLastBoardId(client);

    const { newDetails, latestBoardId, skippedBoardIds, invalidBoardIds } =
      await crawlNewAnnouncements({ lastBoardId });

    if (invalidBoardIds.length > 0) {
      console.warn('[cron/crawl] 불변식 위반으로 저장 제외:', invalidBoardIds);
    }

    await upsertAnnouncements(client, newDetails);
    await updateLastBoardId(client, latestBoardId);

    return NextResponse.json({
      newCount: newDetails.length,
      skippedBoardIds,
      invalidBoardIds,
      latestBoardId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[cron/crawl] failed:', err);
    return NextResponse.json(
      { error: 'Crawl failed', message },
      { status: 500 },
    );
  }
}
