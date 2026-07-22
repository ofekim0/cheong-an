# ADR 010: 웹 푸시 E2E 테스트 전략 — 세션 주입 + 자동화 경계

- **상태**: 승인됨
- **작성일**: 2026-07-20
- **관련 이슈**: #39 (Step 9-d)
- **관련 ADR**: 008 (구독 저장 모델), 009 (소셜 로그인)

## 맥락

9-d는 2026-07-20에 수동으로 실검증한 관통 경로 — **로그인 → 구독 → 신규 공고 → 알림 수신** — 을 자동화하는 Step이다. HANDOFF의 다음 할 일에 "수동으로 검증한 경로의 자동화"로 명시돼 있다.

문제는 이 경로가 다섯 마디로 나뉘는데, 그중 **세 마디가 Playwright/CI가 결정론적으로 제어할 수 없는 외부 비결정 의존**이라는 점이다:

| 마디            | 자동화              | 이유                                                                                 |
| --------------- | ------------------- | ------------------------------------------------------------------------------------ |
| ① 소셜 OAuth    | ❌ CI 불가          | 외부 서비스, 캡차·2FA, 계정 rate limit                                               |
| ② 게이팅 UI     | ✅                  | 우리 코드 (`getSessionUser` → 조건부 렌더)                                           |
| ③ 구독 → DB row | ✅ (합성 구독 전제) | UI→API→RLS→DB. 단 headless `pushManager.subscribe`는 실 FCM 구독을 비결정적으로 생성 |
| ④ 크롤 감지     | △                   | `/api/cron/crawl`이 서버측에서 라이브 soco 사이트 fetch                              |
| ⑤ FCM 배달·팝업 | ❌ CI 불가          | 실 FCM이 Playwright 인스턴스로 배달하는 것은 관측·보장 불가                          |

즉 "로그인부터 팝업 수신까지"를 **단일 CI E2E 하나로 완주하는 것은 물리적으로 불가능**하다. ①·⑤는 이미 수동 스모크(2026-07-20)로 관통 확인됐고 애초에 자동화 대상이 아니다. 9-d의 설계 질문은 "무엇을 자동화하고, 무엇을 수동 스모크로 남기며, 그 경계를 어떻게 명시하느냐"다.

## 고려한 선택지

### 선택지 1: 소유 표면 E2E — 채택

우리가 소유한 표면(②③ + 발송 절반)만 결정론적으로 자동화하고, 외부 비결정 이음매(①⑤)는 문서화된 수동 스모크로 남긴다.

- Playwright: 게이팅(②) + 구독/해제 → 실 DB row(③, RLS 실효성 포함).
- Vitest + MSW: 발송 절반(④의 감지 → 발송)을 서버 통합 테스트로 — 크롤러 fetch mock + `web-push` mock.
- 장점: CI 편입 가능·결정론적. RLS·저장의 실효성까지 실 DB로 검증. 이미 두꺼운 단위 테스트(162개)와 상보.
- 단점: 합성 구독을 쓰므로 실 FCM 구독 생성 경로 자체의 회귀는 자동으로 못 잡는다(수동 스모크 담당).

### 선택지 2: 게이팅-only E2E (API·DB 전부 mock) — 폐기

로그인 게이팅과 구독 UI 상태 전이만 자동화하고 API/DB를 전부 mock.

- 폐기 사유: RLS·저장의 실효성(남의 row 거부, L1/L2 row 생성)을 전혀 검증하지 못한다 — 9-b/9-c에서 실 DB로만 확인 가능하던 부분이 자동화의 사각으로 남는다. 자동화 가치가 UI 렌더 확인에 그친다.

### 선택지 3: 최대 실측 (실 OAuth·실 push, 비CI) — 폐기

헤디드 브라우저로 실 OAuth·실 push까지 몰아 자동화.

- 폐기 사유: 실 OAuth 입력·실 `pushManager.subscribe`·실 FCM 배달이 전부 비결정적이라 가장 fragile하고 CI 불가. 사실상 수동 스모크의 취약한 스크립트화일 뿐, 이미 있는 수동 스모크 대비 이득이 없다.

## 결정

선택지 1 — **소유 표면 E2E**. 세부 결정은 다음과 같다.

- **인증(세션 주입, 실 OAuth 우회)**: Playwright `setup` 프로젝트가 테스트 실행 전 1회 — 전용 테스트 프로젝트의 `service_role`로 `auth.admin.createUser({ email_confirm: true })` → anon 키로 `signInWithPassword` → `@supabase/ssr`가 읽는 쿠키(`sb-<ref>-auth-token`) 형태로 `storageState`에 기록. 이후 스펙은 로그인된 상태에서 시작한다.
- **브라우저 구독(합성)**: `context.grantPermissions(['notifications'])` + init script로 `pushManager.subscribe/getSubscription`을 고정 endpoint/keys를 돌려주는 합성 구독으로 스텁한다(headless FCM 구독 생성의 비결정성 회피). 클릭 시 실제 `POST /api/push/subscribe`가 나가고 세션 바인딩 server 클라 → RLS → 실 DB에 L1/L2 row가 써진다.
- **발송 절반(Vitest + MSW)**: 크롤 라우트는 서버측 라이브 fetch라 브라우저 route 가로채기가 안 닿는다. 이 절반은 서버 통합 테스트로 다룬다 — 크롤러 fetch를 MSW로 mock해 신규 1건 유도 → `web-push` mock → `push:{sent:1}` + 만료 정리 검증.
- **테스트 백엔드(전용 테스트 Supabase 프로젝트)**: 프로덕션과 격리된 무료 프로젝트. 프로덕션 데이터 오염 0. 설정: `Automatically expose new tables` ON 유지(00001이 GRANT를 명시하지 않으므로 끄면 `announcements`/`crawl_state` 접근이 깨진다), `Enable automatic RLS` OFF(announcements는 의도적으로 RLS 미적용 — ADR 008). 마이그레이션 00001·00002는 SQL Editor로 수동 적용. **테스트 프로젝트는 OAuth provider 설정이 불필요**하다(세션 주입이 OAuth를 우회).

### 자동화 경계 (명시)

다음 셋은 **자동화 대상이 아니다** — 문서화된 수동 스모크로 유지한다:

1. 실 소셜 OAuth 로그인 (①).
2. 실 `pushManager.subscribe`의 FCM 구독 생성 (③의 브라우저 절반 — 자동 테스트는 합성 구독으로 대체).
3. 실 FCM 배달 + OS 알림 팝업 수신 (⑤).

## 근거

- 세 이음매가 외부 비결정 의존이므로 단일 CI E2E 완주는 불가능하다. 소유 표면만 결정론적으로 자동화하는 것이 가치/비용 최적이다.
- 세션 주입은 `@supabase/ssr`의 쿠키 계약만 알면 되는 표준 패턴이라 위험이 낮다. password 유저 생성은 **테스트 하네스 한정**이며 제품의 소셜 전용 정책(ADR 009)을 바꾸지 않는다.
- 전용 테스트 프로젝트는 실 RLS까지 검증하면서 프로덕션을 격리한다 — `step9b-supabase-rls §7`이 "정책 실효성은 실 DB가 필요한 E2E 영역"이라 한 부분을 이 프로젝트가 담당한다.
- 발송 절반을 Playwright가 아닌 Vitest+MSW로 두는 것은 크롤 라우트의 서버측 fetch 특성상 자연스럽고, 라이브 사이트 의존(비결정)을 제거한다.

## 결과

- 신규 산출물:
  - Playwright `setup` 프로젝트 + 세션 주입 헬퍼, `.env.test`(gitignore).
  - e2e 스펙: 게이팅(비로그인→로그인 유도 / 세션→토글), 구독/해제→실 DB row, RLS 남의 row 거부 1회.
  - Vitest + MSW 발송 통합 테스트.
  - GitHub Actions e2e job (Playwright 브라우저 캐시 + 테스트 Supabase secret 주입).
- **Step 분할**: 9-d-a(하네스 + 게이팅 스펙) / 9-d-b(구독·해제 + RLS 거부) / 9-d-c(발송 절반 + CI 편입 + 학습 문서). 각 별도 브랜치·PR.
- **회귀 방지**: "E2E가 왜 소유 표면까지인가"의 근거를 남겨, 이후 실 OAuth·실 FCM 자동화를 무리하게 되살리는 것(fragile 회귀)을 막는다.
- **수용한 트레이드오프**: 합성 구독을 쓰므로 실 FCM 구독 생성 경로의 회귀는 자동 테스트가 아니라 수동 스모크에서만 잡힌다. 공고 알림의 낮은 민감도와 이미 완료된 실검증으로 MVP에서 수용한다.
