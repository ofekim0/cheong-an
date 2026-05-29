# MSW로 합성 레이어 통합 테스트하기

fetch · retry · rateLimit · 파서 같은 모듈들을 합성한 서비스는 단위 테스트로 "합성 자체가 의도대로 작동하는지" 확인할 수 없다. **HTTP 경계에서 가로채는 통합 테스트**가 필요하다 — MSW가 그 도구.

## 1. 왜 MSW인가 — fetcher mock과의 차이

option A: `fetcher` DI 포인트를 통해 fake function 주입

```ts
const fakeFetcher = vi.fn().mockResolvedValue('<html>...</html>');
await crawlNewAnnouncements({ fetcher: fakeFetcher, lastBoardId: 0 });
```

option B: MSW로 실제 `fetch()` 호출을 가로채기

```ts
server.use(http.get(MAIN_URL, () => htmlResponse('<html>...</html>')));
await crawlNewAnnouncements({ lastBoardId: 0 }); // 기본 fetcher = fetchHtml = 진짜 fetch
```

차이가 의미 있는 곳:

- A는 fetchHtml이 가지고 있는 **상태 코드 검증, content-type 검증, HttpError 매핑**을 모두 우회한다. 즉 "503이 오면 retry가 흡수한다"라는 합성이 실제로 작동하는지를 검증하지 못한다 — fakeFetcher가 503을 표현하려면 일부러 HttpError를 throw해야 하고, 그 시점에 이미 우리가 검증하려던 실제 매핑 로직을 테스트가 모방해버린 셈이 된다.
- B는 fetchHtml까지 통째로 거치므로 "503 응답 → fetchHtml이 HttpError(503)로 매핑 → retry가 isRetryable로 판정 → 재시도" 전 흐름이 실제로 일어난다.

서비스 레이어의 "**조립이 맞물려 돌아간다**"가 검증 대상이라면, 끊는 위치는 가능한 한 바깥(네트워크 경계)이어야 한다. MSW는 정확히 그 자리.

## 2. 셋업

```ts
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers()); // 시나리오 사이 격리
afterAll(() => server.close());
```

핵심:

- **`setupServer()` 빈 인스턴스로 시작**, 시나리오마다 `server.use(...)`로 핸들러 등록. 각 테스트가 자기 시나리오 핸들러만 본다.
- **`onUnhandledRequest: 'error'`**: 예상 못 한 URL로 fetch가 새면 즉시 실패. 시나리오 누락을 빨리 잡는다.
- **`resetHandlers()` afterEach**: 다음 테스트가 이전 테스트의 핸들러를 상속하지 않게 한다.

## 3. 테스트 가속 — 진짜 시간을 안 쓴다

서비스의 기본값:

- `intervalMs = 1_000` (limiter 호출 간 1초)
- `retry baseDelayMs = 500`, `maxDelayMs = 10_000` (백오프 최대 10초)

이 값을 그대로 쓰면 6개 시나리오가 수십 초 걸린다. 두 가지 주입으로 대기를 0으로 만든다.

```ts
const FAST = {
  intervalMs: 0, // limiter 대기 무력화
  retryOptions: {
    sleep: () => Promise.resolve(), // 백오프 무력화
    random: () => 0, // 결정론적 (0 * delay = 0)
  },
};
```

이게 가능한 이유 — fetch/retry/rateLimit 모두 **시간 의존부를 DI 포인트로 노출**해 두었기 때문. 시간을 외부에서 조작할 수 있도록 설계했기에 테스트가 빨라진다.

## 4. 픽스처 — "최소 형태" 원칙

서비스 통합 테스트에서 파서가 동작해야 하지만, **파서의 정확성은 별도 단위 테스트가 보장**한다. 따라서 픽스처는 파서가 인식 가능한 최소 골격(또는 byte-faithful 실 응답)만 갖추면 된다. 통합 테스트의 관심사는 데이터 흐름이지 파서의 정확성이 아니다.

## 5. 시나리오 설계 — "합성이 무엇을 보장해야 하는가"

통합 테스트가 짚어야 할 합성 시나리오 카테고리:

| 카테고리                | 검증 포인트                              |
| ----------------------- | ---------------------------------------- |
| 정상 흐름               | 입력 → 후속 호출 → 결과 누적             |
| 일시 장애 흡수          | 5xx 한 번 → retry → 정상 결과            |
| 영구 실패 전파          | 4xx 또는 무한 5xx → 호출자에게 throw     |
| 정상 처리되는 부분 실패 | 일부 항목 실패 → 다른 항목은 계속 진행   |
| 공유 자원 일관성        | 두 호출이 limiter 인스턴스 공유 → 직렬화 |

마지막 카테고리는 특히 가짜 시계로 검증하기 좋다. 같은 limiter를 두 호출에 주입하고 `sleep` 호출 로그를 검사하면 "limiter가 글로벌하게 직렬화하는가"를 결정론적으로 확인할 수 있다.

## 6. 한계

- **MSW는 같은 프로세스 안의 fetch만 가로챈다**: 분산 환경(여러 인스턴스)의 동작은 이 테스트로 알 수 없다 — 그건 통합 환경 또는 실제 프로덕션 모니터링의 일.
- **파서 형식 변경 감지 없음**: 픽스처를 최소 골격으로 짰을 경우, 외부 사이트가 마크업을 바꾸면 통합 테스트는 통과하지만 운영은 깨진다 → 실 응답을 fixture로 박제한 단위 테스트가 1차 방어선.
- **타임아웃 시나리오는 별도 설계 필요**: MSW가 응답을 지연시키는 방식 또는 AbortController 강제 트리거가 필요.
