# ADR 008: 웹 푸시 구독 저장 모델 — user 연결 구독, endpoint 기기 식별, expiration_time 생략

- **상태**: 승인됨
- **작성일**: 2026-06-25
- **관련 이슈**: #39 (Step 9-b)
- **관련 ADR**: 009 (소셜 로그인 도입) — 이 결정의 전제

## 맥락

웹 푸시 파이프라인(#39)의 9-b에서 브라우저가 생성한 `PushSubscription`을 저장할 `push_subscriptions` 스키마와 저장 정책을 정해야 한다.

브라우저의 `PushSubscription.toJSON()`은 다음 형태다:

```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/...",
  "expirationTime": null,
  "keys": { "p256dh": "...", "auth": "..." }
}
```

발송 측(9-c, `web-push`)은 이 세 값(endpoint, keys.p256dh, keys.auth)만으로 푸시를 보낸다.

> **전제 변경(2026-06-25)**: 이 ADR의 최초안은 "MVP에 로그인 없음"을 전제로 **익명 구독**을 택했으나, ADR 009로 **소셜 로그인을 Sprint 2에 도입**하기로 결정하면서 그 전제가 깨졌다. 이제 구독은 항상 로그인한 사용자에 묶인다. 구독별 조건(지역구·공고 유형 필터)은 Sprint 3에서 `user_id` 기준으로 붙는다.

결정해야 할 점: (1) 같은 사용자의 여러 기기를 어떻게 표현하나, (2) 중복/재구독을 무엇으로 식별하나, (3) `expirationTime`을 저장하나.

## 고려한 선택지

### 선택지 1: user_id FK(NOT NULL) + endpoint UNIQUE + expiration_time 생략

구독을 `user_id`(→ `auth.users`)로 소유시키되, `endpoint`에 UNIQUE 제약을 걸어 기기를 식별하고 재구독을 UPSERT로 멱등 처리한다. `expirationTime`은 컬럼으로 두지 않는다.

- 장점: ADR 009의 로그인 모델을 그대로 반영. 발송 시 `WHERE user_id = ?`로 그 사용자의 모든 기기 구독을 조회한다.
- 장점: endpoint는 푸시 서비스가 구독마다 발급하는 고유 URL → 자연스러운 기기 중복 키. 한 사용자가 폰·노트북 등 **여러 기기**를 구독하면 같은 `user_id`의 여러 row가 되고, 같은 기기가 재구독하면 같은(또는 갱신된) endpoint로 UPSERT되어 row 폭증이 없다.
- 장점: RLS로 `user_id = auth.uid()` 본인 row만 접근하도록 DB가 소유권을 강제할 수 있다.
- 장점: `expirationTime`은 실제로 대부분 `null`이며, 만료/거부 정리는 발송 시점의 `410 Gone` 응답으로 처리(9-c)하는 게 더 정확하다(저장된 만료 시각을 신뢰하는 것보다). — 로그인과 무관하게 유효한 판단이라 최초안에서 그대로 살린다.

### 선택지 2: 익명 독립 row (최초안) — 폐기

구독을 사용자에 묶지 않고 endpoint UNIQUE만으로 독립 row 저장.

- 폐기 사유: ADR 009로 로그인이 확정됐다. 익명으로 만들면 나중에 `user_id` 추가 마이그레이션 + 로그인 전 생긴 **고아 익명 구독**을 사용자에 연결하는 처리가 필요하다 — 처음부터 user 연결로 만들면 이 비용이 전부 0이다.

### 선택지 3: 사용자당 단일 구독 (endpoint UNIQUE 없이 user_id UNIQUE)

`user_id`를 UNIQUE로 두어 사용자당 row 1개만 유지.

- 단점: 한 사용자가 여러 기기에서 알림을 받지 못한다(마지막 구독 기기로 덮어써짐). 멀티기기는 웹 푸시의 자연스러운 사용 패턴이라 잃을 이유가 없다.

## 결정

선택지 1 — 구독을 `user_id`(NOT NULL, → `auth.users`)로 소유시키고, `endpoint`를 UNIQUE 키로 삼아 UPSERT로 멱등 처리한다. RLS로 본인 row만 접근하게 한다. `expiration_time`은 저장하지 않고 만료 정리는 발송 시 `410 Gone`(9-c)으로 한다.

## 근거

- ADR 009로 로그인이 확정됐으므로 처음부터 user 연결 모델로 만들어 재작업(익명 구현 + 마이그레이션 + 고아 구독 연결)을 0으로 만든다.
- endpoint는 푸시 서비스가 보장하는 자연 고유 키라 기기 식별·재구독 멱등에 별도 식별자나 중복 정리 로직이 필요 없다. user_id와 함께 두면 "사용자 → 기기들" 관계가 그대로 표현된다.
- 만료는 저장된 시각이 아니라 발송 결과(`410 Gone`)가 진실의 원천이다 — `expiration_time` 컬럼은 신뢰도 낮은 중복 정보.

## 결과

- 마이그레이션 `supabase/migrations/00002_create_push_subscriptions.sql`:
  - `push_subscriptions(id, user_id NOT NULL → auth.users(id), endpoint UNIQUE, p256dh, auth, user_agent, created_at, updated_at)`.
  - 기존 `update_updated_at()` 트리거 함수 재사용.
  - **RLS 활성화**: 본인 row만 `select`/`insert`/`delete` (`user_id = auth.uid()`). (announcements는 admin 전용 쓰기라 RLS 미적용이었으나, 사용자 소유 데이터인 구독은 RLS로 보호한다.)
- 리포지터리 `pushSubscriptionsRepository`: 순수 매퍼 + `endpoint` 충돌 키 UPSERT(기존 announcements 패턴 답습), `user_id` 포함.
- 라우트 `POST /api/push/subscribe`: 세션에서 `user_id`를 도출(ADR 009의 `getClaims()`), `PushSubscription.toJSON()` 형태 수신, 비로그인 401, 필수 필드 검증(400) 후 UPSERT(성공 201, DB 예외 500). 쓰기는 admin 클라가 아니라 **세션 바인딩된 server 클라**로 수행해 RLS가 소유권을 강제하게 한다(최종 형태는 9-b 구현에서 확정).
- 발송(9-c): `WHERE user_id = ?`로 해당 사용자의 구독을 조회해 endpoint마다 발송. `410 Gone` 정리는 endpoint로 row를 삭제한다(`deletePushSubscriptionByEndpoint`).
- **Sprint 3 영향**: 지역구/유형 필터는 `user_id` 기준 구독 row에 필터 조건 컬럼(또는 별도 구독-조건 테이블)을 붙이는 방향으로 확장한다. 처음부터 user 기준이라 재작업이 없다.
