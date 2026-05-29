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
- 호출자(Route Handler / 크론 / 테스트)가 server-only 컨텍스트에서만 import한다는 규율에 의존 (빌드 타임 강제 도입은 §4 참조)

## 2. 구조

```
src/lib/supabase/
  client.ts                          ← getSupabaseAdminClient() + resetSupabaseAdminClientCache()
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

### 3-2. 환경 변수 누락 시 throw (lazy + 변수별 메시지)

```ts
const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) throw new Error('SUPABASE_URL environment variable is not set. ...');
if (!serviceRoleKey)
  throw new Error('SUPABASE_SERVICE_ROLE_KEY ... is not set. ...');
```

- **lazy**: 모듈 import 시점이 아니라 함수 호출 시점에 검증. 빌드 타임에 환경 변수가 비어 있어도 build가 깨지지 않고, 실제 호출하는 코드 경로에서만 실패한다 (테스트, 로컬 dev에서 다른 경로를 만지는 동안 방해받지 않음).
- **변수별 분기 검사**: 두 변수를 한 번에 묶지 않고 각각 검사 → 운영 로그/배포 진단 시 어느 변수가 빠졌는지 메시지로 즉시 식별 가능. silent fallback (`?? 'localhost'`) 같은 위험한 기본값을 두지 않는다.

### 3-3. `auth: { persistSession: false, autoRefreshToken: false }`

서버 컨텍스트(크론, Route Handler)는 stateless — 세션 저장도, 토큰 갱신도 필요 없다. 두 옵션을 함께 끈다:

- `persistSession: false`: 기본값은 브라우저 환경을 가정해 localStorage를 만지려 들기 때문에, Node 환경에서 불필요한 warning/실패를 막는다.
- `autoRefreshToken: false`: service_role 키는 자체적으로 만료/갱신 대상이 아니다. 백그라운드 토큰 갱신 타이머가 도는 것을 막아 idle 핸들이 남지 않게 한다 (서버리스 함수 종료가 깨끗해짐).

### 3-4. 모듈 레벨 캐시 + 테스트용 reset 헬퍼

```ts
let cachedClient: SupabaseClient | null = null;

export function getSupabaseAdminClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  // ... env 검사 + createClient ...
  cachedClient = createClient(url, serviceRoleKey, { auth: { ... } });
  return cachedClient;
}

export function resetSupabaseAdminClientCache(): void {
  cachedClient = null;
}
```

- **캐시 채택**: 같은 프로세스의 호출자(여러 Route Handler, 크론 함수)가 동일 인스턴스를 공유. `createClient` 비용(내부 fetch/Realtime 객체 생성)을 회피하고, 내부 connection 재사용을 가능하게 함.
- **import-time 부작용 없음**: 캐시지만 모듈 로드 시점에 `createClient`를 호출하지 않는다. 첫 호출 시점에만 env를 본다 → `.env.test` 로딩이 늦어도 안전.
- **테스트 격리용 reset**: env를 바꿔가며 검증하는 테스트가 캐시에 발목 잡히지 않도록 `resetSupabaseAdminClientCache()`를 같이 export. 호출자(Route Handler / 크론)는 절대 부르지 않음 — 테스트 전용 escape hatch.

대안 (미채택): 매 호출마다 새 인스턴스 → reset 헬퍼 불필요(testability 무료). 본 프로젝트 규모(시간당 1회)에서는 비용 차이 무시 가능하지만, 캐시 + 명시적 reset 쪽이 "스테이트리스 호출자 + 공유 클라이언트" 의도가 더 분명하고 idle handle 누적 위험도 줄여서 채택.

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
