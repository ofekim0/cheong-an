/**
 * E2E 테스트 환경변수 로더 (ADR 010).
 *
 * `.env.test`는 전용 테스트 Supabase 프로젝트(cheong-an-test)의 키를 담는다.
 * Next.js dev 서버는 기본적으로 `.env.local`을 읽으므로, playwright.config가
 * 이 로더로 값을 읽어 `webServer.env`로 주입해 테스트 프로젝트를 쓰게 한다.
 *
 * 의도적으로 의존성(dotenv) 없이 최소 파서만 둔다 — KEY=VALUE, `#` 주석/빈 줄 무시.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENV_TEST_PATH = resolve(process.cwd(), '.env.test');

/** `.env.test`를 파싱해 { KEY: VALUE } 로 반환한다. 파일이 없으면 안내와 함께 throw. */
export function loadTestEnv(): Record<string, string> {
  let content: string;
  try {
    content = readFileSync(ENV_TEST_PATH, 'utf8');
  } catch {
    throw new Error(
      '.env.test를 찾을 수 없습니다. 전용 테스트 Supabase 프로젝트 키를 ' +
        '.env.test에 채워야 E2E가 동작합니다 (ADR 010 참조).',
    );
  }

  const env: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) env[key] = value;
  }

  return env;
}
