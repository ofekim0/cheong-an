# ADR 009: Supabase Auth 소셜 로그인 도입 — MVP에 인증 편입 (구글·카카오)

- **상태**: 승인됨
- **작성일**: 2026-06-25
- **관련 이슈**: #39 (Step 9 웹 푸시), 신규 로그인 Step

## 맥락

웹 푸시 파이프라인(#39)의 9-b 설계 중, 구독을 무엇에 묶을지가 문제가 됐다. 원래 `docs/PROJECT_PLAN.md`와 `HANDOFF.md`는 **"MVP에 로그인 없음"**을 암묵 전제로 짜여 있었고(로그인은 어느 Phase에도 명시되지 않았다), ADR 008 최초안은 그 전제 위에서 **익명 구독**(endpoint UNIQUE, user 개념 없음)을 택했다.

그러나 서비스를 **로그인한 사용자 기준으로 운영**하기로 결정했다 — 구독·발송·필터를 모두 user 단위로 다룬다. 그러면 남는 질문은 "로그인을 _언제_ 넣느냐"다: 지금(Sprint 2, 9-b 앞)이냐, 익명으로 먼저 만들고 나중에 붙이느냐.

## 고려한 선택지

### 선택지 1: 지금 로그인 도입 (Sprint 2, 9-b 앞)

소셜 로그인을 먼저 넣고, 구독·발송·필터를 처음부터 `user_id` 기준으로 만든다.

- 장점: 두 번 만들 일이 없다. 9-b/9-c/Sprint 3 필터가 모두 한 번에 user 모델로 완성된다.
- 장점: `@supabase/ssr` 표준 패턴이라 보일러플레이트가 명확하고 잘 경계 지어진 Step이다.
- 단점: Sprint 2 범위가 로그인만큼 늘어난다(단, 아래 비용 논거로 상쇄).

### 선택지 2: 익명으로 먼저(9-b/9-c) → 나중에 로그인 추가

ADR 008 최초안대로 익명 구독을 구현하고, 로그인은 후순위로 미룬다.

- 단점: 로그인이 확정인 이상 익명 버전은 버려질 운명이다. (1) 익명 9-b/9-c 구현 → (2) 나중에 `user_id` 추가 마이그레이션 → (3) 로그인 전에 생긴 **고아 익명 구독**을 사용자에 연결하는 처리까지 — 두 번 만들고 + 마이그레이션 + 고아 정리가 전부 순수 낭비다.
- 단점: 로그인 먼저 넣으면 이 비용이 전부 0이 된다.

## 결정

선택지 1 — **지금(Sprint 2, 9-b 앞)** Supabase Auth 소셜 로그인을 도입한다.

- provider: **구글 + 카카오** (둘 다 Supabase 기본 지원).
- 세션: 쿠키 기반, 미들웨어가 토큰 자동 갱신. 서버 검증은 `getClaims()`.
- 범위: **소셜 로그인만.** 이메일/비밀번호·매직링크·권한(role) 시스템은 도입하지 않는다(YAGNI).
- 인증 경계: 공고 **목록/상세 열람은 공개 유지**, 로그인은 **구독 액션에만** 요구한다.

## 근거

- **비용 최소화**: 로그인이 확정이면 순서를 바꿔 지금 넣는 것이, 익명 2회 구현 + `user_id` 마이그레이션 + 고아 구독 연결을 전부 0으로 만든다. 가장 싼 답은 "익명을 안 만드는 것"이다.
- `auth.users`를 그대로 쓰므로 **별도 user 테이블이 불필요**하다(YAGNI). `push_subscriptions.user_id`가 `auth.users.id`를 참조한다.
- `@supabase/ssr`의 SSR 패턴(browser/server 클라 + 미들웨어 + 콜백 라우트)은 공식 문서로 정형화돼 있어 위험이 낮다.

## 결과

- 패키지: `@supabase/ssr` 추가 (`@supabase/supabase-js`는 유지).
- 신규 env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — 브라우저/SSR 클라용. 기존 서버 admin용 `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`와는 별개로 공존한다.
- 신규 코드:
  - `src/lib/supabase/browserClient.ts` (`createBrowserClient`)
  - `src/lib/supabase/serverClient.ts` (`createServerClient`, 쿠키 바인딩)
  - `src/middleware.ts` (세션 갱신)
  - `src/app/auth/callback/route.ts` (`exchangeCodeForSession`)
  - 로그인/로그아웃 UI (`signInWithOAuth({ provider })`, `signOut`)
- 외부 설정(수작업): 구글·카카오 개발자 콘솔에서 OAuth 앱 등록 → client_id/secret을 Supabase 대시보드 provider 설정에 입력 → 콜백 URL을 양쪽 allow list에 등록.
- 클라이언트 역할 분담: 기존 **admin 클라(service-role)**는 크롤/크론 등 서버 컨텍스트 전용으로 유지. 사용자 요청 경로에서는 **세션 바인딩된 server 클라**를 쓴다.
- 기존 9-a 코드 영향(작음): `usePushSubscription` 훅·`urlBase64ToUint8Array`·`sw.js`는 인증과 분리돼 **무변경**. `/subscribe` 페이지·`PushSubscribeButton`만 비로그인 시 로그인 유도로 게이팅한다.
- **계획 영향**: `PROJECT_PLAN.md` Sprint 2에 로그인을 신규 편입한다(기존엔 어느 Phase에도 없던 암묵 익명 전제를 명시적으로 수정). Sprint 3 필터는 클라 전용(Zustand persist)이 아니라 `user_id` 기준 서버 측으로 간다.
- **ADR 008 영향**: 008은 이 결정 위에서 익명 → user 연결 모델로 갱신한다(별도). 익명 전제(대전제)가 깨졌으므로 008 최초안은 더는 유효하지 않다.
