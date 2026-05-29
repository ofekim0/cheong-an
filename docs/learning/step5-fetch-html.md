# Step 5-1: fetchHtml — HTTP GET 래퍼

> 파일: `src/lib/crawler/fetchHtml.ts`
> 역할: 서비스 레이어의 가장 낮은 층. 한 번의 HTTP 요청을 안전하게 보낸다.

## 왜 이 레이어가 따로 필요한가

파서(`parseMainPage`, `parseDetailPage`)는 **순수 함수**로 설계했다 (HTML 문자열 → 구조화된 데이터). 순수 함수는 테스트하기 쉽지만, 실제 HTML을 가져오는 것은 외부 세계와 접촉하는 부수 효과(side effect)다. 이 부수 효과를 파서와 섞으면:

- 파서 테스트마다 네트워크가 필요해진다.
- 실패 원인이 "네트워크 문제"인지 "파싱 버그"인지 구분하기 어렵다.
- 재시도/rate limit 같은 정책이 파서에 스며들어 응집도가 깨진다.

그래서 "가져오는 책임"과 "해석하는 책임"을 분리한다. `fetchHtml`은 가져오기만 한다.

## 학습 포인트

### 1. Web Fetch API는 Node 18+에서 기본 제공

Node 18부터 글로벌 `fetch`가 들어왔다. `node-fetch`, `axios` 같은 외부 의존성 없이 쓸 수 있다. Next.js(App Router) 서버 런타임에서도 동일하게 쓸 수 있어 일관성 있다.

### 2. AbortController로 타임아웃 구현하기

`fetch`는 자체 타임아웃 옵션이 없다. 네트워크가 끊긴 서버 상대라면 TCP 타임아웃(수십 초~수 분)까지 멈추지 않는다. 해결책:

```ts
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
fetch(url, { signal: controller.signal });
```

- `AbortController`는 Web 표준 API — 요청을 외부에서 취소할 수 있는 "리모컨".
- `signal`을 넘기면 `fetch`가 신호를 듣고 있다가 abort가 호출되면 요청을 끊는다.
- 끊기면 `AbortError`가 throw된다 → 우리가 `TimeoutError`로 재포장.
- `finally`에서 `clearTimeout` 필수: 요청이 제때 끝났는데 타이머가 살아있으면 나중에 엉뚱한 요청을 끊을 수 있다.

### 3. User-Agent — 크롤러의 매너

서버 입장에서 User-Agent가 비어있거나 일반 브라우저 문자열을 사칭하는 봇은 불쾌하다. 우리는:

- 봇임을 명시한다 (`cheong-an-bot/0.1`).
- 연락처를 담는다 (GitHub URL). 문제가 있으면 차단 전에 연락받을 수 있도록.

공공기관 사이트는 저빈도(1시간 간격) + 정직한 User-Agent면 일반적으로 문제없다.

### 4. 에러를 구체 타입으로 나누는 이유

위로 올라갈수록(retry 레이어) 에러 종류에 따라 행동이 달라져야 한다:

| 에러                      | 재시도? | 이유                            |
| ------------------------- | ------- | ------------------------------- |
| `TimeoutError`            | ✅      | 일시적 네트워크 문제일 가능성   |
| `HttpError(5xx)`          | ✅      | 서버 일시 장애                  |
| `HttpError(4xx)`          | ❌      | 클라이언트 잘못 — 반복해도 실패 |
| `InvalidContentTypeError` | ❌      | URL 자체가 잘못되었을 가능성    |

`throw new Error("요청 실패")` 식으로 뭉뚱그리면 이 분기를 할 수 없다. **에러 타입 = 상위 레이어가 읽을 수 있는 신호**.

사용 예: `if (err instanceof HttpError && err.status >= 500) retry();`

### 5. 의존성 주입용 `fetchImpl`

함수 시그니처를 보면 `fetchImpl?: typeof fetch`가 있다. 테스트에서 이렇게 쓴다:

```ts
await fetchHtml(url, { fetchImpl: mockFetch });
```

MSW를 쓰면 전역 `fetch`를 가로채서 이 주입 없이도 테스트 가능하지만, 이 옵션은 **보험**이다:

- MSW 셋업 없이 빠른 단위 테스트가 필요할 때.
- 특정 시나리오(타임아웃, 특정 에러)를 MSW보다 직관적으로 재현하고 싶을 때.

일반적으로는 MSW를 쓰되, 의존성 주입 구멍은 열어두는 편이 유연하다. 이 패턴은 "필요할 때만 주입, 안 주입하면 실제 동작" — 사용자에게 부담을 주지 않는다.

### 6. Content-Type 검증은 방어적 체크

`view.do?boardId=999999999` 같은 존재하지 않는 ID는 서버가 200 + 에러 페이지 HTML을 반환할 수 있고, 반대로 서버 에러 페이지가 text/plain일 수도 있다. Content-Type이 HTML이 아니면 즉시 컷 → 뒤 단계(파서)가 이상한 입력으로 헷갈리지 않는다.

단, 검증은 "**있으면** 체크" 수준으로만 한다. 일부 서버는 헤더를 누락시키니까 없으면 통과.

## 핵심 분리 원칙

**fetchHtml은 "한 번의 시도"만 안다.** 재시도는 그보다 위 레이어의 책임. 에러 타입을 구체화하면 상위 레이어가 그 타입으로 행동을 분기할 수 있다.
