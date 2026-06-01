# Supabase 서버 전용 admin 클라이언트

DB 쓰기 작업을 하는 서버 측 모듈을 만들 때 반복적으로 나타나는 패턴: **service_role 키는 RLS를 우회한다 → 브라우저 번들에 절대 노출되면 안 된다.** 이를 코드와 환경 양쪽에서 보장하는 설계 원칙들.

## 1. 왜 "서버 전용" 인가 — service_role 키의 위험성

Supabase는 두 종류 키를 발급한다.

| 키             | 의도                                       | RLS        | 노출 가능 여부                           |
| -------------- | ------------------------------------------ | ---------- | ---------------------------------------- |
| `anon`         | 브라우저용 공개 키. 모든 클라이언트가 사용 | **적용됨** | 공개 OK                                  |
| `service_role` | 서버 전용 마스터 키                        | **무시됨** | 절대 노출 금지 (모든 행 read/write 가능) |

`service_role` 키가 한 번이라도 브라우저 번들에 포함되면 누구든 모든 테이블을 자유롭게 read/write할 수 있다 → RLS가 무력화된 상태로 DB가 공개된 셈. 보호 수단:

- `SUPABASE_SERVICE_ROLE_KEY`는 `process.env`에서만 읽고 (`NEXT_PUBLIC_` 접두사를 절대 붙이지 않음 → Next.js가 번들에 포함하지 않음)
- 호출자(Route Handler / 크론 / 테스트)가 server-only 컨텍스트에서만 import한다는 규율에 의존 (빌드 타임 강제는 §4 참조)

## 2. 핵심 설계 결정

### 2-1. 환경 변수 명명 — `NEXT_PUBLIC_` 접두사 금지

Next.js는 `NEXT_PUBLIC_`이 붙은 환경 변수만 브라우저 번들에 inline한다. 따라서:

```bash
# ✅ 서버 전용
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# ❌ 절대 사용 금지 — 빌드 시 브라우저 번들에 박힘
NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=
```

URL 역시 서버 전용 admin 호출에만 쓰는 한 `NEXT_PUBLIC_` 접두사를 붙이지 않는다. 브라우저에서 anon 클라이언트로 직접 read가 필요해지면 그 때 별도 `NEXT_PUBLIC_` 쌍을 추가한다.

### 2-2. 환경 변수 누락 시 throw (lazy + 변수별 메시지)

```ts
const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) throw new Error('SUPABASE_URL environment variable is not set. ...');
if (!serviceRoleKey)
  throw new Error('SUPABASE_SERVICE_ROLE_KEY ... is not set. ...');
```

- **lazy**: 모듈 import 시점이 아니라 함수 호출 시점에 검증. 빌드 타임에 환경 변수가 비어 있어도 build가 깨지지 않고, 실제 호출하는 코드 경로에서만 실패한다 (테스트, 로컬 dev에서 다른 경로를 만지는 동안 방해받지 않음).
- **변수별 분기 검사**: 두 변수를 한 번에 묶지 않고 각각 검사 → 운영 로그/배포 진단 시 어느 변수가 빠졌는지 메시지로 즉시 식별 가능. silent fallback (`?? 'localhost'`) 같은 위험한 기본값을 두지 않는다.

### 2-3. `auth: { persistSession: false, autoRefreshToken: false }`

서버 컨텍스트(크론, Route Handler)는 stateless — 세션 저장도, 토큰 갱신도 필요 없다. 두 옵션을 함께 끈다:

- `persistSession: false`: 기본값은 브라우저 환경을 가정해 localStorage를 만지려 들기 때문에, Node 환경에서 불필요한 warning/실패를 막는다.
- `autoRefreshToken: false`: service_role 키는 자체적으로 만료/갱신 대상이 아니다. 백그라운드 토큰 갱신 타이머가 도는 것을 막아 idle 핸들이 남지 않게 한다 (서버리스 함수 종료가 깨끗해짐).

### 2-4. 모듈 레벨 캐시 + 테스트용 reset 헬퍼

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

대안: 매 호출마다 새 인스턴스 → reset 헬퍼 불필요(testability 무료). 호출 빈도가 낮으면 비용 차이는 무시 가능. 캐시 + 명시적 reset 쪽은 "스테이트리스 호출자 + 공유 클라이언트" 의도가 더 분명하고 idle handle 누적 위험도 줄어든다는 트레이드오프.

## 3. server-only 보장 — 호출자 규율 vs 빌드 타임 강제

현재는 **호출자 규율**에 의존한다 — Route Handler / 크론 / 테스트만 admin 클라이언트를 부른다는 규칙. 빌드 타임에 강제하려면 `import 'server-only'` 모듈을 최상단에 추가하면 된다 (Next.js 13+ — client 컴포넌트가 import하면 빌드 실패). anon 클라이언트가 도입되어 admin 경로와 명확히 분리할 시점에 같이 도입하는 게 자연스럽다.

## 4. 참고

- Supabase JS 공식: https://supabase.com/docs/reference/javascript/initializing
- Service role key 보안: https://supabase.com/docs/guides/api/api-keys
- Next.js `server-only`: https://nextjs.org/docs/app/building-your-application/rendering/composition-patterns#keeping-server-only-code-out-of-the-client-environment
