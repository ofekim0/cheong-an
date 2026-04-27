/**
 * 외부 서버에 정중하게 요청하기 위한 속도 제한 유틸.
 *
 * 책임 범위:
 * - 연속된 요청 사이에 최소 간격을 강제한다.
 * - 동시에 acquire()가 호출되어도 순차 큐잉되어 하나씩 풀린다.
 *
 * 책임이 나닌 것:
 * - HTTP 요청 자체 (fetchHtml의 일)
 * - 실패 재시도 (retry의 일)
 * - 분산 환경 간 공유 rate limit (단일 프로세스 전제)
 */

export interface RateLimiterOptions {
  /** 요청 사이 최소 간격(ms) */
  intervalMs: number;
  /** 현재 시각 반환 - 테스트에서 교체 가능 */
  now?: () => number;
  /** 대기 구현 - 테스트에서 교체 가능 */
  sleep?: (ms: number) => Promise<void>;
}

export interface RateLimiter {
  /** 다음 요청을 보내도 되는 시점까지 대기한다. */
  acquire: () => Promise<void>;
}

const DEFAULT_NOW = () => Date.now();
const DEFAULT_SLEEP = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 주어진 간격으로 호출을 직렬화하는 RateLimiter를 생성한다.
 *
 * 동작 원리
 * - nextAvailableAt: "다음 요청을 시작해도 되는 시각"을 기억.
 * - 호출 시, 현재 시각과 nextAvailableAt 중 나중 것을 내 순서로 잡고,
 * - 그 뒤에 intervalMs 만큼 다음 차례를 더 밀어둔다.
 * - 동시 호출되어도 각자 서로 다른 순서를 예약하므로 자동으로 큐잉된다.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { intervalMs, now = DEFAULT_NOW, sleep = DEFAULT_SLEEP } = options;

  // 초기값 0 -> 첫 호출은 항상 즉시 통과
  let nextAvailableAt = 0;

  return {
    async acquire() {
      const current = now();
      const myTurn = Math.max(current, nextAvailableAt);
      nextAvailableAt = myTurn + intervalMs;

      const waitMs = myTurn - current;
      if (waitMs > 0) {
        await sleep(waitMs);
      }
    },
  };
}
