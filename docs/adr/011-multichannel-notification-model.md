# ADR 011: 멀티채널 알림 모델 — 역량 기반 opt-in + 채널 플러그형 발송

- **상태**: 승인됨
- **작성일**: 2026-08-03
- **관련 이슈**: #65 (이메일 알림 채널, Sprint 2 #2)
- **관련 ADR**: 008 (웹 푸시 구독 저장 모델) — 이 결정이 확장하는 대상. 009 (소셜 로그인) — 채널 역량의 출처.

## 맥락

웹 푸시(#39, ADR 008)에 이어 **이메일**을 두 번째 알림 채널로 추가한다(#65). 그리고 이 서비스의 궁극 목표는 **알림톡**(사업자등록 필요 → Phase 4)이므로, 채널은 앞으로도 계속 는다. 지금 이메일 하나를 붙이는 방식이 세 번째·네 번째 채널의 비용을 결정한다.

정해야 하는 것 세 가지:

1. **채널 선택 모델** — 어떤 사용자가 어떤 채널을 받는가?
2. **발송 아키텍처** — 채널이 늘어도 발송 코드가 선형으로 커지지 않게 하려면?
3. **opt-in 저장 위치** — 이메일 구독 의사를 어디에 두는가? (ADR 008 L1 확장 여부)

### 못 바꾸는 제약 — 채널별 역량은 계정마다 다르다

로그인 provider(ADR 009)에 따라 계정이 쓸 수 있는 채널이 갈린다:

| provider | 이메일 주소                                                                                 | 웹 푸시               |
| -------- | ------------------------------------------------------------------------------------------- | --------------------- |
| 구글     | `auth.users.email` 있음                                                                     | 브라우저 구독 시 가능 |
| 카카오   | **없음** (account_email은 비즈 앱 전용, ADR 009 결과 "Allow users without an email"로 우회) | 브라우저 구독 시 가능 |
| 네이버   | 있음 (단, Supabase 비내장 provider → 커스텀 OAuth 선행 필요, 후속)                          | 브라우저 구독 시 가능 |

즉 "카카오 사용자에게 이메일 발송"은 **주소가 없어서 물리적으로 불가능**하다. 이 제약을 코드가 어떻게 표현하느냐가 축 1의 핵심이다.

## 고려한 선택지

### 축 1 — 채널 선택 모델

#### 선택지 1-A: 역량 기반 opt-in (채택)

계정이 **쓸 수 있는** 채널만 opt-in으로 노출하고, 사용자가 채널별로 켠다. 발송은 **켜진 채널 전부**로 한다.

- 이메일 채널 노출 조건 = `auth.users.email`이 있음. 카카오는 주소가 없어 **저절로** 이메일 채널이 안 뜬다 — provider를 분기하는 코드가 없다.
- 웹 푸시 채널 노출 조건 = 브라우저 구독 존재(ADR 008 그대로).
- 장점: "카카오=웹푸시만"이 정책 하드코딩이 아니라 데이터(주소 유무)에서 파생된다. 네이버·알림톡이 붙어도 규칙("역량 있으면 노출")은 불변.
- 장점: 이미 실운영 중인 웹 푸시를 구글 사용자에게서 뺏지 않는다 — 구글 사용자는 이메일·웹푸시를 자유 조합.
- 트레이드오프: 사용자가 두 채널을 모두 켜면 같은 공고가 이메일·웹푸시로 각 1회 온다. 채널별 독립 opt-in의 자연스러운 결과이며 dedup을 두지 않는다(사용자 선택으로 수용).

#### 선택지 1-B: provider 고정 (폐기)

카카오 로그인 = 웹푸시만, 구글/네이버 로그인 = 이메일만으로 강제.

- 폐기 사유: provider→채널 분기를 구독 노출·발송·게이팅 여러 곳에 심어야 하고, 채널이 늘 때마다 이 매핑을 확장해야 한다. "역량 있으면 노출"이라는 단일 규칙보다 취약하다.
- 폐기 사유: 구글 사용자가 즉시성 높은 웹 푸시를 선택할 수 없다(이메일은 스팸함 낙하·지연 위험). 이미 만든 웹 푸시 코드를 인위적으로 배제하는 것.

### 축 2 — 발송 아키텍처

#### 선택지 2-A: 채널 플러그형 일반화 (채택)

`notificationService`가 "신규 공고 → 각 채널 어댑터로 발송 → 집계"를 채널 목록 위에서 돈다. 채널마다 **어댑터 인터페이스**(대상 조회 + 발송 + 실패/만료 정규화)를 구현하고, 서비스는 어댑터를 순회한다.

- 웹 푸시 = 기존 `webPushClient` + `getEnabledChannels`가 이 인터페이스의 첫 구현.
- 이메일 = `emailClient`(Resend) + 이메일 대상 조회가 두 번째 구현.
- 알림톡(Phase 4) = 어댑터 하나 + opt-in 플래그 하나 추가로 끝난다 — 이번 리팩터링이 알림톡의 사전 준비를 겸한다.
- 장점: 채널별 격리(한 채널 실패가 다른 채널을 막지 않음)를 서비스 레벨에서 일관 적용(ADR 006/007의 row별 격리 철학 연장).

#### 선택지 2-B: 채널마다 별도 서비스 (폐기)

`emailNotificationService`를 `notificationService`와 병렬로 두고 cron이 각각 호출.

- 폐기 사유: 신규 공고 판정·페이로드 골격·집계·cron 연결이 채널마다 복제된다. 세 번째 채널에서 삼중 복제. 채널 플러그형이 이 중복을 0으로 만든다.

### 축 3 — 이메일 opt-in 저장 위치

웹 푸시는 L1(구독 의사, 계정 단위)·L2(배달 채널, 계정×기기)로 나뉜다(ADR 008). 이메일은 **배달 채널이 곧 계정의 이메일 주소**이고 그 주소는 `auth.users`에서 온다 — 별도 L2 테이블이 필요 없다. 남는 것은 L1(이메일을 받겠다는 의사)뿐이다.

#### 선택지 3-A: L1을 계정 단위 `notification_preferences`로 일반화 + 채널별 enable 컬럼 (채택)

ADR 008의 `push_preferences`(계정당 1 row, `enabled`)를 `notification_preferences`로 이름을 넓히고, 단일 `enabled`를 채널별 플래그로 바꾼다: `web_push_enabled`, `email_enabled`(+ 알림톡 시 `alimtalk_enabled` 컬럼 추가).

- 장점: 계정당 1 row 유지 — 조회·RLS·UPSERT 패턴이 ADR 008 그대로. Sprint 3의 지역구/유형 **필터가 계정 단위**(채널 무관)이므로 이 한 row에 자연스럽게 붙는다(채널별로 필터를 복제하지 않는다).
- 장점: 채널 추가 = 불리언 컬럼 추가(트리비얼 마이그레이션).
- 비용: 기존 `push_preferences` → `notification_preferences` 리네임 + `enabled` → `web_push_enabled` 데이터 마이그레이션. L2(`push_subscriptions`)와 이를 참조하는 웹푸시 코드(리포·라우트·UI·`getEnabledChannels`)를 함께 손봐야 한다(Step a 범위). MVP 초기라 기존 row가 극소수라 비용이 낮다.

#### 선택지 3-B: 채널별 별도 테이블 (`email_preferences`) (폐기)

`push_preferences`는 그대로 두고 `email_preferences(user_id UNIQUE, enabled)`를 새로 판다.

- 폐기 사유: 채널마다 테이블 + 리포 + RLS 정책 세트가 복제된다. 축 2에서 발송을 일반화하는데 데이터 계층만 채널마다 쪼개지면 "채널 플러그형"이 반만 성립한다.
- 폐기 사유: Sprint 3 필터를 어느 테이블에 둘지 모호해진다(계정 단위 필터인데 채널 테이블이 여러 개).

#### 선택지 3-C: 채널-키 row `notification_preferences(user_id, channel, enabled)` (폐기)

(계정, 채널)마다 1 row, `UNIQUE(user_id, channel)`.

- 폐기 사유: 계정 단위 필터(Sprint 3)를 이 테이블에 두면 채널 수만큼 중복되거나, 필터용 별도 계정 테이블을 또 만들어야 한다. 축 3-A는 계정 1 row라 이 문제가 없다.

## 결정

- **축 1**: 역량 기반 opt-in. 이메일 채널은 `auth.users.email` 보유 계정에만 노출하고, 켜진 채널 전부로 발송한다(dedup 없음). provider→채널 하드코딩을 두지 않는다.
- **축 2**: `notificationService`를 채널 어댑터를 순회하는 채널 플러그형으로 일반화한다. 웹 푸시가 첫 어댑터, 이메일(Resend)이 둘째.
- **축 3**: L1 `push_preferences`를 계정 단위 `notification_preferences`로 일반화하고 `enabled`를 채널별 플래그(`web_push_enabled`, `email_enabled`)로 대체한다. 이메일은 별도 배달-채널 테이블 없이 발송 시점에 `auth.users.email`을 admin 클라로 조회한다(주소 미저장).
- **provider 범위**: 이번(#65)은 구글 이메일만. 네이버는 Supabase 비내장이라 커스텀 OAuth 로그인이 선행돼야 하므로 후속 Step으로 분리한다.
- **provider(발송)**: Resend (무료 3,000/월·100/일, React Email 템플릿, 단순 API). SendGrid 대비 DX 우위로 MVP에 채택.

## 근거

- 채널 역량이 계정마다 다르다는 제약(주소 유무)을 **데이터에서 파생**시키면(1-A) provider 분기가 사라져 채널이 늘어도 규칙이 불변이다 — 알림톡까지 같은 규칙으로 확장된다.
- 발송 일반화(2-A)와 opt-in 컬럼화(3-A)는 "채널 추가 = 어댑터 1 + 불리언 컬럼 1"로 한계비용을 고정한다. 이번 작업이 곧 알림톡의 골격이 된다.
- 이메일은 배달 채널이 계정 속성(주소)이라 L2가 불필요 — 웹 푸시의 (계정×기기) 채널과 구조가 다르다. 주소를 `auth.users`에서 실시간 조회하면 주소 변경 동기화·중복 저장 문제가 원천 소거된다.
- Sprint 3 필터가 계정 단위라 계정 1 row 모델(3-A)이 필터의 자연스러운 집이 된다 — 채널별 테이블/row(3-B/3-C)는 이 지점에서 깨진다.

## 결과

- **마이그레이션(신규, 00003)**: `push_preferences` → `notification_preferences` 리네임, `enabled` → `web_push_enabled`(기존 값 보존), `email_enabled BOOLEAN NOT NULL DEFAULT false` 추가. RLS 정책·`updated_at` 트리거는 새 테이블명으로 재적용. `push_subscriptions`(L2)는 무변경.
  - GRANT 명시 유지(Supabase 자동 GRANT 폐기, ADR 008 결과 §2). 새 테이블에도 `anon, authenticated, service_role` GRANT 필요.
- **웹 푸시 코드 조정(Step a)**: `pushPreferencesRepository`·`/api/push/subscribe`·`/subscribe` UI·`getEnabledChannels`가 `notification_preferences.web_push_enabled`를 바라보도록 수정. 동작은 동일, 컬럼명만 이동.
- **이메일 발송(Step b)**: `emailClient`(Resend 어댑터, 실패를 결과 값으로 정규화), `buildEmailPayload`(1건=제목+`view.do` 링크, N건=집계 — `buildNotificationPayload` 골격 재사용), 이메일 대상 조회(`email_enabled=true` 계정 ∩ `auth.users.email` 존재), `notificationService` 채널 순회 일반화, `/api/cron/crawl` 응답에 이메일 집계 추가. 발송 실패는 웹푸시와 동일하게 200 유지 + 응답 필드로만 표면화(ADR 008: 500이면 재시도→중복 발송).
- **env 신규**: `RESEND_API_KEY`, 발신 주소(`EMAIL_FROM`). 로컬·Vercel·CI(e2e) 주입 필요.
- **게이팅**: `/subscribe`에서 세션 사용자의 이메일 유무로 이메일 토글 노출을 가른다(이메일 없는 카카오 계정엔 미노출).
- **테스트/E2E(Step c)**: 이메일 대상 조회 실 DB e2e + Resend 어댑터 단위 + GHA e2e 편입. 실 이메일 배달은 자동화 경계 밖(수동 스모크, ADR 010 연장).
- **ADR 008 영향**: L1의 이름·의미가 "웹 푸시 구독 의사"에서 "계정의 채널별 알림 의사"로 넓어진다. ADR 008의 L1/L2 서술은 유효하되, L1 테이블명·`enabled` 컬럼은 이 ADR로 대체됨(`notification_preferences.web_push_enabled`).
- **네이버(후속)**: 커스텀 OAuth 로그인 도입 Step에서 `email_enabled` 노출 조건에 자동 편입된다(주소가 있으면 역량 성립) — 발송 파이프라인은 무변경.
- **알림톡(Phase 4)**: `alimtalk_enabled` 컬럼 + 알림톡 어댑터 + 대상 조회 추가. 발송 서비스·cron·집계 골격은 재사용.
