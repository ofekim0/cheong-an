# Step 5-2: retry — 재시도 정책

> 파일: `src/lib/crawler/retry.tmp.ts`
> 역할: 실패할 수 있는 작업을 "상황에 맞게" 다시 시도한다.

## 왜 재시도가 필요한가

크롤링은 네트워크 건너편의 서버에 의존한다. 상대 서버가 한순간 502를 뱉거나, 우리 쪽 TCP 연결이 흔들리는 일은 정상이다. 이런 **일시적 장애(transient failure)** 에 스케줄러 한 사이클 전체가 실패해버리면 다음 1시간 동안 새 공고를 놓친다.

하지만 "**무조건** 재시도"는 두 가지 위험이 있다:

1. **영구 오류를 반복** — `HTTP 404`는 10번 해도 404다. 시간·트래픽 낭비.
2. **서버를 두드림** — 장애 난 서버에 즉시 재요청을 퍼부으면 복구를 방해한다 (thundering herd 문제).

이 두 함정을 피하는 표준 패턴이 **"에러 분류 + 지수 백오프 + 지터"** 다.

## 학습 포인트

### 1. 재시도 가능 에러 vs 아닌 에러 (`isRetryable`)

`fetchHtml`이 구체 에러 타입을 던진 이유가 여기서 드러난다.

| 에러                                        | 재시도 | 근거                                  |
| ------------------------------------------- | ------ | ------------------------------------- |
| `TimeoutError`                              | ✅     | 네트워크 흔들림일 가능성              |
| `HttpError`, status ≥ 500                   | ✅     | 서버 측 일시 장애                     |
| `HttpError`, status 4xx                     | ❌     | 요청 자체가 잘못 — 반복해도 동일 결과 |
| `InvalidContentTypeError`                   | ❌     | 영구 오류(URL 오타 등)                |
| `TypeError` (fetch가 네트워크 단절 시 던짐) | ✅     | 관대한 기본값                         |
| 그 외                                       | ❌     | 모르면 멈춤 (silent loop 방지)        |

**원칙**: "결과가 바뀔 여지가 있는 실패"만 재시도. 결정론적 실패는 빠르게 포기(fail fast)해서 로그/알림으로 돌려야 한다.

### 2. 지수 백오프 (exponential backoff)

시도 사이의 대기 시간을 기하급수로 늘린다:

```
attempt 1 실패 → 500ms 대기
attempt 2 실패 → 1000ms 대기
attempt 3 실패 → 2000ms 대기
...
```

공식: `delay = base × 2^(attempt-1)`

왜 기하급수인가? 서버가 회복하려면 시간이 필요하다. 선형 증가(500ms, 1000ms, 1500ms)는 회복이 늦은 서버를 계속 압박한다. 기하급수는 빠르게 물러나서 **서버에 숨 쉴 공간**을 준다.

상한선(`maxDelayMs`)도 둔다. `2^10 × 500ms = 500초`처럼 비현실적인 값이 나오는 것을 막는다.

### 3. 지터 (jitter) — 동기화된 재시도 막기

여러 클라이언트가 동시에 실패하고 "정확히 500ms 뒤" 일제히 재시도하면 서버가 또 터진다. 대기 시간에 **랜덤성**을 섞어서 재시도 시점을 흩뿌린다. 몇 가지 방식이 있다:

- **Full jitter**: `delay = random(0, exp)` ← 여기서 사용
- **Equal jitter**: `delay = exp/2 + random(0, exp/2)`
- **Decorrelated jitter**: 이전 delay 기반으로 다음 delay 난수 결정

Full jitter는 단순하면서도 **분산 효과가 가장 크다**고 알려져 있다 (AWS Architecture Blog).

구현 포인트:

```ts
return Math.floor(capped * random());
```

`random()`이 0~1 사이의 값을 반환하므로, `capped * 0.3` 처럼 무작위 스케일링이 된다.

### 4. 왜 `random`과 `sleep`을 옵션으로 받는가

```ts
computeBackoffMs(attempt, base, max, random);
withRetry(task, { sleep, random });
```

- 테스트에서 `random = () => 0.5`로 고정하면 지터 결과가 결정론적이 된다 → 대기 시간이 정확히 검증 가능.
- `sleep`을 즉시 resolve하는 fake로 교체하면 **실제 시간 지연 없이** 재시도 동작을 테스트할 수 있다.

이건 fetchHtml의 `fetchImpl` 옵션과 같은 패턴 — **부수 효과의 출구를 함수 시그니처에 열어두기**. Vitest의 fake timers도 대안이지만, 명시적 주입이 더 직관적이고 디버깅이 쉽다.

### 5. 멱등성(idempotency)이 있어야 안전하게 재시도할 수 있다

재시도 유틸은 "같은 작업을 두 번 해도 안전한 경우"에만 써야 한다.

- **GET 요청**: 안전. 읽기만 하므로 몇 번을 호출해도 결과가 같다. ← 우리의 경우.
- **POST 요청**: 위험. 두 번 실행되면 이중 결제, 중복 레코드 생성 가능.

POST를 재시도해야 한다면 서버가 멱등 키(idempotency key)를 지원하거나, "이미 처리했는지 먼저 확인"하는 로직이 필요하다. 이 프로젝트는 GET만 쓰므로 이 걱정은 없다.

### 6. 제네릭 `<T>` — 어떤 작업이든 감쌀 수 있게

```ts
async function withRetry<T>(task: () => Promise<T>): Promise<T>;
```

- `task`는 "뭐든 Promise를 반환하는 함수".
- `T`는 호출부에서 결정됨:
  ```ts
  const html: string = await withRetry(() => fetchHtml(url));
  const data: Detail = await withRetry(() => fetchAndParseDetail(id));
  ```

제네릭을 쓰지 않고 `Promise<any>`로 하면 반환 타입 정보가 사라져서 호출부에서 타입 유실. 제네릭은 "컨테이너는 공통이되 담는 내용은 보존"하는 도구다.

### 7. 에러를 `unknown`으로 받는 이유

```ts
export function isRetryable(err: unknown): boolean {
```

TypeScript 4.4+에서 catch 절 변수 기본 타입이 `unknown`이다. `any`와 달리 `unknown`은 **검증 없이 쓸 수 없다** — `err.status`처럼 접근하면 컴파일 에러. 그래서 `instanceof HttpError` 같은 타입 가드로 좁혀야 한다.

이 강제가 "어떤 에러든 일단 재시도"같은 안일한 실수를 막아준다.

### 8. 루프 마지막 `throw lastError`는 왜 필요한가

```ts
for (let attempt = 1; attempt <= maxAttempts; attempt++) { ... }
throw lastError; // ← 이론상 도달 불가
```

`maxAttempts ≥ 1`이면 루프 안에서 반드시 return 또는 throw한다. 그런데 TypeScript는 루프 끝 도달 가능성을 정적으로 분석하지 못해 "함수 끝에서 반환이 없다"고 경고할 수 있다. **최종 안전망**으로 넣는다. 만약 `maxAttempts = 0` 같은 엣지케이스로 루프를 못 돌면 여기서 마지막 에러 없이(`undefined`) throw되므로 호출부 방어가 추가로 필요 — 지금은 기본값 3으로 막아둠.

## 다음 단계

`withRetry`는 "한 작업이 몇 번 실패하는가"만 본다. "전체적으로 요청을 1초에 한 번 이하로 보낸다" 같은 전역 제약은 `rateLimit.tmp.ts`가 담당한다.
