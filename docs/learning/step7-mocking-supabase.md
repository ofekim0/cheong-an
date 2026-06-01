# Fluent 빌더 체인 모킹 (Vitest)

DB 클라이언트 라이브러리들(Supabase JS, Knex, Prisma의 일부 API 등)이 자주 쓰는 fluent 빌더 체인을 단위 테스트에서 mock으로 끊는 패턴.

## 1. 왜 모킹하나 — 외부 의존 격리

리포지터리 단위 테스트의 관심사는 "주입받은 클라이언트를 빌더 체인으로 정확히 호출하는가". 진짜 DB에 붙으면:

- 네트워크/계정/마이그레이션 상태가 테스트에 끼어듦
- 빠른 피드백 루프 깨짐
- 호출 형태(어떤 인자로 어떤 메서드를 불렀는지) 검증 까다로움

DB 자체의 거동(트랜잭션, 인덱스, 제약)이 관심사일 때는 별도 통합 테스트 영역.

## 2. 빌더 체인 모킹의 어려움

Fluent 빌더는 각 메서드가 빌더를 반환하고, 마지막 메서드가 thenable(Promise)을 반환한다. mock하려면:

- 각 메서드가 **다음 메서드를 가진 객체**를 반환해야 함
- **마지막 메서드만** Promise를 반환해야 함
- 인자 검증(어떤 키로 select했는지 등)도 가능해야 함

흔히 떠올리는 `mockReturnThis()` 패턴은 TypeScript 타입 narrowing과 충돌한다 (체인 끝의 반환 타입이 `Promise`로 좁혀져야 하는데 `this`로는 안 됨).

## 3. 패턴 — 메서드별 mock + `mockReturnValue` 연결

```ts
function createChainMock(result: { data: T | null; error: E | null }) {
  const terminal = vi.fn().mockResolvedValue(result); // Promise 반환
  const limit = vi.fn().mockReturnValue({ single: terminal });
  const order = vi.fn().mockReturnValue({ limit });
  const select = vi.fn().mockReturnValue({ order });
  const from = vi.fn().mockReturnValue({ select });
  const client = { from } as unknown as ClientType;
  return { client, from, select, order, limit, terminal };
}
```

핵심:

- **역순으로 빌드**: 체인 끝부터 만든다. 각 단계는 "다음 단계가 들어있는 객체"를 반환
- **마지막만 Promise**: 종단 메서드만 `mockResolvedValue`, 나머지는 `mockReturnValue`
- **개별 mock 노출**: 테스트가 인자를 검증할 수 있도록 모든 단계를 반환 객체에 포함
- **타입 단언**: `as unknown as ClientType` — 실제 클라이언트의 거대한 인터페이스를 mock으로 다 만족시킬 수 없음. mock이 단위 테스트 안에서만 통한다는 명시

### 왜 `mockReturnThis`를 피했나

- 반환 타입이 mock 객체 전체 → 체인 끝까지 같은 타입. 종단 메서드가 분리되면 어떻게 await할지 모호
- 호출 횟수에 따라 다른 결과를 주려면 `this` 컨텍스트 다루기 어려움
- 명시적 `mockReturnValue({ next })`는 **mock 자체가 "체인 순서 문서" 역할**

## 4. 인자 검증 — "호출 형태"의 단위 검증

```ts
expect(from).toHaveBeenCalledWith('table_name');
expect(select).toHaveBeenCalledWith('col1, col2');
expect(order).toHaveBeenCalledWith('id', { ascending: true });
expect(limit).toHaveBeenCalledWith(1);
```

리포지터리의 단위 책임은 "**정확한 빌더 호출**을 만드는 것". 데이터가 진짜 반환되는지는 mock이 통제하므로, 실질적 어서션은 호출 인자 쪽에 둔다:

- `select('col')`: 의도한 컬럼만 select했는가 (over-fetch 방지)
- `order(...)`: 단일 행 가정 안정성 확보
- `upsert(rows, { onConflict: 'key' })`: 멱등성 보장 키
- trivial filter (예: `gte('id', 0)`): 단일 행 update 가드

이 인자들이 깨지면 운영에서 조용히 문제가 생긴다 (over-fetch는 비용, 잘못된 onConflict는 중복 row 또는 throw). 단위 테스트가 이걸 잡는 게 가장 큰 가치.

## 5. 시간 검증 패턴 — `new Date().toISOString()` 같은 자동 생성 값

호출 시점의 시각을 payload에 넣는 코드를 검증할 때, mock 시각을 고정(`vi.useFakeTimers()`)하는 대신 **실제 시각의 범위**를 검증:

```ts
const before = Date.now();
await repo.update(client, value);
const after = Date.now();

const payload = update.mock.calls[0][0];
const ts = Date.parse(payload.timestamp);
expect(ts).toBeGreaterThanOrEqual(before);
expect(ts).toBeLessThanOrEqual(after);
```

- **fake timer 회피**: 시간 통제 이유가 없으면 굳이 쓰지 않음
- **flake 방지**: 정확한 시각 비교가 아니라 범위 검증 → 시계 해상도나 await 사이 마이크로 지연에 견고
- **포맷 검증 동시에**: `Date.parse`가 NaN이 아니면 ISO 형식이 유효하다는 부수 검증

## 6. 에러 메시지 정규식 검증

```ts
await expect(repo.update(client, 9999)).rejects.toThrow(
  /Failed to update .*=9999: permission denied/,
);
```

리포지터리는 컨텍스트를 메시지에 넣어 throw한다. 테스트가 정규식으로 그 컨텍스트(식별자, 원본 에러 메시지)를 확인 → 로그에서 디버깅 가능한 정도의 정보가 보존되는지 보장. 문자열 완전 일치 대신 정규식을 쓰면 메시지 prefix/suffix가 미세 조정돼도 테스트가 안 깨진다.

## 7. 한계

- **빌더 형태가 바뀌면 mock 깨짐**: 종단 메서드를 바꾸면 (`single()` → `maybeSingle()` 등) mock에도 그 자리에 단계를 만들어줘야 함
- **빌더 자체의 정확성은 검증 불가**: trivial filter가 실제로 PostgREST 쿼리로 어떻게 변환되는지 같은 의미론은 통합 테스트 영역
- **타입 단언의 비용**: `as unknown as ClientType`이 mock이 실제 인터페이스와 어긋나는 변화를 잡지 못함 → 통합 테스트로 보강 필요
