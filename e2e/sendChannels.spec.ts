/**
 * 발송 채널 조회 실 DB E2E (9-d-c, ADR 008/010).
 *
 * `getEnabledChannels`는 L1 `notification_preferences.web_push_enabled = true`
 * 계정의 L2 `push_subscriptions` 채널을 조회한다. 두 테이블에 직접 FK가 없어(둘 다
 * auth.users 참조) PostgREST 임베딩 조인이 안 돼 **애플리케이션이 2쿼리로
 * 손수 조인**한다. 이 조인/필터의 실제 동작은 유닛(쿼리 빌더 mock)이 못 덮는
 * 유일한 지점이라 실 DB로만 검증한다 — 발송 로직 나머지(집계·410/404 정리·격리)는
 * 기존 유닛(notificationService/webPushClient/route)이 이미 덮는다.
 *
 * 실제 함수를 그대로 import한다. 이 모듈의 비상대 import는 전부 `import type`
 * (PushDeliveryChannel, SupabaseClient)이라 런타임에 erase되므로 `@/` 별칭
 * 해석이 필요 없다.
 */

import { expect, test } from '@playwright/test';

import { getEnabledChannels } from '../src/lib/supabase/pushChannelsRepository';
import {
  clearPushData,
  ensureUser,
  getAdminClient,
  insertPushChannels,
  setPushPreferenceRow,
} from './helpers/testUser';

// 다른 스펙(TEST_USER)과 병렬 실행 충돌을 피하려고 전용 계정을 쓴다.
const SEND_USER_A = {
  email: 'e2e-send-a@cheong-an.test',
  password: 'e2e-send-a-1234!',
};
const SEND_USER_B = {
  email: 'e2e-send-b@cheong-an.test',
  password: 'e2e-send-b-1234!',
};

const A_ENDPOINTS = [
  'https://fcm.googleapis.com/fcm/send/e2e-send-a-1',
  'https://fcm.googleapis.com/fcm/send/e2e-send-a-2',
];
const B_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/e2e-send-b-1';

test.describe('getEnabledChannels — L1 enabled 계정의 L2 채널만 (실 DB 조인)', () => {
  // 두 테스트가 같은 시드 유저(userA)를 공유하므로 직렬 실행한다 — fullyParallel에서
  // 한 테스트의 beforeEach clearPushData가 다른 테스트의 시드를 지우는 race 방지.
  test.describe.configure({ mode: 'serial' });

  let userAId: string;
  let userBId: string;

  test.beforeAll(async () => {
    userAId = await ensureUser(SEND_USER_A.email, SEND_USER_A.password);
    userBId = await ensureUser(SEND_USER_B.email, SEND_USER_B.password);
  });

  test.beforeEach(async () => {
    await clearPushData(userAId);
    await clearPushData(userBId);
  });

  test.afterAll(async () => {
    await clearPushData(userAId);
    await clearPushData(userBId);
  });

  test('enabled 계정 채널은 포함, disabled 계정 채널은 제외', async () => {
    // userA: 구독 ON + 채널 2개 / userB: 구독 OFF + 채널 1개
    await setPushPreferenceRow(userAId, true);
    await insertPushChannels(userAId, A_ENDPOINTS);
    await setPushPreferenceRow(userBId, false);
    await insertPushChannels(userBId, [B_ENDPOINT]);

    const channels = await getEnabledChannels(getAdminClient());
    const endpoints = channels.map((c) => c.endpoint);

    // 공유 테스트 프로젝트라 타 계정 채널이 섞일 수 있어 포함/제외로 단언한다.
    for (const endpoint of A_ENDPOINTS) expect(endpoints).toContain(endpoint);
    expect(endpoints).not.toContain(B_ENDPOINT);

    // 반환된 채널은 camelCase 매핑과 keys가 온전해야 한다.
    const aChannel = channels.find((c) => c.endpoint === A_ENDPOINTS[0]);
    expect(aChannel).toMatchObject({
      userId: userAId,
      p256dh: 'e2e-p256dh',
      auth: 'e2e-auth',
    });
  });

  test('enabled였던 계정을 disabled로 바꾸면 채널이 제외된다', async () => {
    await setPushPreferenceRow(userAId, true);
    await insertPushChannels(userAId, A_ENDPOINTS);

    const before = (await getEnabledChannels(getAdminClient())).map(
      (c) => c.endpoint,
    );
    expect(before).toContain(A_ENDPOINTS[0]);

    await setPushPreferenceRow(userAId, false);

    const after = (await getEnabledChannels(getAdminClient())).map(
      (c) => c.endpoint,
    );
    for (const endpoint of A_ENDPOINTS) {
      expect(after).not.toContain(endpoint);
    }
  });
});
