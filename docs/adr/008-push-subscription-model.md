# ADR 008: 웹 푸시 구독 저장 모델 — 구독 의사(계정)/배달 채널(계정×기기) 분리

- **상태**: 승인됨
- **작성일**: 2026-06-25 (개정 2026-07-03: endpoint 단독 UNIQUE 모델 폐기 → L1/L2 분리)
- **관련 이슈**: #39 (Step 9-b)
- **관련 ADR**: 009 (소셜 로그인 도입) — 이 결정의 전제

## 맥락

웹 푸시 파이프라인(#39)의 9-b에서 브라우저가 생성한 `PushSubscription`을 저장할 스키마와 저장 정책을 정해야 한다.

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

### 요구사항 (2026-07-03 확정)

구독 상태는 **계정의 속성**이다:

- **상황 1 (계정별 독립)**: 같은 기기 X에서 계정 A의 구독/해제와 계정 B의 구독/해제는 서로 영향을 주지 않는다.
- **상황 2 (기기 간 공유)**: 같은 계정 A라면 기기 X에서의 구독/해제 상태가 기기 Y에도 공유된다 — X에서 끄면 Y도 발송이 중단된다.

### 못 바꾸는 물리 제약 (웹 푸시 표준)

1. **알림 권한 + 구독(endpoint)은 브라우저마다 개별이다.** 계정으로 공유하거나 자동 이전할 수 없다. A가 폰에서 구독했어도 새 노트북에서는 다시 권한 허용 + 구독을 해야 알림을 받는다.
2. **한 브라우저 = 물리 채널(endpoint) 하나.** 그 채널로 도착한 알림은 누가 로그인해 있든 그 브라우저 화면에 뜬다. 서비스워커는 로그인 상태로 수신자를 거르지 못한다.

→ DB 상태는 계정별로 완벽히 독립시킬 수 있지만, **공유 브라우저에서 화면의 물리적 격리는 불가능하다**. 공고 알림은 민감도가 낮아 MVP에서 수용한다.

## 고려한 선택지

### 선택지 1: 구독 의사(L1)/배달 채널(L2) 분리 + `UNIQUE(user_id, endpoint)` — 채택

한 row에 뭉쳐 있던 "구독 의사"와 "배달 채널"을 두 테이블로 나눈다:

| 레이어       | 테이블               | 무엇                                                                    | 단위                                       | 담당 요구     |
| ------------ | -------------------- | ----------------------------------------------------------------------- | ------------------------------------------ | ------------- |
| L1 구독 의사 | `push_preferences`   | "이 계정이 알림을 원한다" (`enabled` 플래그, Sprint 3 필터가 붙을 자리) | 계정 (`user_id` UNIQUE)                    | 상황 2 (공유) |
| L2 배달 채널 | `push_subscriptions` | endpoint + keys                                                         | (계정, 기기) — `UNIQUE(user_id, endpoint)` | 상황 1 (독립) |

- 장점: L1이 계정 단위라 A와 B의 의사가 애초에 별개 row — 상황 1 성립. 어느 기기에서 끄든 계정 차원에서 꺼져 상황 2(해제 공유)도 성립.
- 장점: L2 키에 `user_id`가 들어가 같은 기기의 {A, endpoint}·{B, endpoint}가 공존 — 계정 간 endpoint 소유권 충돌이 구조적으로 사라진다.
- 장점: 발송(9-c)은 "L1 enabled인 계정의 모든 L2 채널로 발송(`WHERE user_id = ?`)" — 단순한 조인.

### 선택지 2: 익명 독립 row (최초안) — 폐기

구독을 사용자에 묶지 않고 endpoint UNIQUE만으로 독립 row 저장.

- 폐기 사유: ADR 009로 로그인이 확정됐다. 익명으로 만들면 나중에 `user_id` 추가 마이그레이션 + 고아 익명 구독 연결 처리가 필요하다 — 처음부터 user 연결로 만들면 이 비용이 전부 0이다.

### 선택지 3: 사용자당 단일 구독 (`user_id` UNIQUE) — 폐기

- 폐기 사유: 한 사용자가 여러 기기에서 알림을 받지 못한다(마지막 구독 기기로 덮어써짐). 멀티기기는 웹 푸시의 자연스러운 사용 패턴이다.

### 선택지 4: 단일 테이블 + `endpoint` 단독 UNIQUE (2026-06-25 개정안) — 폐기

구독 의사와 배달 채널을 한 row에 두고, endpoint를 단독 UNIQUE 키로 UPSERT. 같은 기기에서 다른 계정이 재구독하면 RLS 충돌을 409로 표면화(소유권은 선점 계정에 고정).

- 폐기 사유(상황 1 위반): endpoint가 계정 간 배타 자원이 되어, 기기 X에서 B는 A가 점유한 채널 때문에 구독 자체가 막힌다(409). "계정별 독립"과 정반대.
- 폐기 사유(상황 2 위반): "구독 = row 존재"라서 기기 X에서 해제해도 기기 Y의 row는 남는다 — 계정 단위 OFF(해제 공유)를 표현할 수 없다.

## 결정

선택지 1 — 구독 의사(L1 `push_preferences`, 계정당 1 row + `enabled`)와 배달 채널(L2 `push_subscriptions`, `UNIQUE(user_id, endpoint)`)을 분리한다. 두 테이블 모두 `user_id`(NOT NULL, → `auth.users`) 소유 + RLS로 본인 row만 접근. `expiration_time`은 저장하지 않고 만료 정리는 발송 시 `410 Gone`(9-c)으로 한다.

## 근거

- 요구사항 두 축(계정별 독립, 기기 간 공유)이 서로 다른 단위(계정×기기, 계정)를 가리키므로 한 테이블로는 표현이 안 된다 — 분리가 최소 모델이다.
- L2 키에 user_id를 포함하면 계정 간 충돌(409)이 구조적으로 소멸 — 에러 처리 분기 자체가 사라진다.
- `expirationTime`은 실제로 대부분 `null`이며, 만료/거부 정리는 발송 시점의 `410 Gone` 응답으로 처리(9-c)하는 게 더 정확하다(저장된 만료 시각을 신뢰하는 것보다).
- Sprint 3의 지역구/유형 필터는 "계정의 알림 조건"이므로 L1에 자연스럽게 붙는다 — 재작업 없음.

## 결과

- 마이그레이션 `supabase/migrations/00002_create_push_subscriptions.sql`:
  - `push_preferences(id, user_id UNIQUE NOT NULL → auth.users(id), enabled, created_at, updated_at)`.
  - `push_subscriptions(id, user_id NOT NULL → auth.users(id), endpoint, p256dh, auth, user_agent, created_at, updated_at, UNIQUE(user_id, endpoint))`.
  - 기존 `update_updated_at()` 트리거 함수 재사용.
  - **RLS 활성화 (두 테이블)**: 본인 row만 `select`/`insert`/`update`/`delete` (`user_id = auth.uid()`). `update` 정책은 UPSERT가 충돌 시 내부적으로 UPDATE를 실행하므로 필수(없으면 재구독 키 갱신·enabled 토글이 실패). (announcements는 admin 전용 쓰기라 RLS 미적용이었으나, 사용자 소유 데이터인 구독은 RLS로 보호한다.)
- 리포지터리: `pushSubscriptionsRepository`(순수 매퍼 + `user_id,endpoint` 충돌 키 UPSERT), `pushPreferencesRepository`(`setPushPreference` user_id 충돌 UPSERT, `getPushPreference` row 없으면 false).
- 라우트 `/api/push/subscribe`: 쓰기는 admin 클라가 아니라 **세션 바인딩된 server 클라**로 수행해 RLS가 소유권을 강제하게 한다.
  - `POST` = 구독 켜기: 세션에서 `user_id` 도출(ADR 009의 `getClaims()`), `PushSubscription.toJSON()` 수신, 비로그인 401, 필드 검증 400, L2 UPSERT + L1 `enabled=true` 후 201, DB 예외 500.
  - `DELETE` = 구독 끄기: L1 `enabled=false`만. L2 row·브라우저 채널은 보존 — 같은 기기의 다른 계정 채널을 보호하고, 죽은 채널 정리는 9-c의 `410 Gone`이 담당.
- UI(`/subscribe`): 서버 컴포넌트가 L1 상태를 조회해 토글로 노출. 계정 구독이 켜져 있어도 이 브라우저에 채널이 없으면 "이 기기에서도 알림 받기"를 따로 노출한다(물리 제약 1 — 권한·채널은 브라우저별 개별).
  - **마운트 재동기화**: 계정 구독 ON + 브라우저 채널 존재 시 멱등 POST 1회 — 브라우저 채널 존재만으로는 현재 계정의 L2 row가 보장되지 않으므로(공유 브라우저에서 타 계정이 만든 채널일 수 있음) 항상 동기화한다. 키 회전 치유 겸용. 수용한 트레이드오프: 공유 브라우저에서 페이지 방문만으로 그 기기가 현재 계정의 채널로 등록되고(암묵적 opt-in), 다계정 공존 시 같은 화면에 중복 알림이 뜰 수 있다 — 공고 알림의 낮은 민감도로 MVP에서 수용.
- 발송(9-c): L1 `enabled = true`인 계정의 L2 채널을 `WHERE user_id`로 조회해 endpoint마다 발송. `410 Gone` 정리는 endpoint로 해당 채널 row를 삭제한다.
- **Sprint 3 영향**: 지역구/유형 필터는 L1 `push_preferences`에 조건 컬럼(또는 별도 조건 테이블)으로 확장한다. 처음부터 계정 기준이라 재작업이 없다.
