# Step 7-b. 리포지터리 패턴 — 매핑, UPSERT, 단일 행 갱신

> 선행: [step7-supabase-client.md](./step7-supabase-client.md)

`announcementsRepository`와 `crawlStateRepository`는 도메인 타입(camelCase, `AnnouncementDetail`)과 Supabase row(snake_case)를 분리하고, "한 회차 크롤링이 끝났을 때 일어나는 두 가지 쓰기" — 신규 공고 UPSERT + 진척 상태 update — 를 각각 캡슐화한다.

## 1. 왜 리포지터리로 분리하나

`announcementService`가 직접 `client.from('announcements').upsert(...)`을 부르면:

- 매핑 로직(camelCase ↔ snake_case)이 비즈니스 흐름에 섞임
- 테스트 시 서비스 한 함수에 fetch + parse + UPSERT mock이 다 들어가서 단위 경계가 흐려짐
- 다른 호출자(예: 백필 스크립트)가 같은 매핑을 다시 짜야 함

리포지터리로 빼면 `announcementService`는 "신규 detail을 모아 리포지터리에 넘긴다"는 단일 의도만 갖고, 매핑/UPSERT/에러 매핑은 리포지터리 안에 닫힌다. 단위 테스트도 두 층이 독립적으로 검증 가능.

## 2. 구조

```
upsertAnnouncements(client, details)
  ├─ if empty → return (short-circuit)
  ├─ details.map(detailToRow)              ← camelCase → snake_case
  └─ client.from('announcements')
       .upsert(rows, { onConflict: 'board_id' })

getLastBoardId(client)
  └─ client.from('crawl_state')
       .select('last_board_id')
       .order('id', asc).limit(1).single() → number

updateLastBoardId(client, lastBoardId)
  └─ client.from('crawl_state')
       .update({ last_board_id, last_crawled_at: now })
       .gte('id', 0)                       ← single-row trivial filter
```

## 3. 핵심 설계 결정

### 3-1. `SupabaseClient`를 인자로 받는다 (DI)

```ts
export async function upsertAnnouncements(
  client: SupabaseClient,
  details: AnnouncementDetail[],
): Promise<void> { ... }
```

`getSupabaseAdminClient()`를 안에서 직접 부르지 않는 이유:

- **테스트 격리**: 단위 테스트가 `vi.fn()` mock 객체를 그대로 주입할 수 있음 (Step 7-c). 모듈 mocking (`vi.mock`)이 필요 없어 의존이 명시적.
- **호출자 결정권**: Route Handler / 크론 / 백필 스크립트가 같은 admin 인스턴스를 공유하거나 다른 인스턴스를 쓰는 선택을 호출자 쪽에 둠.
- **Anon 클라이언트 호환**: 추후 같은 시그니처에 anon 클라이언트를 넣어 read-only 호출을 만들 여지 (RLS가 막아주므로 안전).

### 3-2. 매핑은 순수 함수로 분리 (`detailToRow`)

`upsertAnnouncements` 내부에서 인라인으로 객체 리터럴을 만들지 않고, `detailToRow(detail): AnnouncementInsertRow`를 별도 export.

- **테스트 단위 분리**: 매핑 정확성(15개 필드 1:1)을 mock 없이 검증. 통합 흐름 mock에는 매핑 디테일이 끼지 않음.
- **재사용**: 백필 스크립트가 다른 입력 경로(예: 파일 dump)에서 들어와도 같은 매핑을 호출할 수 있음.

### 3-3. UPSERT with `onConflict: 'board_id'` — 멱등성 확보

```ts
client.from(TABLE).upsert(rows, { onConflict: 'board_id' });
```

마이그레이션에서 `board_id`에 UNIQUE 제약을 걸어둔 덕에 PostgreSQL의 `INSERT ... ON CONFLICT (board_id) DO UPDATE`가 발동한다. 의미:

- **동일 boardId 재크롤링이 안전**: 같은 회차가 재실행돼도 중복 row가 안 생기고 최신 detail로 덮어씀.
- **다중 인스턴스 동시 write 안전**: 두 인스턴스가 같은 boardId를 동시에 처리해도 한쪽이 INSERT, 다른 쪽은 UPDATE가 된다 (제약 위반으로 둘 다 실패하지 않음).
- **detail 갱신 흡수**: 운영자가 사이트에서 제목/주소를 정정하면 다음 회차에 자동 반영. (반대로 "최초 발행 시점 detail 보존" 같은 정책이 필요해지면 이 자리에서 분기해야 함 — 현재는 보존 정책 없음.)

대안 검토:

- **INSERT만**: 멱등성 없음, 재실행 시 UNIQUE 위반으로 throw → 회복 로직이 호출자에 침투.
- **upsert default `onConflict` (PK 기준)**: 우리 PK는 자동 증가 `id` → boardId 중복 시 UNIQUE 위반으로 폴백. 명시적으로 `board_id`를 지정해야 의도가 정확.

### 3-4. 빈 배열 short-circuit

```ts
if (details.length === 0) return;
```

대부분 회차는 신규가 0건 (모집 공고가 자주 안 올라옴). 빈 배열을 upsert에 넘기면 Supabase JS가 빈 요청을 보내는데, 결과적으로 no-op이지만:

- 불필요한 네트워크 round-trip
- 로그 노이즈 (`upsert 0 rows`)

가 발생한다. 한 줄로 차단.

### 3-5. 단일 행 테이블 갱신 — `gte('id', 0)` 트리비얼 필터

`crawl_state`는 마이그레이션의 `INSERT INTO crawl_state (last_board_id) VALUES (0)`으로 단일 행만 존재한다 (애플리케이션에서 새 row를 만드는 코드 경로 없음). 그런데 Supabase JS의 `.update(...)`는 **반드시 필터**를 요구한다 — 안전장치로 "전체 테이블 update"를 막아 둠.

해결: 모든 row를 매칭하는 트리비얼 필터를 명시.

```ts
.update({ last_board_id, last_crawled_at: now }).gte('id', 0)
```

`id`는 자동 증가 PK라 항상 ≥ 1 → `gte('id', 0)`이 무조건 매칭. 단일 행 가정이 그대로 유지되면 정확히 한 행만 갱신된다.

대안 검토:

- **`upsert` 사용**: `id`를 명시해야 하고, "단일 행 가정"을 깨면 새 row가 생길 위험. update가 의도에 더 정확.
- **`eq('id', 1)` 하드코딩**: id 값이 1임은 마이그레이션 구현 디테일. 마이그레이션이 바뀌면 깨짐. trivial filter가 더 견고.

### 3-6. read는 `order().limit(1).single()` 명시

```ts
.select('last_board_id').order('id', { ascending: true }).limit(1).single()
```

단일 행 가정이 깨졌을 때(예: 누군가 수동으로 row를 추가) 예측 가능하게 동작하도록 정렬을 박아둔다. `.single()`은 정확히 1행이 아니면 throw → 가정 위반을 즉시 표면화.

### 3-7. 에러는 throw로 위임

Supabase JS는 result 패턴(`{ data, error }`)을 쓴다. 두 리포지터리 모두 error를 `throw new Error(...)`로 표면화한다:

- **호출자가 결정**: Route Handler가 5xx 매핑, 크론이 알람/재시도. 리포지터리는 분류하지 않음.
- **컨텍스트 보강**: `Failed to upsert 7 announcement(s): ${error.message}` 처럼 batch 크기/대상 키를 메시지에 포함 → 로그만 봐도 어느 호출이 깨졌는지 파악.

## 4. 매핑 정책의 짝꿍 — ADR 003 옵션 B

`detailToRow`는 `AnnouncementDetail`의 모든 필드가 채워져 있다고 가정한다. 이걸 가능케 하는 게 ADR 003 옵션 B (저장 전 view.do 보강 — 모든 신규는 detail까지 확보한 다음 한 batch로 UPSERT). JSON-only 신규를 따로 partial-row로 넣는 흐름이 없기 때문에:

- `complex_name`, `district` 등 nullable 컬럼은 "detail은 있지만 실제 값이 없는 경우"에만 null
- 두 단계 INSERT (먼저 partial, 나중에 보강) 같은 분기가 필요 없음

이 가정이 깨지면 (예: ADR이 옵션 A "JSON만으로 즉시 저장"으로 바뀌면) `detailToRow`를 partial-aware로 재설계하거나 별도 매핑 함수를 둬야 한다.

## 5. 한계와 다음 단계

- **트랜잭션 없음**: announcements UPSERT와 crawl_state update는 별개 호출. 첫 호출이 성공하고 두 번째가 실패하면 boardId는 저장됐는데 `last_board_id`는 그대로 → 다음 회차가 같은 신규를 다시 처리 (UPSERT라 멱등이긴 함). 진짜 atomicity가 필요하면 Postgres function으로 묶거나 outbox 패턴 필요. 현재 규모(시간당 1회, 신규 0~5건)에서는 과한 비용.
- **batch 크기 무관**: Supabase JS의 upsert는 한 번에 전부 보냄. 만약 신규가 수백 건 쏟아지면 (사이트 정책 변경 등) request size limit에 걸릴 가능성 → 그 때 batching 추가. 현재는 정상 운영에서 한 회차 5건 미만이라 불필요.
- **`crawl_state` 갱신 호출 미연결**: 현재 `announcementService`는 `upsertAnnouncements`만 호출하고 `updateLastBoardId`는 부르지 않는다. #13 스케줄러 작업에서 Route Handler가 service 호출 후 `latestBoardId`를 받아 `updateLastBoardId`를 호출하는 흐름으로 연결될 예정.

## 6. 테스트 포인트 (실제 작성: Step 7-c)

| 시나리오                         | 기대                                                                  |
| -------------------------------- | --------------------------------------------------------------------- |
| `detailToRow` 전체 필드 매핑     | 15개 필드가 1:1 매핑, snake_case 변환                                 |
| `detailToRow` nullable 필드 null | nullable 컬럼은 null로 전달                                           |
| `upsertAnnouncements([])`        | Supabase 호출 없이 즉시 반환                                          |
| `upsertAnnouncements` 정상       | `from('announcements').upsert(rows, { onConflict: 'board_id' })` 검증 |
| `upsertAnnouncements` 에러       | batch 크기를 포함한 메시지로 throw                                    |
| `getLastBoardId` 정상            | data 반환                                                             |
| `getLastBoardId` 에러            | throw                                                                 |
| `updateLastBoardId` 시각 검증    | `last_crawled_at`이 호출 전후 사이의 ISO 문자열                       |
| `updateLastBoardId` 필터         | `.gte('id', 0)` 호출 확인                                             |
| `updateLastBoardId` 에러         | boardId 포함한 메시지로 throw                                         |
