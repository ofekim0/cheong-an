# Step 7-a. Supabase 서버 전용 admin 클라이언트

> 선행: [step6-data-source-redesign.md](./step6-data-source-redesign.md)

크롤러가 만든 `AnnouncementDetail[]`을 Supabase `announcements` 테이블에 쓰기 위한 **서버 전용** 클라이언트. 브라우저(클라이언트)에서는 절대 호출하지 않는 것을 코드와 환경 모두에서 보장하는 것이 이 모듈의 전부.

## 1. 왜 "서버 전용" 인가 — service_role 키의 위험성

Supabase는 두 종류 키를 발급한다.

| 키             | 의도                                       | RLS        | 노출 가능 여부                           |
| -------------- | ------------------------------------------ | ---------- | ---------------------------------------- |
| `anon`         | 브라우저용 공개 키. 모든 클라이언트가 사용 | **적용됨** | 공개 OK                                  |
| `service_role` | 서버 전용 마스터 키                        | **무시됨** | 절대 노출 금지 (모든 행 read/write 가능) |

`service_role` 키가 한 번이라도 브라우저 번들에 포함되면 누구든 모든 테이블을 자유롭게 read/write할 수 있다 → RLS가 무력화된 상태로 DB가 공개된 셈. 그래서 본 모듈은:

- `SUPABASE_SERVICE_ROLE_KEY`는 `process.env`에서만 읽고 (`NEXT_PUBLIC_` 접두사를 절대 붙이지 않음 → Next.js가 번들에 포함하지 않음)
- 클라이언트 인스턴스 생성을 server-only 함수로 분리 (`'use client'` 컴포넌트에서 import 시 빌드/런타임에 즉시 깨지도록)

## 2. 구조

```
src/lib/supabase/
  client.ts                          ← getSupabaseAdminClient()
  announcementsRepository.ts         ← UPSERT (Step 7-b)
  crawlStateRepository.ts            ← single-row read/update (Step 7-b)
```

`client.ts`는 keys만 읽어 `createClient(url, key)`를 호출하는 얇은 팩토리. 리포지터리 레이어가 이 클라이언트를 인자로 받아 쓴다.

## 3. 핵심 설계 결정

### 3-1. 환경 변수 명명 — `NEXT_PUBLIC_` 접두사 금지

Next.js는 `NEXT_PUBLIC_`이 붙은 환경 변수만 브라우저 번들에 inline한다. 따라서:

```bash
# ✅ 서버 전용
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# ❌ 절대 사용 금지 — 빌드 시 브라우저 번들에 박힘
NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=
```

`SUPABASE_URL`도 서버 전용 admin 호출에만 쓸 거라 `NEXT_PUBLIC_` 접두사를 붙이지 않았다. 추후 브라우저에서 anon 클라이언트로 직접 read할 일이 생기면, 그 때 별도 `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` 쌍을 추가하면 된다.

### 3-2. 환경 변수 누락 시 throw (lazy + 명시)

```ts
export function getSupabaseAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
```

- **lazy**: 모듈 import 시점이 아니라 함수 호출 시점에 검증. 빌드 타임에 환경 변수가 비어 있어도 build가 깨지지 않고, 실제 호출하는 코드 경로에서만 실패한다 (테스트, 로컬 dev에서 다른 경로를 만지는 동안 방해받지 않음).
- **명시**: `||`로 falsy 검사 + Error 던지기. silent fallback (`?? 'localhost'`) 같은 위험한 기본값을 두지 않는다.

### 3-3. `persistSession: false`

서버 컨텍스트(크론, Route Handler)는 stateless — 세션을 디스크/로컬스토리지에 저장할 필요가 없다. 기본값은 브라우저 환경을 가정해 localStorage를 만지려 들기 때문에, Node 환경에서 불필요한 warning/실패를 막기 위해 명시적으로 끈다.

### 3-4. 매 호출마다 새 인스턴스 vs 모듈 상수 — 매 호출

```ts
// ✅ 채택
export function getSupabaseAdminClient(): SupabaseClient { ... }

// ❌ 미채택
export const supabaseAdmin = createClient(...);
```

채택 안은 다음을 보장한다:

- **테스트에서 env를 변경**하고 다시 호출하면 새 값으로 반영 (모듈 캐싱 무관)
- **import-time 부작용 없음** — `process.env`를 모듈 로드 시점에 안 본다. `.env.test` 로딩이 늦어도 안전

성능 우려는 미미 (`createClient`는 그냥 객체 생성). 크롤링 주기가 시간당 한 번이라 매 회 새로 만드는 비용은 무시 가능.

## 4. server-only 보장 — 현재 상태와 한계

현재는 **호출자 규율**에 의존한다. 즉:

- Route Handler / 크론 작업 / 테스트만 `getSupabaseAdminClient()`를 부른다는 규칙
- `'use client'` 컴포넌트는 호출 안 한다는 규칙

이걸 빌드 타임에 강제하려면 `import 'server-only'` 모듈을 `client.ts` 최상단에 추가하면 된다 (Next.js 13+ 패키지 — client 컴포넌트가 import하면 빌드 실패). 아직 도입하지 않은 이유:

- 현재 코드 경로 자체가 server only (`src/lib/crawler/` + Route Handler 계획만)
- `server-only` 추가는 한 줄, 의존성도 가볍지만 본 시점에서는 YAGNI
- 추후 UI에서 anon read를 추가하며 admin 경로와 명확히 분리할 시점에 같이 도입

## 5. 한계와 다음 단계

- **anon 클라이언트 미작성** — 사용자 푸시 구독 같은 브라우저-측 read/write가 필요해지는 Phase 2부터 별도 모듈로 추가
- **RLS 미설정** — service_role만 쓰는 동안 RLS는 무시되므로 보안 위협이 없다. anon 클라이언트 도입 시점에 announcements는 read-only, push_subscriptions는 본인 row만 RLS 정책 추가 필요
- **server-only enforcement 미적용** — Phase 2 anon 클라이언트와 같이 도입 (위 §4)
- **다중 인스턴스 환경에서의 동시 write** — Vercel multi-instance에서 같은 boardId를 두 인스턴스가 동시에 upsert해도 `ON CONFLICT (board_id)`로 안전 (Step 7-b §3-3 참고). 다만 `crawl_state` 갱신은 마지막 write가 이김 → 스케줄러 단계에서 동시성 1로 제한

## 6. 참고

- Supabase JS 공식: https://supabase.com/docs/reference/javascript/initializing
- Service role key 보안: https://supabase.com/docs/guides/api/api-keys
- Next.js `server-only`: https://nextjs.org/docs/app/building-your-application/rendering/composition-patterns#keeping-server-only-code-out-of-the-client-environment
