/**
 * 크롤링 트리거 엔드포인트 (#13).
 *
 * 호출자: GitHub Actions scheduled workflow (ADR 004).
 *   `curl --fail -H "Authorization: Bearer $CRON_SECRET" $DEPLOY_URL/api/cron/crawl`
 *
 * 흐름:
 *   1. Bearer 토큰 검증 (CRON_SECRET).
 *   2. crawl_state.last_board_id 조회.
 *   3. JSON+view.do 하이브리드로 신규 detail 확보 (ADR 002/003).
 *   4. announcements UPSERT.
 *   5. crawl_state.last_board_id / last_crawled_at 갱신.
 *   6. JSON 응답: { newCount, skippedBoardIds, latestBoardId }.
 *
 * 에러 매핑:
 *   - 401: 토큰 누락 또는 불일치.
 *   - 500: CRON_SECRET 미설정 또는 크롤러/DB 예외.
 *
 * 캐싱: cron 트리거이므로 dynamic = 'force-dynamic'으로 매 호출 실행 보장.
 */

import { NextResponse } from 'next/server';

import { crawlNewAnnouncements } from '@/lib/crawler/announcementService';
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
    const client = getSupabaseAdminClient();
    const lastBoardId = await getLastBoardId(client);

    const { newDetails, latestBoardId, skippedBoardIds } =
      await crawlNewAnnouncements({ lastBoardId });

    await upsertAnnouncements(client, newDetails);
    await updateLastBoardId(client, latestBoardId);

    return NextResponse.json({
      newCount: newDetails.length,
      skippedBoardIds,
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
