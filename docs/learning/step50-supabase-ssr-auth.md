# Supabase Auth SSR — 꼭 알아야 할 멘탈 모델

`@supabase/ssr`로 Next.js(App Router)에 소셜 로그인을 붙일 때, 코드를 따라 치면 동작은 하지만 "왜 이렇게 생겼는지"가 안 보이면 디버깅이 지옥이 된다. 이 문서는 **그 구조를 떠받치는 핵심 개념 5가지**만 추린다. 청안 고유 결정(provider 선택, 게이팅 정책 등)은 ADR 009 소관이고, 여기 있는 건 어느 SSR 프로젝트에도 그대로 가져갈 수 있는 패턴이다.

---

## 1. 세션은 어디에 사는가 — localStorage가 아니라 "쿠키"

가장 먼저 깨야 할 고정관념. 순수 클라이언트 앱(CSR)에서 Supabase는 세션(JWT 토큰)을 **localStorage**에 둔다. 그러면 서버는 그걸 못 읽는다 — localStorage는 브라우저만의 것이다.

SSR에서는 서버 컴포넌트·미들웨어·Route Handler가 **"이 요청이 누구냐"를 알아야** 하므로, 세션을 **쿠키**에 둔다. 쿠키는 매 요청마다 자동으로 서버에 실려 가기 때문이다.

```
CSR:  세션 = localStorage  → 브라우저만 접근 가능
SSR:  세션 = 쿠키          → 요청마다 서버에도 전달됨 ✅
```

이 한 줄이 아래 모든 구조의 출발점이다. "왜 클라이언트가 세 종류나 필요하지?"의 답이 전부 "쿠키를 누가, 어디서 읽고 쓰느냐"로 환원된다.

---

## 2. 클라이언트가 3개인 이유 — 실행 환경마다 쿠키 접근법이 다름

`@supabase/ssr`을 쓰면 비슷해 보이는 Supabase 클라이언트를 **세 군데**서 만든다. 중복이 아니라, **각 실행 환경이 쿠키를 만지는 방법이 다르기 때문**이다.

| 클라이언트     | 만드는 곳                     | 쿠키 접근 방법               | 역할                                    |
| -------------- | ----------------------------- | ---------------------------- | --------------------------------------- |
| **browser**    | 클라이언트 컴포넌트           | `document.cookie` (자동)     | 로그인 개시(`signInWithOAuth`)·로그아웃 |
| **server**     | 서버 컴포넌트 / Route Handler | `next/headers`의 `cookies()` | 요청 주체가 누구인지 **읽기**           |
| **middleware** | `middleware.ts`               | `request`/`response` 쿠키    | 세션 토큰 **갱신**(아래 4번)            |

`createBrowserClient`는 쿠키를 알아서 처리하지만, `createServerClient`는 **쿠키 어댑터(`getAll`/`setAll`)를 직접 주입**해야 한다. 서버는 환경마다 쿠키를 읽고 쓰는 API가 다르기 때문(`cookies()` vs `request.cookies`)에, 그 차이를 어댑터로 메우는 구조다.

### 서버 컴포넌트의 한계 — "쓰기"는 막혀 있다

서버 컴포넌트(RSC)는 쿠키를 **읽을 순 있어도 쓸 수 없다**(HTTP 응답 헤더가 이미 스트리밍 중일 수 있어서). 그래서 server 클라이언트의 `setAll`은 보통 `try/catch`로 감싸고 실패를 무시한다.

```ts
setAll(cookiesToSet) {
  try {
    cookiesToSet.forEach(({ name, value, options }) =>
      cookieStore.set(name, value, options),
    );
  } catch {
    // 서버 컴포넌트에서는 쿠키 쓰기 불가 — 갱신은 미들웨어가 한다(4번)
  }
}
```

"그럼 토큰 갱신은 누가 하지?" → **미들웨어**다. 이게 미들웨어가 존재하는 이유다.

---

## 3. 세션 검증 — `getSession()`은 서버에서 신뢰하지 마라 (보안 핵심)

서버에서 "지금 로그인한 사람"을 알아내는 메서드가 3개 있는데, **신뢰도가 다르다.** 이걸 모르면 인증을 우회당한다.

| 메서드         | 동작                                           | 서버에서 신뢰?          |
| -------------- | ---------------------------------------------- | ----------------------- |
| `getSession()` | **쿠키 내용을 그대로** 반환. 검증 안 함        | ❌ 쿠키는 위조 가능     |
| `getUser()`    | 매번 Supabase Auth 서버에 토큰 **재검증 요청** | ✅ (네트워크 비용 있음) |
| `getClaims()`  | JWT **서명을 로컬 검증**(JWKS)                 | ✅ (보통 네트워크 없음) |

**핵심**: 인가(authorization) 판단 — "이 사람을 들여보낼까?" — 은 절대 `getSession()`으로 하지 않는다. 쿠키는 클라이언트가 보내는 값이라 위조될 수 있고, `getSession()`은 그걸 검사 없이 믿는다. 라우트 보호·소유권 확인은 `getUser()` 또는 `getClaims()`로 한다.

이 프로젝트는 `getClaims()`를 쓴다 — JWT 서명만 로컬에서 검증하면 되니 매 요청 네트워크 왕복이 없어 서버 컴포넌트에서 싸다. (왜 getClaims인지의 프로젝트 맥락은 ADR 009.)

```ts
const { data, error } = await supabase.auth.getClaims();
const userId = data?.claims?.sub ?? null; // JWT의 sub = user id
```

---

## 4. 미들웨어의 토큰 갱신 — 가장 안 직관적인 부분

액세스 토큰은 짧게(기본 1시간) 만료된다. 만료되면 리프레시 토큰으로 새 토큰을 받아야 하는데, **서버 컴포넌트는 쿠키를 못 쓴다(2번)**. 그래서 **미들웨어가 매 요청 앞단에서 갱신을 대행**하고, 갱신된 쿠키를 양쪽에 심는다:

- **요청(request) 쿠키**: 뒤이어 실행될 서버 컴포넌트가 새 토큰을 읽도록
- **응답(response) 쿠키**: 브라우저가 새 토큰을 저장하도록

```ts
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        // 1) 요청 쿠키 갱신 → 다운스트림 서버 컴포넌트가 읽음
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        // 2) 응답 객체 재생성 후 응답 쿠키 갱신 → 브라우저가 저장
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // ⚠️ createServerClient와 이 호출 사이에 아무 코드도 넣지 말 것
  await supabase.auth.getClaims(); // 이 호출이 토큰 갱신을 트리거

  return response; // ⚠️ 반드시 이 response를 반환 (쿠키가 여기 담김)
}
```

**두 개의 함정** (공식 문서가 굵게 경고하는 지점):

1. **`createServerClient`와 `getClaims()`(또는 `getUser()`) 사이에 코드를 넣지 마라.** 그 사이에서 다른 작업을 하면 세션 갱신 타이밍이 어긋나 사용자가 **무작위로 로그아웃**되는, 재현 어려운 버그가 난다.
2. **반드시 `supabaseResponse`를 반환하라.** 새 `NextResponse`를 직접 만들어 반환하면 갱신된 쿠키가 유실된다. 굳이 새 response가 필요하면 `response.cookies`를 복사해 옮겨야 한다.

---

## 5. OAuth 로그인의 리다이렉트 사슬 (PKCE)

소셜 로그인은 "버튼 누르면 끝"이 아니라 **여러 번의 리다이렉트**다. 흐름을 그림으로 잡아두면 디버깅이 쉬워진다.

```
[클라이언트]  signInWithOAuth({ provider, options: { redirectTo } })
      │        └ PKCE code_verifier를 쿠키에 저장하고
      ▼
[provider]    구글/카카오 로그인 화면 → 사용자 동의
      │
      ▼
[콜백 라우트]  GET /auth/callback?code=xxx        ← provider가 돌려보냄
      │        exchangeCodeForSession(code)
      │        └ 쿠키의 code_verifier + code로 세션 토큰 교환 → 쿠키에 세션 심음
      ▼
[앱]          next 경로로 리다이렉트 (로그인 완료)
```

알아야 할 포인트:

- **`redirectTo`는 콜백 라우트를 가리킨다.** provider 콘솔과 Supabase 대시보드의 allow-list에 이 URL이 등록돼 있어야 한다(미등록이면 provider가 거부). 외부 설정이 E2E의 전제가 되는 이유.
- **콜백은 반드시 server 클라이언트로** `exchangeCodeForSession`을 호출한다. PKCE `code_verifier`가 1단계에서 쿠키에 저장됐고, 교환에는 그 쿠키가 필요하기 때문. browser 클라이언트로는 안 된다.
- **`next`(복귀 경로)는 open redirect를 방어**해야 한다. 쿼리로 들어온 경로를 그대로 리다이렉트하면 `//evil.com` 같은 외부 URL로 튕길 수 있다. "`/`로 시작하고 `//`가 아닌" 내부 절대경로만 허용한다.

```ts
function sanitizeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}
```

---

## 6. 로그인 vs 열람의 책임 분리 (패턴)

- **로그인 개시·로그아웃**은 브라우저에서 일어난다 → **클라이언트 컴포넌트** + browser 클라이언트.
- **"로그인했나?" 판단(게이팅)** 은 서버에서 한다 → **서버 컴포넌트**에서 `getClaims()`로 읽고 분기.
- 로그아웃 후엔 `router.refresh()`로 서버 컴포넌트를 다시 평가시켜야 게이팅 상태가 갱신된다(클라이언트 상태만 바꾸면 서버가 그린 화면은 그대로다).

테스트 관점: `signInWithOAuth` 호출 인자(provider, redirectTo 구성)나 세션 클레임 파싱처럼 **분기·가공 로직은 순수 함수로 분리해 단위 테스트**하고, 버튼 JSX 같은 UI는 테스트하지 않는다. 실제 OAuth 왕복은 외부 콘솔 설정이 전제라 E2E로 미룬다.

---

## 7. 참고

- Supabase SSR(Next.js) 공식 가이드: https://supabase.com/docs/guides/auth/server-side/nextjs
- `getSession` vs `getUser` 보안 주의: https://supabase.com/docs/guides/auth/server-side/creating-a-client
- PKCE flow: https://supabase.com/docs/guides/auth/sessions/pkce-flow
- Next.js 미들웨어: https://nextjs.org/docs/app/building-your-application/routing/middleware
