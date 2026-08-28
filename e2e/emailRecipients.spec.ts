/**
 * 이메일 수신자 조회 실 DB E2E (#65 Step c, ADR 010/011).
 *
 * `getEmailRecipients`는 ① notification_preferences.email_enabled = true 계정
 * 조회(PostgREST) + ② 계정마다 auth.admin.getUserById로 주소 확보(Auth admin
 * API)의 2단 조회다. 유닛은 쿼리 빌더·admin API를 mock하므로, 실 PostgREST
 * 필터와 실 Auth API 응답 형태(data.user.email)를 관통하는 동작은 실 DB로만
 * 검증한다 — getEnabledChannels e2e(9-d-c)와 같은 논리.
 *
 * 검증 밖(자동화 경계, ADR 010 연장):
 * - 실 Resend 발송·배달 — 웹 푸시의 실 FCM 배달과 같은 위치. 수동 스모크.
 * - 주소 없는 계정 스킵 — admin createUser가 email을 요구해 실 DB로 만들기
 *   어렵고, 유닛(emailRecipientsRepository.test)이 이미 덮는다.
 *
 * 실제 함수를 그대로 import한다. 이 모듈의 비상대 import는 전부 `import type`
 * 이라 런타임에 erase되므로 `@/` 별칭 해석이 필요 없다.
 */

import { expect, test } from '@playwright/test';

import { getEmailRecipients } from '../src/lib/supabase/emailRecipientsRepository';
import {
  clearPushData,
  ensureUser,
  getAdminClient,
  setEmailPreferenceRow,
} from './helpers/testUser';

// 다른 스펙(TEST_USER·SEND_USER)과 병렬 실행 충돌을 피하려고 전용 계정을 쓴다.
const EMAIL_USER_A = {
  email: 'e2e-email-a@cheong-an.test',
  password: 'e2e-email-a-1234!',
};
const EMAIL_USER_B = {
  email: 'e2e-email-b@cheong-an.test',
  password: 'e2e-email-b-1234!',
};

test.describe('getEmailRecipients — email_enabled 계정의 주소 확보 (실 DB 2단 조회)', () => {
  // 두 테스트가 같은 시드 유저를 공유하므로 직렬 실행한다 — fullyParallel에서
  // 한 테스트의 beforeEach clearPushData가 다른 테스트의 시드를 지우는 race 방지.
  test.describe.configure({ mode: 'serial' });

  let userAId: string;
  let userBId: string;

  test.beforeAll(async () => {
    userAId = await ensureUser(EMAIL_USER_A.email, EMAIL_USER_A.password);
    userBId = await ensureUser(EMAIL_USER_B.email, EMAIL_USER_B.password);
  });

  test.beforeEach(async () => {
    await clearPushData(userAId);
    await clearPushData(userBId);
  });

  test.afterAll(async () => {
    await clearPushData(userAId);
    await clearPushData(userBId);
  });

  test('enabled 계정은 auth.users 주소와 함께 포함, disabled 계정은 제외', async () => {
    await setEmailPreferenceRow(userAId, true);
    await setEmailPreferenceRow(userBId, false);

    const recipients = await getEmailRecipients(getAdminClient());
    const userIds = recipients.map((r) => r.userId);

    // 공유 테스트 프로젝트라 타 계정 수신자가 섞일 수 있어 포함/제외로 단언한다.
    expect(userIds).toContain(userAId);
    expect(userIds).not.toContain(userBId);

    // 주소는 저장값이 아니라 auth.users에서 실시간 조회된다 (ADR 011 축3).
    const recipientA = recipients.find((r) => r.userId === userAId);
    expect(recipientA).toEqual({
      userId: userAId,
      email: EMAIL_USER_A.email,
    });
  });

  test('enabled였던 계정을 disabled로 바꾸면 제외된다', async () => {
    await setEmailPreferenceRow(userAId, true);

    const before = (await getEmailRecipients(getAdminClient())).map(
      (r) => r.userId,
    );
    expect(before).toContain(userAId);

    await setEmailPreferenceRow(userAId, false);

    const after = (await getEmailRecipients(getAdminClient())).map(
      (r) => r.userId,
    );
    expect(after).not.toContain(userAId);
  });
});
