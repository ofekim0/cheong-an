# Step 5-d. MSW 통합 테스트 — `announcementService`

> 선행: [step5-service-layer.md](./step5-service-layer.md)

> 📌 **epic #19 이후 보강 — 본문 핵심은 여전히 유효합니다.**
>
> - **§4 픽스처 (`buildMainHtml`)는 폐기**. 메인 페이지 HTML 파싱을 그만뒀기 때문. 대신 실제 사이트 응답을 그대로 박제한 fixture를 단위 테스트와 통합 테스트가 공유합니다 (`__fixtures__/listJson.json`, `detailPage.html`, `viewErrorPage.html`).
> - **§5 시나리오 표는 확장**됨. JSON 응답 → gap 메우기 → view.do 보강 분기에 따라 10개 시나리오로 늘어났고, `http.post`(JSON 호출)와 `http.get`(view.do)을 함께 등록합니다.
> - **새 패턴 도입**: 시나리오마다 "어떤 boardId가 빈 번호인지" 다르게 표현하기 위해 `viewHandler(errorIds: number[])` 팩토리를 추가했습니다.
>
> §1 (MSW vs fetcher mock), §2 (셋업), §3 (가짜 시계로 시간 의존부 제거), §6 (한계)의 핵심 의도는 그대로입니다. 자세한 재설계 맥락은 [step6-data-source-redesign.md](./step6-data-source-redesign.md) 참고.

`crawlNewAnnouncements`는 fetch · retry · rateLimit · 파서 네 모듈을 합성한다. 단위 테스트로는 합성 자체가 의도대로 작동하는지 확인할 수 없다. **HTTP 경계에서 가로채는 통합 테스트**가 필요하다 — MSW가 그 도구.

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

이게 가능한 이유 — fetch/retry/rateLimit 모두 **시간 의존부를 DI 포인트로 노출**해 두었기 때문 ([step5-retry.md](./step5-retry.md), [step5-rate-limit.md](./step5-rate-limit.md) 참조). 시간을 외부에서 조작할 수 있도록 설계했기에 테스트가 빨라진다.

## 4. HTML 픽스처 — "최소 형태" 원칙

서비스 통합 테스트에서 파서가 동작해야 하지만, **파서의 정확성은 별도 단위 테스트가 보장**한다. 따라서 픽스처는 파서가 인식 가능한 최소 골격만 갖추면 된다.

```ts
function buildMainHtml(boardIds: number[]): string {
  const items = boardIds
    .map(
      (id) => `<li>
        <a href="?boardId=${id}">제목</a>
        <span class="txDate">2026-05-01</span>
      </li>`,
    )
    .join('');
  return `<ul class="mainBoard_list">${items}</ul>`;
}
```

이 골격은 `parseMainPage`의 선택자 (`ul.mainBoard_list > li > a[href*=boardId=]` + `span.txDate`) 만 만족시킨다. 파서가 추출하는 다른 필드(전체 HTML 컨텍스트, CSS 등)는 무관 — 통합 테스트는 boardId 흐름만 확인하면 충분하다.

## 5. 시나리오 — 6개와 각각의 검증 포인트

| #   | 시나리오                         | 검증 포인트                              | 기대 동작                                                |
| --- | -------------------------------- | ---------------------------------------- | -------------------------------------------------------- |
| 1   | 메인 비어있음                    | 메인이 비면 후속 호출이 일어나지 않는가  | newAnnouncements=[], latestBoardId=lastBoardId 그대로    |
| 2   | 모든 후보 200                    | 후보 산출 → 직렬 fetch → 파서 결과 누적  | newAnnouncements N개, skippedBoardIds=[]                 |
| 3   | 일부 후보 404                    | 404는 빈 번호로 분리, 나머지는 정상 처리 | 404 boardId만 skippedBoardIds, 나머지는 newAnnouncements |
| 4   | 메인 5xx → 200 (1회 retry)       | retry가 일시 장애를 흡수                 | 메인 호출 카운트=2, 결과는 정상                          |
| 5   | 상세 5xx 무한 (재시도 한도 초과) | retry 소진 후 호출자에게 throw           | rejects.toThrow(), 상세 호출 카운트=maxAttempts(3)       |
| 6   | 두 호출이 limiter 공유           | acquire가 호출 간격을 직렬화             | sleep 로그가 정확히 N-1개의 1000ms 호출을 가짐           |

### 시나리오 6 — 가짜 시계로 limiter 동작 관찰

가장 까다로운 시나리오. 진짜 시간을 쓰면 CI에서 흔들리고 빠르게 못 돌린다. limiter의 `now`/`sleep` DI 포인트를 활용해 결정론적으로 만든다.

```ts
let fakeNow = 0;
const sleepMsLog: number[] = [];
const limiter = createRateLimiter({
  intervalMs: 1000,
  now: () => fakeNow,
  sleep: (ms) => {
    sleepMsLog.push(ms);
    fakeNow += ms; // sleep이 끝나면 시간이 ms만큼 흐른 것으로 간주
    return Promise.resolve();
  },
});
```

같은 limiter를 두 service 호출에 주입한다. 각 호출이 fetch 2회 (메인 1 + 상세 1) → 총 4회 acquire. 기대:

- 1번째 acquire: nextAvailableAt=0, 현재=0 → 즉시 통과, sleep(0). nextAvailableAt=1000.
- 2번째 acquire: 현재=0, nextAvailableAt=1000 → sleep(1000). 현재=1000, nextAvailableAt=2000.
- 3번째: sleep(1000). 현재=2000, nextAvailableAt=3000.
- 4번째: sleep(1000). 현재=3000, nextAvailableAt=4000.

> 0 sleep 3개 → 직렬화 검증.

```ts
const realSleeps = sleepMsLog.filter((ms) => ms > 0);
expect(realSleeps).toHaveLength(3);
expect(realSleeps.every((ms) => ms === 1000)).toBe(true);
```

이 검증이 보장하는 것: **두 service 호출이 limiter 인스턴스를 공유하면 호출 간격이 글로벌하게 직렬화된다**. service A가 끝나도 limiter의 `nextAvailableAt`이 살아 있어 service B의 첫 acquire에 영향을 준다.

## 6. 한계와 다음 단계

- **MSW는 같은 프로세스 안의 fetch만 가로챈다**: 분산 환경(여러 Vercel 인스턴스)의 동작은 이 테스트로 알 수 없다 — 그건 통합 환경 또는 실제 프로덕션 모니터링의 일.
- **파서 형식 변경 감지 없음**: 픽스처를 최소 골격으로 짰기 때문에, 실제 청년안심주택 사이트가 마크업을 바꾸면 이 테스트는 통과하지만 운영은 깨진다 → 별도로 실 사이트 fixture를 주기적으로 갱신하는 단위 테스트(parseMainPage.test.ts 등)가 1차 방어선.
- **타임아웃 시나리오 미커버**: 503/404만 다뤘다. fetchHtml의 `TimeoutError` 경로는 별도 시나리오로 추가 고려 (MSW가 응답을 지연시키는 방식 또는 AbortController 강제 트리거).

## 7. 다음 단계

- 검증 끝나면 `*.test.tmp.ts` → `*.test.ts`로 손수 옮기고 `pnpm test`로 그린.
- 그 다음 Sprint 1 잔여:
  - **상세 페이지 검증**: `findNewBoardIds`가 빈 번호도 후보에 넣는데, 운영 단계에서 어떻게 다룰지 (현재는 404 catch만 있음).
  - **Supabase 연동**: 결과를 받아 insert + `lastBoardId` 갱신.
  - **스케줄러**: Vercel Cron / GitHub Actions 1시간 주기.
