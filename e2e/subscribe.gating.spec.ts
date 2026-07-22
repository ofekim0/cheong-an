/**
 * 구독 페이지 로그인 게이팅 E2E (9-d-a, ADR 009/010).
 *
 * 공고 열람은 공개지만 구독 액션은 로그인을 요구한다(ADR 009). 이 스펙은
 * 그 경계가 실제로 렌더에 반영되는지 검증한다:
 *   - 비로그인: 로그인 유도만 보이고 구독 토글은 없다.
 *   - 로그인(세션 주입): 구독 토글과 계정 정보가 보인다.
 *
 * 세션은 global.setup.ts가 주입한 storageState로 공급된다(실 OAuth 우회).
 */

import { expect, test } from '@playwright/test';

test.describe('비로그인 상태', () => {
  // 주입된 세션을 무시하고 익명 컨텍스트로 방문한다.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('/subscribe는 로그인 유도만 보이고 구독 토글은 없다', async ({
    page,
  }) => {
    await page.goto('/subscribe');

    await expect(
      page.getByText('알림을 구독하려면 먼저 로그인하세요.'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Google로 로그인' }),
    ).toBeVisible();

    // 구독 토글(계정 구독 상태)은 렌더되지 않아야 한다.
    await expect(page.getByText('계정 구독 상태')).toHaveCount(0);
  });
});

test.describe('로그인 상태 (세션 주입)', () => {
  test('/subscribe는 구독 토글과 계정 정보를 보여준다', async ({ page }) => {
    await page.goto('/subscribe');

    await expect(page.getByText('계정 구독 상태')).toBeVisible();
    await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible();

    // 비로그인 유도 문구는 없어야 한다.
    await expect(
      page.getByText('알림을 구독하려면 먼저 로그인하세요.'),
    ).toHaveCount(0);
  });
});
