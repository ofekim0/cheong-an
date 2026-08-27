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
 *   7. 신규 공고가 있으면 채널 어댑터별로 구독 계정에 발송 (9-c → ADR 011
 *      채널 플러그형. 현재 웹 푸시, 이메일은 Step b-2).
 *   8. JSON 응답: { newCount, skippedBoardIds, invalidBoardIds, latestBoardId,
 *      notifications: { web_push: {...} } }.
 *
 * 환경변수:
 *   - CRON_SECRET (필수): Bearer 인증.
 *   - CANARY_BOARD_ID (선택): 디테일 카나리에 쓸 안정 boardId. 미설정 시 리스트
 *     불변식만 검증(canary가 console.warn). 모집 종료 후 내려갈 수 있으므로 env로 분리.
 *   - VAPID_SUBJECT / NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY:
 *     웹 푸시 발송 자격 증명. 미설정이면 해당 채널만 실패
 *     (notifications.web_push.error)하고 크롤은 정상.
 *
 * 에러 매핑:
 *   - 401: 토큰 누락 또는 불일치.
 *   - 500: CRON_SECRET 미설정, 카나리 검증 위반, 또는 크롤러/DB 예외.
 *   - 알림 발송 실패는 500이 아니다: 저장·lastBoardId 갱신이 이미 끝난 뒤라
 *     500을 내면 다음 크롤이 같은 공고를 재발송해 중복 알림이 된다. 유실을
 *     수용하고 응답의 notifications.<channel>.error + 로그로만 남긴다.
 *
 * 캐싱: cron 트리거이므로 dynamic = 'force-dynamic'으로 매 호출 실행 보장.
 */

import { NextResponse } from 'next/server';

import { crawlNewAnnouncements } from '@/lib/crawler/announcementService';
import { runCanary } from '@/lib/crawler/canary';
import { dispatchNotifications } from '@/lib/notifications/notificationService';
import { webPushAdapter } from '@/lib/notifications/webPushAdapter';
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

    // 발송은 저장·lastBoardId 갱신이 끝난 뒤에만 시도한다. 반대로 하면 발송
    // 장애 시 다음 크롤이 같은 공고를 재감지해 중복 알림이 되므로, "알림 1회
    // 유실 가능"을 수용하는 쪽을 택했다 (ADR 008). 신규가 없으면 각 어댑터가
    // 대상 조회 없이 no-op. 채널 실패는 서비스가 채널 단위로 격리해
    // { error }로 돌려주므로(throw 없음) 여기서는 결과만 응답에 싣는다.
    const notifications = await dispatchNotifications({
      client,
      details: newDetails,
      adapters: [webPushAdapter],
    });

    return NextResponse.json({
      newCount: newDetails.length,
      skippedBoardIds,
      invalidBoardIds,
      latestBoardId,
      notifications,
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
