# Step 7-c. Supabase 체이닝 메서드 모킹 (Vitest)

> 선행: [step7-repository-pattern.md](./step7-repository-pattern.md)

리포지터리 단위 테스트가 Supabase JS의 빌더 체인(`from().select().order().limit().single()`, `from().upsert(...)`, `from().update(...).gte(...)`)을 mock으로 끊는 패턴.

## 1. 왜 모킹하나 — 외부 의존 격리

리포지터리는 "주입받은 클라이언트를 빌더 체인으로 정확히 호출하는가"가 단위로서의 관심사다. 진짜 Supabase에 붙으면:

- 네트워크/계정/마이그레이션 상태가 테스트에 끼어듦
- 빠른 피드백 루프(`pnpm test`) 깨짐
- `onConflict`나 `gte('id', 0)` 같은 **호출 형태**를 검증하기 까다로움

DB 자체의 거동(트랜잭션, RLS, 인덱스)이 관심사일 때는 통합 테스트(실제 Supabase 또는 supabase-local 컨테이너)가 적합하지만, 그건 현재 단계의 단위 테스트 책임 밖이다. Step 5의 `announcementService` MSW 통합 테스트가 그 자리를 일부 메우고 있고, 본격 DB 통합 테스트는 Phase 2 이후.

## 2. 빌더 체인 모킹의 어려움

Supabase JS는 fluent 빌더로 동작한다. 예:

```ts
client
  .from('crawl_state')
  .select('last_board_id')
  .order('id', { ascending: true })
  .limit(1)
  .single(); // ← 여기서 Promise<{ data, error }> 반환
```

각 메서드는 빌더를 반환하고, 마지막 메서드(`single`, `upsert`, `gte`)가 thenable(Promise)을 반환한다. mock하려면:

- 각 메서드가 다음 메서드를 가진 객체를 반환해야 함
- 마지막 메서드만 Promise를 반환해야 함
- 인자 검증(어떤 키로 select했는지 등)도 해야 함

흔히 떠올리는 `mockReturnThis()` 패턴은 TypeScript 타입 narrowing과 충돌한다 (체인 끝의 반환 타입이 `Promise`로 좁혀져야 하는데 `this`로는 안 됨). 그래서 **메서드별로 별도 mock을 만들고 `mockReturnValue`로 명시 연결**하는 패턴을 채택했다.

## 3. 패턴 — 메서드별 mock + `mockReturnValue` 연결

### 3-1. read (select-order-limit-single 체인)

```ts
function createReadMock(result: {
  data: { last_board_id: number } | null;
  error: { message: string } | null;
}) {
  const single = vi.fn().mockResolvedValue(result);
  const limit = vi.fn().mockReturnValue({ single });
  const order = vi.fn().mockReturnValue({ limit });
  const select = vi.fn().mockReturnValue({ order });
  const from = vi.fn().mockReturnValue({ select });
  const client = { from } as unknown as SupabaseClient;
  return { client, from, select, order, limit, single };
}
```

핵심:

- **역순으로 빌드**: 체인 끝(`single`)부터 만든다. 각 단계는 "다음 단계가 들어있는 객체"를 반환.
- **마지막만 Promise**: `single`은 `mockResolvedValue` (Promise 반환). 나머지는 `mockReturnValue` (동기 객체 반환).
- **개별 mock을 노출**: 테스트가 인자를 검증할 수 있도록 `select`, `order`, `limit`을 반환 객체에 포함.
- **타입 단언**: `client`는 `unknown` 경유로 `SupabaseClient`에 캐스팅 — 실제 SupabaseClient의 거대한 인터페이스를 mock으로 다 만족시킬 수 없음. mock이 단위 테스트 안에서만 통한다는 명시.

### 3-2. write (update-gte 체인)

```ts
function createUpdateMock(result: { error: { message: string } | null }) {
  const gte = vi.fn().mockResolvedValue(result);
  const update = vi.fn().mockReturnValue({ gte });
  const from = vi.fn().mockReturnValue({ update });
  const client = { from } as unknown as SupabaseClient;
  return { client, from, update, gte };
}
```

`update`는 빌더를 반환하고, `gte`가 Promise를 반환한다 (체인의 마지막). upsert도 같은 패턴인데, `from().upsert(...)`가 곧바로 Promise라 한 단계 더 짧다.

### 3-3. 왜 `mockReturnThis`를 피했나

```ts
// ❌ 매력적이지만 타입이 깨진다
const builder = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue(result),
};
```

- `mockReturnThis`의 반환 타입은 mock 객체 전체 → 체인 끝까지 같은 타입. 마지막에 `await`이 들어가면 `await builder` 모양이 되는데, `single`이 분리된 mock이라 호출하지 않으면 어떻게 await할지 모호.
- 인자별로 분기하려면 (예: 호출 횟수에 따라 다른 결과) `mockReturnThis`는 안에서 `this` 컨텍스트 다루기 어려움.
- 명시적 `mockReturnValue({ next })`는 어떤 메서드 다음에 어떤 메서드가 와야 하는지가 코드에 그대로 드러남 → mock 자체가 "체인 순서 문서" 역할.

## 4. 인자 검증 — "호출 형태"의 단위 검증

```ts
expect(from).toHaveBeenCalledWith('crawl_state');
expect(select).toHaveBeenCalledWith('last_board_id');
expect(order).toHaveBeenCalledWith('id', { ascending: true });
expect(limit).toHaveBeenCalledWith(1);
```

리포지터리의 단위 책임은 "**정확한 빌더 호출**을 만드는 것"이다. 데이터가 진짜 반환되는지는 mock이 통제하므로, 실질적 어서션은 호출 인자 쪽에 둔다. 특히:

- `select('last_board_id')`: 의도한 컬럼만 select했는가 (over-fetch 방지)
- `order('id', { ascending: true })`: 단일 행 가정 안정성 확보 ([Step 7-b §3-6](./step7-repository-pattern.md))
- `gte('id', 0)`: single-row trivial filter ([Step 7-b §3-5](./step7-repository-pattern.md))
- `upsert(rows, { onConflict: 'board_id' })`: 멱등성 보장 키 ([Step 7-b §3-3](./step7-repository-pattern.md))

이 인자들이 깨지면 운영에서 조용히 문제가 생긴다 (over-fetch는 비용, 잘못된 onConflict는 중복 row 또는 throw). 단위 테스트가 이걸 잡는 게 가장 큰 가치.

## 5. 시간 검증 패턴 — `last_crawled_at`

`updateLastBoardId`는 호출 시점의 `new Date().toISOString()`을 payload에 넣는다. mock 시각을 고정(`vi.useFakeTimers()`)하는 대신, **실제 시각의 범위**를 검증:

```ts
const before = Date.now();
await updateLastBoardId(client, 5678);
const after = Date.now();

const payload = update.mock.calls[0][0];
const ts = Date.parse(payload.last_crawled_at);
expect(ts).toBeGreaterThanOrEqual(before);
expect(ts).toBeLessThanOrEqual(after);
```

- **fake timer 회피**: rateLimit/retry처럼 시간을 통제할 이유가 없음. 단순히 "호출 중 어디쯤의 시각이 들어있는가"가 충분.
- **flake 방지**: 정확한 시각 비교가 아니라 범위 검증 → 시계 해상도나 await 사이의 마이크로 지연에 견고.
- **포맷 검증 동시에**: `Date.parse`가 NaN이 아니면 ISO 형식이 유효하다는 부수 검증까지 됨.

## 6. 에러 메시지 정규식 검증

```ts
await expect(updateLastBoardId(client, 9999)).rejects.toThrow(
  /Failed to update crawl_state\.last_board_id=9999: permission denied/,
);
```

리포지터리는 컨텍스트를 메시지에 넣는다 ([Step 7-b §3-7](./step7-repository-pattern.md)). 테스트가 정규식으로 그 컨텍스트(boardId, 원본 에러 메시지)를 확인 → 로그에서 디버깅 가능한 정도의 정보가 보존되는지 보장.

문자열 완전 일치(`toThrow('...')`) 대신 정규식을 쓰는 이유: 메시지 prefix/suffix가 미세 조정돼도 테스트가 안 깨지게, 핵심 정보(boardId, 원본 error)만 가두기 위함.

## 7. 한계와 다음 단계

- **빌더 형태가 바뀌면 mock 깨짐**: 예를 들어 `single()` 대신 `maybeSingle()`을 쓰도록 리포지터리를 바꾸면 mock도 그 자리에 단계를 만들어줘야 함. 빌더 자체의 정확성(예: `gte('id', 0)`이 PostgREST 쿼리로 어떻게 변환되는지)은 단위 테스트로 검증 불가 → 통합 테스트 영역.
- **테스트별 mock 객체 중복**: 메서드별 mock 생성 헬퍼(`createReadMock`, `createUpdateMock`)로 반복은 줄였지만, 두 리포지터리가 닮은 mock 구조를 가짐. 추후 추가 리포지터리(예: subscriptions, notifications)가 늘면 공통 mock helper를 `src/lib/supabase/__test__/mockClient.ts`로 빼는 게 자연스러움. 지금은 두 군데뿐이라 inlining이 더 읽기 쉬움.
- **타입 단언의 비용**: `as unknown as SupabaseClient`가 mock이 실제 인터페이스와 어긋나는 변화를 잡지 못함. 통합 테스트(실 Supabase)로 보강 필요 — Phase 2 이후.

## 8. 참고

- Vitest mock API: https://vitest.dev/api/mock.html
- Supabase JS 빌더 체인: https://supabase.com/docs/reference/javascript/select
- `Date.parse` 동작: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/parse
