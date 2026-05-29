# 관계형 DB 기초 — 프론트엔드 개발자 관점

> SQL 문법을 외우기보다 **"이게 왜 필요하고 어떤 역할인지"**를 이해하는 데 초점.

## 1. 마이그레이션(Migration)

DB 구조(테이블, 컬럼 등)를 **코드로 관리**하는 방식. SQL 파일을 작성해두면 어떤 환경에서도 동일한 DB 구조를 재현할 수 있다.

```
프론트엔드 비유:
  package.json → pnpm install → 동일한 node_modules 재현
  migration.sql → supabase db push → 동일한 DB 구조 재현
```

왜 필요한가:

- DB 구조를 Git으로 버전 관리할 수 있다
- 팀원이나 CI에서 동일한 DB를 만들 수 있다
- "이 테이블이 언제, 왜 만들어졌는지" 이력이 남는다

파일명에 `00001_`같은 번호가 붙는 이유: 마이그레이션은 **순서대로** 실행되어야 하므로 번호로 순서를 보장한다.

## 2. 테이블과 컬럼

```sql
CREATE TABLE items (
  id         BIGINT PRIMARY KEY,    -- 각 행을 구분하는 고유 식별자
  external_id INTEGER NOT NULL,     -- 값이 반드시 있어야 함
  title      TEXT NOT NULL,
  category   TEXT                    -- NULL 허용 (값이 없을 수 있음)
);
```

| SQL 개념    | 프론트엔드 비유                          | 설명                  |
| ----------- | ---------------------------------------- | --------------------- |
| 테이블      | TypeScript interface                     | 데이터의 구조를 정의  |
| 컬럼        | interface의 각 속성                      | 각 필드의 이름과 타입 |
| 행(row)     | 하나의 객체 `{}`                         | 실제 데이터 한 건     |
| `NOT NULL`  | 필수 속성 (`title: string`)              | 값이 반드시 있어야 함 |
| `NULL` 허용 | 옵셔널 속성 (`category: string \| null`) | 값이 없을 수 있음     |

## 3. PRIMARY KEY

테이블의 각 행을 **유일하게 식별**하는 컬럼. 모든 테이블에 하나씩 있어야 한다.

```sql
id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
-- GENERATED ALWAYS AS IDENTITY: 새 행이 추가될 때마다 자동으로 1, 2, 3... 증가
-- 직접 id를 지정할 필요 없이 DB가 알아서 부여
```

## 4. UNIQUE 제약

```sql
external_id INTEGER NOT NULL UNIQUE
```

"이 컬럼의 값은 테이블 전체에서 중복될 수 없다." 같은 값을 두 번 INSERT하면 DB가 거부한다. **코드에서 중복 체크를 하지 않아도 DB 레벨에서 안전장치**가 되는 것.

UPSERT의 `onConflict`가 작동하는 기반이기도 하다 — UNIQUE 제약이 있는 컬럼을 conflict target으로 지정해야 멱등 INSERT가 가능하다.

## 5. INDEX (인덱스)

```sql
CREATE INDEX idx_items_external_id ON items (external_id);
CREATE INDEX idx_items_created_at  ON items (created_at DESC);
```

인덱스는 **검색 속도를 높이기 위한 목차**다.

```
비유:
  인덱스 없음 = 책에서 특정 단어를 찾으려면 1페이지부터 끝까지 읽어야 함
  인덱스 있음 = 책 뒤의 색인에서 바로 해당 페이지로 이동
```

**언제 만드나**: 자주 검색하거나 정렬에 쓰는 컬럼. 너무 많이 만들면 INSERT/UPDATE가 느려진다 (인덱스도 같이 갱신해야 하므로) — 균형 필요.

**복합 인덱스**: `(a, b)` 인덱스는 `a` 단독 검색에도 쓰이지만 `b` 단독 검색에는 안 쓰인다 (전화번호부가 성-이름 순으로 정렬되어 있을 때 성으로는 찾을 수 있지만 이름만으로는 못 찾는 것과 같다).

## 6. ENUM 타입

```sql
CREATE TYPE category_type AS ENUM ('public', 'private');
```

허용되는 값을 **DB 레벨에서 제한**한다. TypeScript의 유니온 타입(`'public' | 'private'`)과 같은 역할을 DB에서 한다.

오타 (`'pubilc'`)를 넣으려고 하면 DB가 거부한다. 코드와 DB 양쪽에서 이중 안전장치.

## 7. 트리거(Trigger)

```sql
CREATE TRIGGER items_updated_at
  BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

"특정 이벤트가 발생하면 자동으로 실행되는 함수." 예: 행이 UPDATE될 때마다 `updated_at` 컬럼을 자동으로 현재 시각으로 갱신.

```
프론트엔드 비유:
  DOM 이벤트 리스너: element.addEventListener('click', handler)
  DB 트리거:        CREATE TRIGGER ... BEFORE UPDATE ... EXECUTE FUNCTION ...

  "이벤트가 발생하면 자동으로 뭔가를 실행한다"는 개념은 동일
```

코드에서 매번 `updated_at = new Date()`를 넣을 필요 없이 DB가 처리한다.

## 8. TypeScript 타입과 DB 스키마의 관계

```
TypeScript (코드)                     SQL (DB)
─────────────────                     ────────
interface ItemRow             ←→      CREATE TABLE items
  externalId: number          ←→        external_id INTEGER
  title: string               ←→        title TEXT NOT NULL
  category: string | null     ←→        category TEXT  (NULL 허용)
  type: 'public' | 'private'  ←→        type category_type ENUM(...)
  createdAt: string           ←→        created_at TIMESTAMPTZ DEFAULT now()
```

주의: TypeScript는 camelCase(`externalId`), SQL은 snake_case(`external_id`). 코드와 DB 사이에서 변환이 필요하며, 이는 **리포지터리 레이어**에서 처리한다 (별도 학습 정리 참조).

## 9. 자주 마주치는 문법 요약

```sql
-- 시간 컬럼의 표준
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
-- TIMESTAMPTZ: 시간대 정보 포함. UTC로 저장하고 클라이언트가 표시 시 변환

-- 외래 키 (FK)
parent_id BIGINT REFERENCES parents(id) ON DELETE CASCADE
-- parents 테이블의 row가 삭제되면 자식도 같이 삭제

-- 부분 인덱스
CREATE INDEX idx_active ON items (created_at) WHERE deleted_at IS NULL;
-- 살아있는 row에만 인덱스 → 인덱스 크기 절약
```

## 10. 알아두면 좋은 위험 신호

- **N+1 쿼리**: 목록 N개를 가져온 뒤 각각에 대해 추가 쿼리를 N번 더 던지는 패턴. JOIN이나 batched IN으로 1~2회로 줄여야 함
- **인덱스 없는 컬럼 검색**: 데이터가 적을 때는 모르지만 100만 행이 되면 응답이 수십 초로 늘어남
- **NOT NULL 제약 누락**: 코드는 채워서 보내겠지만 6개월 뒤 누군가 직접 INSERT할 때 빈 row가 들어옴 → 정합성 깨짐
- **자동 increment ID 노출**: URL에 `/items/123` 같은 순차 ID를 노출하면 "옆 번호 itemId는 뭐가 있지?"라는 추측 공격이 가능. 외부 노출용 ID는 UUID 또는 별도 슬러그
