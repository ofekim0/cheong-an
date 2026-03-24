import { expect, test } from '@playwright/test';

test('홈페이지가 정상적으로 로드된다', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/청안/);
});
