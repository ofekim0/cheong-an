# 리포지터리 패턴 — 매핑, UPSERT, 단일 행 갱신

도메인 타입(camelCase)과 DB row(snake_case)를 분리하고, "한 회 작업이 끝났을 때 일어나는 쓰기"를 캡슐화하는 레이어. 서비스가 직접 빌더 체인을 부르면 매핑 로직이 비즈니스 흐름에 섞이고, 다른 호출자(백필 스크립트 등)가 같은 매핑을 다시 짜야 한다.

## 1. 왜 리포지터리로 분리하나

- **관심사 분리**: 서비스는 "도메인 타입을 모아 넘긴다"는 단일 의도, 리포지터리는 매핑/쿼리/에러 매핑 담당
- **테스트 경계 명확화**: 서비스 한 함수에 fetch + parse + DB mock이 다 들어가지 않음 — 두 층을 독립적으로 검증
- **재사용성**: 다른 호출자(백필, 마이그레이션 스크립트)가 같은 매핑을 그대로 가져다 씀

## 2. 핵심 설계 결정

### 2-1. DB 클라이언트를 인자로 받는다 (DI)

```ts
export async function upsertItems(
  client: SupabaseClient,
  items: DomainItem[],
): Promise<void> { ... }
```

클라이언트 팩토리를 안에서 직접 부르지 않는 이유:

- **테스트 격리**: 단위 테스트가 `vi.fn()` mock 객체를 그대로 주입. 모듈 mocking (`vi.mock`)이 필요 없어 의존이 명시적
- **호출자 결정권**: 어떤 호출자가 어떤 인스턴스를 공유할지 결정을 호출자 쪽에 둠
- **클라이언트 종류 호환**: 추후 같은 시그니처에 다른 권한 레벨의 클라이언트를 넣어 read-only 호출을 만들 여지

### 2-2. 매핑은 순수 함수로 분리

`upsertItems` 내부에서 인라인 객체 리터럴을 만들지 않고, `domainToRow(item): InsertRow`를 별도 export.

- **테스트 단위 분리**: 매핑 정확성(N개 필드 1:1)을 mock 없이 검증
- **재사용**: 다른 입력 경로(파일 dump, 백필 스크립트)에서 같은 매핑 호출 가능

### 2-3. UPSERT with `onConflict` — 멱등성 확보

```ts
client.from(TABLE).upsert(rows, { onConflict: 'unique_key' });
```

스키마에 UNIQUE 제약을 걸어둔 컬럼을 conflict target으로 지정하면 `INSERT ... ON CONFLICT DO UPDATE`가 발동한다. 의미:

- **재실행 안전**: 같은 회차가 재실행돼도 중복 row 안 생기고 최신 값으로 덮어씀
- **다중 인스턴스 동시 write 안전**: 두 인스턴스가 같은 키를 동시에 처리해도 한쪽이 INSERT, 다른 쪽이 UPDATE
- **소스 갱신 흡수**: 외부 소스가 값을 정정하면 다음 회차에 자동 반영

대안 검토:

- **INSERT만**: 멱등성 없음, 재실행 시 UNIQUE 위반으로 throw → 회복 로직이 호출자에 침투
- **기본 onConflict (PK 기준)**: PK가 자동 증가 id면 자연 키 중복 시 UNIQUE 위반 폴백 → 의도를 명시하지 못함

### 2-4. 빈 배열 short-circuit

```ts
if (items.length === 0) return;
```

대부분의 호출에서 신규가 0건일 가능성이 높다면 한 줄로 차단. 불필요한 네트워크 round-trip + 로그 노이즈 방지.

### 2-5. 단일 행 테이블 갱신 — 트리비얼 필터

Supabase JS의 `.update(...)`는 안전장치로 **필터를 강제 요구**한다 (실수로 전체 행 갱신 방지). 단일 행만 존재한다고 가정하는 테이블도 어떤 필터가 필요하다 → 모든 row를 매칭하는 트리비얼 필터(`.gte('id', 0)` 등)를 명시.

대안:

- **`eq('id', 1)` 하드코딩**: id 값은 마이그레이션 구현 디테일. 마이그레이션이 바뀌면 깨짐
- **`upsert` 사용**: 단일 행 가정을 깨면 새 row가 생길 위험

### 2-6. 단일 행 read — `order().limit(1).single()` 명시

```ts
.select('col').order('id', { ascending: true }).limit(1).single()
```

단일 행 가정이 깨졌을 때(예: 누군가 수동으로 row 추가) 예측 가능하게 동작하도록 정렬을 박아둔다. `.single()`은 정확히 1행이 아니면 throw → 가정 위반을 즉시 표면화.

### 2-7. 에러는 throw로 위임 + 컨텍스트 보강

Supabase JS는 result 패턴(`{ data, error }`). 리포지터리는 error를 `throw new Error(...)`로 표면화:

- **호출자가 결정**: Route Handler가 5xx 매핑, 크론이 알람/재시도. 리포지터리는 분류하지 않음
- **컨텍스트 보강**: `Failed to upsert N item(s): ${error.message}` 처럼 batch 크기/대상 키를 메시지에 포함 → 로그만 봐도 어느 호출이 깨졌는지 파악

## 3. 한계

- **트랜잭션 없음**: 두 리포지터리 호출이 별개. 첫 호출 성공 + 두 번째 실패 시 부분 상태가 남음. UPSERT가 멱등이라 다음 회차에 보정되지만, 진짜 atomicity가 필요하면 Postgres function으로 묶거나 outbox 패턴 필요
- **batch 크기 무관**: Supabase JS의 upsert는 한 번에 전부 보냄. 한 batch가 request size limit에 걸리면 batching 추가 필요
