/**
 * 구독/해제 E2E + RLS 소유권 검증 (9-d-b, ADR 008/010).
 *
 * 합성 구독(pushStub)으로 브라우저 구독 생성만 결정론화하고, 클릭 이후의
 * POST /api/push/subscribe → 세션 바인딩 server 클라 → RLS → 실 DB 쓰기는
 * 진짜로 일어나는 것을 admin 조회로 검증한다. 마지막으로 RLS가 남의 row를
 * 실제로 가리는지(정책 실효성, step9b-supabase-rls §7)를 확인한다.
 */

import { expect, test } from '@playwright/test';

import { FAKE_SUBSCRIPTION, stubPushSubscription } from './helpers/pushStub';
import {
  clearPushData,
  createSessionClient,
  ensureTestUser,
  ensureUser,
  getAdminClient,
  getPushPreferenceRow,
  getPushSubscriptionRows,
  SECOND_USER,
  TEST_USER,
} from './helpers/testUser';

test.describe('구독/해제 (합성 구독 → 실 DB)', () => {
  let userId: string;

  test.beforeAll(async () => {
    userId = await ensureTestUser();
  });

  test.beforeEach(async () => {
    // 이전 실행 잔여 제거 — 반복 실행 멱등성.
    await clearPushData(userId);
  });

  test('구독 클릭 → L2 채널 + L1 enabled=true, 해제 → enabled=false(L2 보존)', async ({
    context,
    page,
  }) => {
    await stubPushSubscription(context, page);

    await page.goto('/subscribe');
    await expect(page.getByText('계정 구독 상태')).toBeVisible();

    // 구독: POST 201
    const postResp = page.waitForResponse(
      (r) =>
        r.url().includes('/api/push/subscribe') &&
        r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '알림 구독' }).click();
    expect((await postResp).status()).toBe(201);
    await expect(page.getByText('구독 중')).toBeVisible();

    // 실 DB: L2 채널 1건(합성 endpoint) + L1 enabled=true
    const subs = await getPushSubscriptionRows(userId);
    expect(subs).toHaveLength(1);
    expect(subs[0].endpoint).toBe(FAKE_SUBSCRIPTION.endpoint);
    expect(await getPushPreferenceRow(userId)).toMatchObject({ enabled: true });

    // 해제: DELETE 200 → L1 enabled=false, L2는 보존 (ADR 008)
    const deleteResp = page.waitForResponse(
      (r) =>
        r.url().includes('/api/push/subscribe') &&
        r.request().method() === 'DELETE',
    );
    await page.getByRole('button', { name: '알림 해제 (모든 기기)' }).click();
    expect((await deleteResp).status()).toBe(200);

    expect(await getPushPreferenceRow(userId)).toMatchObject({
      enabled: false,
    });
    expect(await getPushSubscriptionRows(userId)).toHaveLength(1);
  });
});

test.describe('RLS — 남의 row는 보이지 않는다', () => {
  test('userA 세션은 userB의 push_preferences를 조회하지 못한다(에러 아님)', async () => {
    await ensureTestUser();
    const userBId = await ensureUser(SECOND_USER.email, SECOND_USER.password);

    // userB의 L1 row를 admin(RLS 우회)으로 심는다.
    const admin = getAdminClient();
    await admin
      .from('push_preferences')
      .upsert({ user_id: userBId, enabled: true }, { onConflict: 'user_id' });

    // 대조군: admin은 userB row가 보인다.
    expect(await getPushPreferenceRow(userBId)).toMatchObject({
      enabled: true,
    });

    // userA 세션 anon 클라는 userB row가 "없는 것처럼" 보인다 — 권한 에러가
    // 아니라 빈 결과여야 RLS가 정상 동작하는 것이다(step9b-supabase-rls §1).
    const asUserA = await createSessionClient(
      TEST_USER.email,
      TEST_USER.password,
    );
    const { data, error } = await asUserA
      .from('push_preferences')
      .select('*')
      .eq('user_id', userBId);

    expect(error).toBeNull();
    expect(data).toEqual([]);

    // 정리.
    await admin.from('push_preferences').delete().eq('user_id', userBId);
  });
});
