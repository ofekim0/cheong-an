# Step 5 — Rate Limit (요청 속도 제한)

## 1. 왜 속도 제한이 필요한가

크롤러는 "내 프로그램의 편의" 이전에 **상대 서버에 부담을 주지 않을 의무**가 있다.

- **서버 보호**: 짧은 시간 안에 수십~수백 건을 연속으로 때리면 상대 서비스가 느려지거나 장애로 이어질 수 있다.
- **차단 회피**: 많은 웹사이트는 과도한 요청을 IP 단위로 차단한다(429 Too Many Requests, 403 Forbidden). 차단되면 크롤링 자체가 불가능해진다.
- **robots.txt 및 비공식 규약**: 명시적으로 금지된 경로는 건너뛰고, 크롤링 지연(`Crawl-delay`) 지시가 있으면 그 값을 따른다. 지시가 없어도 **초당 1회 이하**가 관례적인 최소선이다.
- **법·윤리적 리스크 최소화**: "의도적 공격이 아니다"를 증명하려면 속도 제한을 코드로 명시해 두는 것이 확실하다.

이 프로젝트는 청년안심주택 공고 페이지를 1시간 단위로 순회하기 때문에 트래픽은 크지 않다. 그래도 재시도 폭주나 페이지 수 증가 시 쉽게 버스트가 생기므로, **요청 간 최소 간격**을 코드 수준에서 강제한다.

## 2. 접근 방식 비교

| 방식                                | 개념                                            | 장점                              | 단점                    |
| ----------------------------------- | ----------------------------------------------- | --------------------------------- | ----------------------- |
| **단순 간격 강제 (serial spacing)** | 요청 사이 최소 N ms 대기                        | 구현 단순, 예측 가능              | 버스트 불가             |
| **Token bucket**                    | 용량 B, 초당 R개씩 토큰 충전. 요청마다 1개 소비 | 짧은 버스트 허용 + 장기 평균 제한 | 구현 복잡, 상태 더 많음 |
| **Leaky bucket**                    | 큐에 담고 일정 속도로 배출                      | 출구 속도 일정                    | 큐 관리 필요            |

**이 프로젝트의 선택**: 단순 간격 강제.

- 순차 크롤링이 주 시나리오라 버스트가 필요 없다.
- 동시 호출이 거의 없고, 있어도 직렬화되기만 하면 충분하다.
- 구현과 테스트가 단순할수록 유지보수 비용이 낮다.

> 여러 크롤러가 동시에 돌거나 병렬 수집이 필요해지면 그때 token bucket으로 교체한다. YAGNI 원칙.

## 3. 구현 설계

### 3-1. 인터페이스

```ts
createRateLimiter({ intervalMs: 1000 })
  → { acquire: () => Promise<void> }
```

각 요청 전에 `await limiter.acquire()`를 호출하면, 필요한 만큼 기다린 뒤 resolve 된다. 호출자는 속도 제어 로직을 의식하지 않아도 된다.

### 3-2. 핵심 상태 `nextAvailableAt`

"다음 요청을 시작해도 되는 시각"을 타임스탬프(ms)로 기억한다.

```
초기값 = 0  // 과거라서 첫 호출은 즉시 통과
```

`acquire()` 호출마다:

1. `current = now()`
2. `myTurn = max(current, nextAvailableAt)` — 내 순서를 잡는다.
3. `nextAvailableAt = myTurn + intervalMs` — 다음 사람 차례를 밀어둔다.
4. `waitMs = myTurn - current` — 필요한 만큼 sleep.

### 3-3. 동시 호출 시나리오 (intervalMs=1000, 세 개가 t=0에 동시 호출)

| 호출 | current | nextAvailableAt(before) | myTurn | nextAvailableAt(after) | waitMs |
| ---- | ------- | ----------------------- | ------ | ---------------------- | ------ |
| A    | 0       | 0                       | 0      | 1000                   | 0      |
| B    | 0       | 1000                    | 1000   | 2000                   | 1000   |
| C    | 0       | 2000                    | 2000   | 3000                   | 2000   |

A는 즉시, B는 1초 뒤, C는 2초 뒤에 풀린다. **자동 큐잉**이다.

이후 한참 쉬다가 t=5000에 D가 호출되면:

- `current=5000`, `nextAvailableAt=3000` → `myTurn=5000`, `waitMs=0`
- 쉬는 동안에는 제한이 누적되지 않는다. 바로 통과.

## 4. 배우는 포인트

### 4-1. Factory 패턴 + 클로저 상태

```ts
export function createRateLimiter(options): RateLimiter {
  let nextAvailableAt = 0; // 클로저에 갇힌 가변 상태
  return {
    async acquire() {
      /* nextAvailableAt 참조 */
    },
  };
}
```

- `nextAvailableAt`은 모듈 전역이 아니라 **factory가 만든 인스턴스의 내부 상태**다.
- 호출마다 `createRateLimiter(...)`를 따로 부르면 **독립된 limiter**가 생긴다. 도메인별로 다른 간격을 줄 수 있다.
- 전역 변수로 뒀다면 테스트끼리 상태를 공유해서 격리가 깨진다. factory는 이 문제를 공짜로 해결한다.

클래스 대신 factory를 쓴 이유:

- 상태가 변수 하나(`nextAvailableAt`)뿐이라 클래스의 장점이 없다.
- `this` 바인딩 걱정도 없다.
- 인터페이스(`RateLimiter`)를 반환하므로 호출부는 구현을 알 필요가 없다(캡슐화).

### 4-2. 의존성 주입: `now`, `sleep`

```ts
const { now = DEFAULT_NOW, sleep = DEFAULT_SLEEP } = options;
```

테스트에서 **가짜 시계**와 **즉시 resolve하는 sleep**을 주입하면 실제 1초를 기다리지 않고도 동작을 검증할 수 있다.

```ts
let fakeTime = 0;
const limiter = createRateLimiter({
  intervalMs: 1000,
  now: () => fakeTime,
  sleep: async (ms) => {
    fakeTime += ms;
  }, // sleep 대신 시계만 전진
});

await limiter.acquire(); // fakeTime 그대로
await limiter.acquire(); // fakeTime += 1000
```

`retry.ts`에서 쓴 패턴과 똑같다. 시간·난수처럼 "매 호출마다 달라지는 것"은 항상 주입 가능하게 열어두면 테스트가 쉬워진다.

### 4-3. 레이어링: retry와 어떻게 다른가

| 레이어      | 관심사                    | 트리거            |
| ----------- | ------------------------- | ----------------- |
| `fetchHtml` | 요청 한 건을 보낸다       | 호출 시           |
| `retry`     | 실패했을 때 다시 시도한다 | **에러 발생 시**  |
| `rateLimit` | 요청 사이 간격을 유지한다 | **모든 요청마다** |

`retry`는 "이번 시도가 실패했다"에 반응하고, `rateLimit`은 "요청을 하려 한다"에 반응한다. 서로 다른 이벤트에 대응하므로 **같은 파일에 섞지 않는다**.

조합 순서도 중요하다:

```ts
await limiter.acquire();              // 1. 속도 제한 통과
await withRetry(() => fetchHtml(...)) // 2. 실패 시 내부 재시도
```

- rateLimit을 **바깥**에 두면: 재시도 백오프 대기가 rateLimit 간격과 독립적으로 흘러간다. 재시도 폭주 시에도 rateLimit이 다음 "새 요청"을 잡아준다.
- retry **안쪽에**, 즉 `withRetry(() => { await limiter.acquire(); fetchHtml(...) })`로 넣으면: 재시도 때마다 추가로 rate limit 대기가 붙어 총 지연이 늘어난다. 정중함에는 더 좋지만 지연이 길어지는 트레이드오프.
- 이 프로젝트에서는 **바깥**을 기본으로 한다. 재시도 백오프 자체가 이미 서버를 쉬게 해주기 때문.

## 5. 한계와 다음 고려사항

- **분산/멀티 프로세스에 통하지 않음**: `nextAvailableAt`은 프로세스 메모리 안에만 있다. Vercel Cron이 함수를 여러 인스턴스로 뜨우면 각자 독립적으로 속도 제한을 먹는다.
- **해결 방향**: 공유 스토리지(Redis, Supabase row with timestamp)에 `lastRequestedAt`을 기록하고, 모든 인스턴스가 같은 값을 참조하도록 한다. 단일 Cron 트리거에서는 당장 필요 없으므로 미룬다.
- **지터(jitter)는 안 넣었다**: 속도 제한은 정확히 간격을 유지하는 게 목적이라 난수로 흔들 이유가 없다. 지터는 _재시도_ 쪽에서 "동시에 몰리는 것"을 분산시키기 위해 쓴다. 역할이 다르다.

## 6. 테스트 포인트 (다음 작업)

- 연속 `acquire()` 두 번 호출 시 두 번째가 `intervalMs` 만큼 대기하는지
- 충분히 쉰 뒤 호출하면 대기 0인지
- 세 개 동시 호출 시 0ms / intervalMs / 2·intervalMs 순서로 풀리는지
- `now`/`sleep`을 주입해 **실제 시간을 쓰지 않고** 검증할 수 있는지
