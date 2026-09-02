/**
 * 웹 푸시 구독 엔드포인트 (#39, Step 9-b).
 *
 * 구독 모델(ADR 008): 구독 의사(L1, 계정 단위)와 배달 채널(L2, 계정×기기)을
 * 분리한다. 발송(9-c)은 L1 enabled = true인 계정의 L2 채널에만 보낸다.
 *
 * POST — 구독 켜기. 호출자: 구독 UI가 PushManager.subscribe() 성공 후
 *   `PushSubscription.toJSON()` 형태를 보낸다.
 *   1. 세션에서 user_id 도출 — 구독은 항상 로그인 사용자 소유.
 *   2. body 검증 (endpoint + keys.p256dh + keys.auth 필수).
 *   3. L2 채널 UPSERT (user_id, endpoint 충돌 키 — 멱등) + L1 enabled = true.
 *
 * DELETE — 구독 끄기. L1 enabled = false만 설정한다 — 어느 기기에서 끄든
 *   계정 차원에서 꺼진다(전 기기 공유). L2 row와 브라우저 푸시 채널은
 *   건드리지 않는다: 같은 기기의 다른 계정 채널을 보호하고, 죽은 채널
 *   정리는 발송 시 410 Gone(9-c)이 담당한다.
 *
 * 쓰기는 admin 클라가 아니라 세션 바인딩된 server 클라로 수행해
 * RLS(user_id = auth.uid())가 소유권을 강제하게 한다.
 *
 * 에러 매핑:
 *   - 401: 비로그인.
 *   - 400: (POST) body가 JSON이 아니거나 필수 필드 누락.
 *   - 500: DB 예외.
 */

import { NextResponse } from 'next/server';

import { getSessionUser } from '@/lib/auth/getSessionUser';
import { setChannelPreference } from '@/lib/supabase/notificationPreferencesRepository';
import {
  subscriptionToRow,
  upsertPushSubscription,
} from '@/lib/supabase/pushSubscriptionsRepository';
import { getSupabaseServerClient } from '@/lib/supabase/serverClient';
import type { PushSubscriptionJson } from '@/types/push';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** 수신 body가 PushSubscription.toJSON() 필수 형태를 갖췄는지 검증. */
function parseSubscription(body: unknown): PushSubscriptionJson | null {
  if (typeof body !== 'object' || body === null) return null;

  const { endpoint, keys } = body as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };

  if (!isNonEmptyString(endpoint)) return null;
  if (!isNonEmptyString(keys?.p256dh) || !isNonEmptyString(keys?.auth)) {
    return null;
  }

  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const subscription = parseSubscription(body);
  if (!subscription) {
    return NextResponse.json(
      { error: 'endpoint, keys.p256dh, keys.auth are required' },
      { status: 400 },
    );
  }

  try {
    const client = await getSupabaseServerClient();
    const row = subscriptionToRow(
      user.userId,
      subscription,
      request.headers.get('user-agent'),
    );
    await upsertPushSubscription(client, row);
    await setChannelPreference(client, user.userId, 'web_push', true);

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[push/subscribe] POST failed:', err);
    return NextResponse.json(
      { error: 'Failed to save subscription', message },
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
    await setChannelPreference(client, user.userId, 'web_push', false);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[push/subscribe] DELETE failed:', err);
    return NextResponse.json(
      { error: 'Failed to disable subscription', message },
      { status: 500 },
    );
  }
}
