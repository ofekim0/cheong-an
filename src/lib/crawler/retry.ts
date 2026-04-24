/**
 * 재시도 가능한 작업을 지수 백오프(+지터)로 반복 시도하는 유틸.
 *
 * 책임 범위:
 * - 전달받은 비동기 함수를 최대 N번 호출한다.
 * - 시도 사이에 점점 늘어나는 대기 시간을 둔다. (서버 압박 완화)
 * - "재시도해도 의미 있는 에러"와 "그렇지 않은 에러"를 구분한다.
 *
 * 책임이 아닌 것:
 * - 어떤 HTTP 요청을 할지 (fetchHtml의 일).
 * - 전역 요청 간격 관리 (rateLimit의 일).
 */

import { HttpError, InvalidContentTypeError, TimeoutError } from './fetchHtml';

export interface RetryOptions {
  /** 최대 시도 횟수 (첫 시도 포함, 기본 3) */
  maxAttempts?: number;
  /** 첫 재시도 전 대기 시간(ms, 기본 500) */
  baseDelayMs?: number;
  /**대기 시간 상한(ms, 기본 10_000) - 기하급수 폭주 방지. */
  maxDelayMs?: number;
  /** 시도 사이 sleep - 테스트에서 교체 가능. */
  sleep?: (ms: number) => Promise<void>;
  /** 난수 생성기 - 테스트에서 결정론적 값으로 교체 가능. */
  random?: () => number;
}

/**
 * 에러가 재시도 가치가 있는지 판단한다.
 * - 네트워크/서버 측 일시 장애는 재시도 -> true
 * - 클라이언트 오류(4xx) / 영구 오류는 중단 -> false
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  if (err instanceof HttpError) {
    return err.status >= 500 && err.status < 600;
  }
  if (err instanceof InvalidContentTypeError) return false;
  // 알수 없는 에러는 네트워크 쪽일 가능성이 있으므로 관대하게 재시도.
  if (err instanceof TypeError) return true;
  return false;
}

const DEFAULT_SLEEP = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 지수 백오프 + 풀 지터로 다음 대기 시간을 계산한다.
 * attemp: 1부터 시작 (첫 재시도)
 * delay = min(maxDelay, base * 2^(attempt-1)) * random(0~1)
 */
export function computeBackoffMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number = Math.random,
): number {
  const exp = baseDelayMs * Math.pow(2, attempt - 1);
  const capped = Math.min(exp, maxDelayMs);
  return Math.floor(capped * random());
}

/**
 * 주어진 작업을 재시도 정책에 따라 실행한다.
 * 성공하면 결과를 반환, 최종 실패 시 마지막 에러를 throw.
 */
export async function withRetry<T>(
  task: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 500,
    maxDelayMs = 10_000,
    sleep = DEFAULT_SLEEP,
    random = Math.random,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await task();
    } catch (err) {
      lastError = err;
      const hasMoreAttempts = attempt < maxAttempts;
      if (!hasMoreAttempts || !isRetryable(err)) {
        throw err;
      }
      const delay = computeBackoffMs(attempt, baseDelayMs, maxDelayMs, random);
      await sleep(delay);
    }
  }

  // 이론상 도달 불가 - 루프 안에서 반환하거나 throw 한다.
  throw lastError;
}
