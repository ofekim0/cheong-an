import { defineConfig, devices } from '@playwright/test';

import { loadTestEnv } from './e2e/helpers/testEnv';

// 전용 테스트 Supabase 프로젝트 키 (.env.test)를 dev 서버에 주입한다 (ADR 010).
// Next.js는 기본적으로 .env.local을 읽으므로, 이 값들을 webServer.env로 넘겨
// process.env 우선순위(.env 파일보다 높음)로 테스트 프로젝트를 쓰게 한다.
const testEnv = loadTestEnv();

// 전용 e2e 포트: 개발용 pnpm dev(3000)와 충돌하지 않게 하고, 재사용된 서버가
// .env.local을 쓰는 사고를 막는다.
const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    // 세션 주입: 로그인된 storageState(e2e/.auth/user.json)를 만든다.
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // 기본은 로그인 상태. 익명 테스트는 스펙에서 storageState를 덮어쓴다.
        storageState: 'e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: `pnpm exec next dev --turbopack --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    // Playwright는 이 값을 process.env에 병합해 서버를 띄운다.
    env: testEnv,
  },
});
