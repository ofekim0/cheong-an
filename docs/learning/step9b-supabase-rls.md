# Supabase RLS — 소유권을 DB가 강제하게 만드는 법

사용자 소유 데이터(구독, 설정, 북마크 …)를 저장할 때 "내 row만 읽고 쓸 수 있다"를 **애플리케이션 코드가 아니라 DB가** 강제하게 만드는 게 RLS(Row Level Security)다. 이 문서는 RLS를 처음 실전 적용하며 확인한 **어느 프로젝트에나 가져갈 수 있는 패턴 5가지**를 추린다. 청안 고유 결정(어떤 테이블에 어떤 정책을 붙였나, L1/L2 분리 모델)은 ADR 008 소관이다.

---

## 1. RLS의 멘탈 모델 — WHERE 절이 아니라 "통과 못 하면 없는 row"

RLS를 켜면(`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) 그 테이블은 **기본 거부**가 된다 — 정책(POLICY)이 명시적으로 허용한 row만 보이고 만질 수 있다. 앱 코드의 `WHERE user_id = ?`와 결정적으로 다른 점:

```
WHERE 필터:  개발자가 매 쿼리마다 기억해서 넣어야 함 → 한 곳이라도 빠지면 유출
RLS 정책:    DB가 모든 쿼리에 자동 적용 → 앱 코드가 실수해도 뚫리지 않음 ✅
```

정책을 통과하지 못한 row는 에러가 아니라 **"존재하지 않는 것처럼"** 동작한다(SELECT에서 안 보임, UPDATE/DELETE 대상에서 제외). 단 INSERT/UPDATE의 새 값 검증(`WITH CHECK`) 실패는 명시적 에러(42501)로 떨어진다.

---

## 2. 정책의 해부 — USING과 WITH CHECK는 검사 시점이 다르다

정책마다 조건식이 두 종류인데, **무엇을 검사하느냐**가 다르다:

- **`USING`**: **기존 row**에 대한 조건 — "이 row가 너에게 보이는가/만질 수 있는가"
- **`WITH CHECK`**: **새로 쓰일 값**에 대한 조건 — "이 내용으로 저장해도 되는가"

명령별로 적용되는 조건식:

| 명령   | USING              | WITH CHECK       |
| ------ | ------------------ | ---------------- |
| SELECT | ✅ (보이는 row)    | —                |
| INSERT | —                  | ✅ (넣으려는 값) |
| UPDATE | ✅ (수정 대상 row) | ✅ (수정 후 값)  |
| DELETE | ✅ (삭제 대상 row) | —                |

소유권 강제의 표준형은 네 명령 모두 `user_id = auth.uid()`:

```sql
CREATE POLICY t_update_own ON t
  FOR UPDATE USING (user_id = (SELECT auth.uid()))      -- 남의 row는 수정 대상조차 아님
  WITH CHECK (user_id = (SELECT auth.uid()));           -- 수정 결과를 남의 소유로 바꾸는 것도 차단
```

UPDATE에서 `WITH CHECK`를 생략하면 **`USING`이 WITH CHECK 역할까지 겸한다** — 공식 규칙: "If only a USING clause is specified, then that clause will be used for both USING and WITH CHECK cases." 즉 생략해도 보안 구멍이 생기는 건 아니다. 그래도 명시적으로 둘 다 쓰는 이유는 **명시성**이다 — 두 조건이 달라야 하는 정책과 형태가 일관되고, 읽는 사람이 겸용 규칙을 몰라도 의도가 바로 보인다.

덧붙여, 같은 명령에 정책이 여러 개면 **OR로 결합**된다(permissive 기본). 나중에 "관리자는 전체 읽기" 같은 정책을 추가하면 기존 본인-row 정책과 합집합으로 넓어진다는 뜻이다 — AND로 좁히려면 별도의 `AS RESTRICTIVE` 정책을 쓴다.

---

## 3. 함정 — UPSERT는 INSERT 정책만으로는 안 된다

이번에 직접 밟은 함정. UPSERT(`INSERT ... ON CONFLICT DO UPDATE`)는 충돌이 없으면 INSERT지만, **충돌이 나면 내부적으로 UPDATE를 실행**한다. 즉:

```
UPSERT의 실제 권한 요구 = INSERT 정책 + UPDATE 정책
```

INSERT 정책만 있으면 **최초 저장은 성공하고 두 번째부터 실패**한다 — "처음엔 됐는데 재시도하면 42501"이라는, 원인을 짐작하기 어려운 증상이 된다. 멱등 저장(재구독, 설정 갱신)을 UPSERT로 구현한다면 UPDATE 정책을 반드시 함께 만든다.

역방향 함정도 있다: 충돌 대상 row가 **남의 소유**면 UPDATE의 `USING`에 걸려 UPSERT 전체가 42501로 실패한다. "같은 자연키를 두 사용자가 다툴 수 있는 스키마"(예: endpoint 단독 UNIQUE)에서 터지는데, 근본 해법은 정책이 아니라 **유니크 키에 user_id를 포함해 다툼 자체를 없애는 것**이다(청안이 `UNIQUE(user_id, endpoint)`로 간 이유 — ADR 008).

---

## 4. 어떤 클라이언트로 쓰느냐가 곧 보안 모델이다

Supabase 클라이언트는 쓰는 키에 따라 RLS 적용 여부가 갈린다:

| 클라이언트                | 키           | RLS      | `auth.uid()` | 용도                           |
| ------------------------- | ------------ | -------- | ------------ | ------------------------------ |
| admin (service role)      | service_role | **우회** | null         | 크론·배치 등 시스템 작업       |
| 세션 바인딩 (anon + 쿠키) | anon         | **적용** | JWT의 `sub`  | 사용자 소유 데이터의 읽기/쓰기 |

`auth.uid()`는 마법이 아니라 **요청에 실린 JWT의 `sub` 클레임**이다. 세션 바인딩 클라이언트로 쓰면, 클라이언트가 body에 남의 `user_id`를 넣어 보내도 `WITH CHECK (user_id = auth.uid())`가 DB에서 거부한다 — 소유권 검증을 라우트 코드가 아니라 스키마가 보증하는 구조.

**안티패턴**: 사용자 요청 처리 라우트에서 admin 클라이언트로 쓰기. 동작은 하지만 RLS가 통째로 꺼진 경로가 생기고, `user_id`를 올바르게 세팅할 책임이 전부 앱 코드로 돌아온다. admin 클라이언트는 "사용자 컨텍스트가 없는 작업"(크론 크롤 저장 등)에만 쓴다.

---

## 5. 성능 습관 — `auth.uid()`는 `(SELECT auth.uid())`로 감싼다

정책 조건에 함수를 직접 쓰면 **row마다 재평가**될 수 있다. 서브쿼리로 감싸면 PostgreSQL이 initPlan으로 **쿼리당 1회 평가 후 캐시**한다:

```sql
-- row마다 auth.uid() 호출 가능성
USING (user_id = auth.uid())

-- 쿼리당 1회 평가 (Supabase 공식 권장)
USING (user_id = (SELECT auth.uid()))
```

row 수가 작을 땐 차이가 안 보이지만, 습관으로 굳혀두면 테이블이 커져도 정책이 병목이 되지 않는다.

같은 맥락의 권장사항 하나 더: 정책에 `TO authenticated`를 지정하면 **비로그인(anon) 요청은 정책 평가 자체를 스킵**한다. 로그인 사용자 전용 테이블이면 붙여두는 게 이득이다.

### 덤 — 복합 UNIQUE가 있으면 선두 컬럼 단독 인덱스는 중복

RLS와 직접 관련은 없지만 같은 마이그레이션에서 배운 것: `UNIQUE (user_id, endpoint)`는 복합 B-tree 인덱스를 만들고, PostgreSQL은 **leftmost prefix 규칙**으로 선두 컬럼 단독 조건(`WHERE user_id = ?`)에도 이 인덱스를 쓴다. FK 참조 확인도 커버된다. 따라서 `CREATE INDEX ... (user_id)`를 따로 만들면 조회 이득은 없고 쓰기마다 인덱스 유지 비용만 든다.

---

## 6. 테스트 관점

RLS 정책 자체는 단위 테스트로 검증할 수 없다(정책은 DB에 산다). 역할 분담:

- **단위 테스트**: 매퍼·리포지터리 호출 형태(충돌 키, 전달 row)와 라우트의 에러 매핑 — 클라이언트를 모킹.
- **정책의 실효성**: 실제 DB가 필요한 통합/E2E 영역. 최소한 "세션 클라로 남의 row 접근 시도 → 거부"를 수동 또는 E2E로 1회 확인.
- 라우트가 세션 바인딩 클라이언트를 쓰는지(admin이 아니라)는 코드 리뷰 관점의 체크포인트.

---

## 7. 참고

- Supabase RLS 가이드: https://supabase.com/docs/guides/database/postgres/row-level-security
- PostgreSQL CREATE POLICY: https://www.postgresql.org/docs/current/sql-createpolicy.html
- RLS 성능 권장사항 (`(SELECT auth.uid())` 패턴): https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv
- PostgreSQL 복합 인덱스와 leftmost prefix: https://www.postgresql.org/docs/current/indexes-multicolumn.html
