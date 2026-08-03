/**
 * 이메일 알림 opt-in 엔드포인트 (#65, Step a — ADR 011).
 *
 * 멀티채널 모델(ADR 011): 채널별 구독 의사는 notification_preferences의
 * 채널 컬럼(email_enabled)에 저장한다. 이메일은 배달 채널이 계정의
 * 이메일 주소이고 그 주소는 발송 시점에 auth.users.email에서 조회하므로,
 * 웹 푸시의 push_subscriptions 같은 별도 배달-채널 테이블이 없다.
 *
 * POST — 이메일 알림 켜기. 역량 기반 게이팅(ADR 011 축1): 세션 사용자에게
 *   이메일 주소가 없으면(예: 카카오 로그인) 켤 수 없으므로 400. 주소가 없는
 *   계정이 email_enabled=true여도 발송 측이 주소를 못 찾아 무의미하므로
 *   진입 단계에서 막는다.
 * DELETE — 이메일 알림 끄기. 주소 유무와 무관하게 항상 허용.
 *
 * 쓰기는 세션 바인딩된 server 클라로 수행해 RLS(user_id = auth.uid())가
 * 소유권을 강제하게 한다(웹 푸시 route와 동일).
 *
 * 에러 매핑:
 *   - 401: 비로그인.
 *   - 400: (POST) 이메일 주소 없는 계정.
 *   - 500: DB 예외.
 */

import { NextResponse } from 'next/server';

import { getSessionUser } from '@/lib/auth/getSessionUser';
import { setChannelPreference } from '@/lib/supabase/notificationPreferencesRepository';
import { getSupabaseServerClient } from '@/lib/supabase/serverClient';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 역량 게이팅: 이메일 주소가 없으면 이메일 채널을 켤 수 없다.
  if (!user.email) {
    return NextResponse.json(
      { error: 'No email address on this account' },
      { status: 400 },
    );
  }

  try {
    const client = await getSupabaseServerClient();
    await setChannelPreference(client, user.userId, 'email', true);

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[notifications/email] POST failed:', err);
    return NextResponse.json(
      { error: 'Failed to enable email notification', message },
      { status: 500 },
    );
  }
}

export async function DELETE(): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const client = await getSupabaseServerClient();
    await setChannelPreference(client, user.userId, 'email', false);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[notifications/email] DELETE failed:', err);
    return NextResponse.json(
      { error: 'Failed to disable email notification', message },
      { status: 500 },
    );
  }
}
