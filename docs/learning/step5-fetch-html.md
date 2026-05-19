# Step 5-1: fetchHtml — HTTP GET 래퍼

> 파일: `src/lib/crawler/fetchHtml.tmp.ts`
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

### 4-1. 커스텀 Error 클래스 문법 훑기

프론트엔드(특히 함수형 React)에서는 `class`를 직접 쓸 일이 드물다. 하지만 도메인 로직/에러 타입 설계에서는 표준 패턴이므로, 이 파일에 등장하는 문법을 짧게 정리한다.

```ts
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
  ) {
    super(`HTTP ${status} while fetching ${url}`);
    this.name = 'HttpError';
  }
}
```

#### `class` — 객체를 찍어내는 틀(blueprint)

`new HttpError(500, '...')`로 인스턴스를 만들 때마다 같은 모양의 객체가 생성된다. 하나짜리 객체라면 리터럴 `{ status, url }`로 충분하지만, **타입 식별(`instanceof`)** 이 필요하거나 여러 개를 만들 거라면 클래스를 쓴다.

#### `extends Error` — 상속

`Error`가 이미 가진 것(`message`, `stack`, `name`)을 물려받고, `status` 같은 필드만 **추가**한다. `Error`의 엔진을 재발명하지 않아도 된다.

#### `constructor` — 생성 시 1회 실행되는 초기화 함수

`new HttpError(500, '...')`로 만드는 순간 호출된다. 파라미터로 받은 값을 인스턴스 필드에 세팅하거나, 부모 초기화 등 "태어날 때 한 번만 해야 하는 일"을 여기 모은다.

#### `public readonly` — TypeScript 축약 문법

```ts
// 축약
constructor(public readonly status: number) {}

// 풀이
class X {
  public readonly status: number;
  constructor(status: number) {
    this.status = status;
  }
}
```

- `public` = 외부에서 `err.status`로 접근 가능
- `readonly` = 한 번 세팅되면 재할당 불가 (실수 방지)

#### `this` — 지금 만들어지는 이 인스턴스

`this.name = 'HttpError'`은 "지금 생성 중인 객체의 `name` 필드를 덮어쓴다"는 뜻. 같은 클래스로 100개를 만들면 각 인스턴스마다 `this`는 **자기 자신**을 가리킨다.

#### `super(...)` — 부모 constructor 호출 (자세히)

`super()`는 **부모 클래스의 constructor를 내 생성 과정 안에서 실행**한다. `HttpError extends Error`의 경우 `super(msg)`는 "`Error`의 constructor를 `msg` 인자로 호출"과 같다.

```ts
super(`HTTP ${status} while fetching ${url}`);
// ↓ 이게 대신 일어남
Error.call(this, `HTTP ${status} while fetching ${url}`);
// → this.message, this.stack 등을 Error가 세팅
```

**왜 꼭 필요한가 — "부모가 뼈대를 세워야 내가 살을 붙일 수 있다"**

인스턴스 하나를 만드는 건 한 번에 일어나는 일이 아니라 **층층이 쌓아 올리는** 과정이다:

```
1. JS 엔진이 빈 객체를 준비
2. Error의 constructor 실행 → message, stack 등 기본 필드 세팅
3. HttpError의 나머지 로직 실행 → status, url, name 세팅
4. 완성된 객체 반환
```

2번을 건너뛰고 3번부터 하면 "기초 공사 없이 2층 짓기"와 같다. 그래서 **`this`를 건드리기 전에 반드시 `super()`를 호출**해야 한다는 규칙이 있다.

```ts
// ❌ 컴파일 에러: 'super' must be called before accessing 'this'
constructor(status: number) {
  this.status = status;  // super()를 안 불렀는데 this를 만짐
  super(...);
}

// ✅ OK
constructor(status: number) {
  super(...);            // 먼저 부모 초기화
  this.status = status;  // 그 다음 내 필드
}
```

**`super(인자)` — 부모에게 뭘 넘길 건가**

`Error`의 constructor는 문자열을 받아서 `this.message`로 저장한다. 그래서 우리가 `super(\`HTTP ${status}...\`)`로 넘긴 문자열이 결국 `err.message`가 된다.

```ts
const err = new HttpError(500, 'http://x');
err.message; // 'HTTP 500 while fetching http://x' ← super로 넘긴 값
err.status; // 500 ← HttpError가 직접 세팅
err.name; // 'HttpError' ← super 이후 덮어쓴 값
```

**`super.메서드()` 형태도 있다 (참고)**

함수 호출 형태인 `super(...)`는 constructor 안에서만 쓰고, 일반 메서드에서 부모의 메서드를 부르려면 `super.메서드명()` 형태를 쓴다. 이 파일에는 안 나오지만 개념상 알아두면 좋다.

```ts
class Parent {
  greet() {
    return 'hi';
  }
}
class Child extends Parent {
  greet() {
    return super.greet() + '!';
  } // 부모 메서드를 부르고 확장
}
```

#### `this.name = 'HttpError'`는 왜 쓰는가

`Error`의 기본 `name`은 `'Error'`다. 그대로 두면 콘솔에 `Error: HTTP 500 ...`로 찍힌다. 명시하면 `HttpError: HTTP 500 ...`로 찍혀 **로그만 봐도 어떤 에러인지 즉시 식별**된다. `super()` 호출로 부모가 세팅한 기본값을 **덮어쓰는 것**이므로 순서상 `super()` 다음에 와야 한다.

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

## 다음 단계

`fetchHtml`이 던지는 에러를 받아서 재시도할지 판단하는 `retry.tmp.ts`를 만든다. 분리 포인트: **fetchHtml은 "한 번의 시도"만 안다. 재시도는 그보다 위 책임.**
