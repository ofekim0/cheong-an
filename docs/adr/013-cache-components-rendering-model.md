# ADR 013: 목록 페이지 렌더링 모델 — Cache Components 전환과 태그 기반 무효화

- **상태**: 제안됨
- **작성일**: 2026-09-02
- **관련 이슈**: #83 (Step c-2)
- **관련 ADR**: 009 (열람은 공개, 구독만 인증)

## 맥락

Step b(PR #87)에서 공고 목록 페이지를 SSG + ISR로 만들었다. 페이지에 `export const revalidate = 3600`을 두어 상한을 잡고, 크롤 라우트가 새 공고를 저장한 직후 `revalidatePath('/announcements')`로 즉시 무효화하는 조합이다.

Step c는 여기에 페이지네이션과 필터를 붙인다. 둘 다 **URL 쿼리**로 표현하기로 이미 정해져 있다 — `announcements` 테이블에 anon GRANT가 없어 클라이언트 직결 조회가 401이므로(#83 선결 확인), 조회는 서버에서만 하고 상태는 주소에 담는다.

여기서 프레임워크 제약이 드러났다. Next 공식 문서(`app/api-reference/file-conventions/page`):

> `searchParams` is a **Request-time API** whose values cannot be known ahead of time. Using it will opt the page into **dynamic rendering** at request time.

라우트 어디서든 `searchParams`를 읽으면 **라우트 전체가 동적 렌더링**이 된다. 문서가 안내하는 "static shell 최대화"(Suspense 하위에서 읽어 나머지를 정적으로 남기기)는 Cache Components 전용 기능이라 플래그 없이는 쓸 수 없다.

즉 **Step b의 캐싱과 Step c의 요구가 양립하지 않는다.** 게다가 이 페이지의 조회는 `fetch`가 아니라 Supabase 클라이언트 호출이라 Next의 Data Cache 폴백도 없다. 동적 렌더링이 되면 매 요청이 그대로 DB를 친다.

무효화 방식도 같이 재검토 대상이 됐다. `revalidatePath('/announcements')`는 **경로 하나**를 지목하는데, `?page=2`·`?type=public`처럼 쿼리 조합마다 캐시 항목이 갈라지면 경로로는 그 조합들을 지목할 수 없다.

## 고려한 선택지

### 선택지 1: 동적 렌더링 수용

페이지에서 그대로 `searchParams`를 읽고 매 요청 DB를 조회한다. `revalidate`와 cron의 `revalidatePath`(및 관련 테스트)는 삭제한다.

- 장점: 가장 단순하다. 프레임워크 기능 도입이 0이고 코드가 줄어든다.
- 장점: 현재 규모(공고 69건, 방문자 극소수)에서 체감 성능 문제가 없다.
- 단점: Step b가 세운 캐싱이 통째로 사라진다. "크롤이 저장 직후 웹 반영을 보장한다"는 장치도 함께 사라져, `step83-isr.md`의 학습 내용이 코드와 어긋난다.
- 단점: Supabase 쿼리 수가 방문 수에 선형 비례한다. 무료 티어를 쓰는 서비스에서 그 비례를 끊을 장치가 코드에 남지 않는다.

### 선택지 2: 페이지·필터를 경로 세그먼트로 옮기기

쿼리 대신 경로에 담는다(`/announcements/[[...slug]]`). 경로는 빌드 시점에 알 수 있는 값이므로 정적 생성 + ISR을 그대로 유지할 수 있다.

- 장점: Step b의 모델을 그대로 유지한다. 전역 플래그가 필요 없다.
- 장점: 무효화도 `revalidatePath('/announcements/[[...slug]]', 'page')` 패턴 형태로 전체 매칭이 가능하다.
- 단점: **필터가 늘수록 경로 설계가 무너진다.** 필터 2개만 붙어도 순서·생략 규칙을 직접 정해야 하고(`/announcements/public/2`인지 `/announcements/page/2/public`인지), 차원이 추가될 때마다 라우팅 규칙이 바뀐다.
- 단점: URL이 인위적이다. 필터는 본질적으로 쿼리이고, 사용자가 지우거나 조합하는 대상이다.

### 선택지 3: Cache Components 전환 (채택)

`next.config.ts`에 `cacheComponents: true`. 페이지 컴포넌트는 async가 아니고 `searchParams`를 await하지 않는다 — promise를 Suspense 하위 컴포넌트로 내려보내 거기서 읽는다. 조회는 `'use cache: remote'` 함수로 감싸 인자(page, 그리고 c-3의 필터)를 캐시 키로 삼고, `cacheTag`로 이름표를 붙인다. 크롤 라우트는 `revalidateTag(tag, { expire: 0 })`로 무효화한다.

- 장점: 껍데기(제목·레이아웃)는 정적으로 남고, 조회 결과는 쿼리 조합별로 캐시된다. 페이지네이션을 붙이면서 캐싱을 잃지 않는다.
- 장점: **조합 수와 무관하게 태그 하나로 정확히 무효화**한다. 경로 무효화로는 불가능한 부분이다.
- 장점: 필터가 늘어도 URL·라우팅 설계가 변하지 않는다 — c-3은 캐시 키에 인자를 하나 더 얹으면 끝이고 무효화 코드는 무변경이다.
- 단점: **전역 플래그다.** 앱 전체가 새 렌더링 모델(PPR)로 바뀐다.
- 단점: `dynamic`·`revalidate` 세그먼트 설정과 **비호환**이라 기존 라우트 4곳을 고쳐야 한다.
- 단점: request-time 데이터에 접근하는 페이지는 Suspense 경계를 갖춰야 빌드가 통과한다 — `/subscribe`처럼 #83 범위 밖 파일도 손대야 한다.

## 결정

`cacheComponents: true`로 전환한다. 목록 조회를 `'use cache: remote'` + `cacheLife('hours')` + `cacheTag(ANNOUNCEMENTS_CACHE_TAG)`로 감싸고, 크롤 라우트의 무효화를 `revalidatePath(ANNOUNCEMENTS_PATH)` → `revalidateTag(ANNOUNCEMENTS_CACHE_TAG, { expire: 0 })`로 교체한다.

## 근거

선택지 1은 Step b를 되돌리는 선택이다. 지금 규모에서 성능상 손해가 없다는 건 맞지만, 그 대가로 "새 공고 → 알림 → 웹에서 확인"의 마지막 구간에서 캐시와 무효화라는 설계 자산을 버린다. 선택지 2는 Step c-3에서 필터가 붙는 순간 URL 설계 부채로 되돌아온다 — 필터는 쿼리로 표현되는 게 맞고, 경로로 옮기는 것은 프레임워크 제약을 URL 구조에 전가하는 것이다.

선택지 3의 전역 플래그 위험은 **추정하지 않고 측정했다.** 플래그를 켜고 빌드를 돌려 실제 낙진을 관측했으며, 그 결과 사전 추정이 두 군데 틀렸다(아래 "측정으로 정정된 추정" 참조). 실제 수정 범위는 세그먼트 설정 제거 4곳 + `/subscribe` 구조 분리 1곳으로, 감당 가능한 크기였다.

### 세부 판단 1: `'use cache'`가 아니라 `'use cache: remote'`

이 조회 함수는 `searchParams`를 읽은 **뒤에** 호출되므로 결과가 static shell에 들어가지 못하고 요청 시점으로 밀린다. 문서(`directives/use-cache-remote`)가 바로 이 상황을 지목한다:

> Remote caching provides the most value when content is deferred to request time (outside the static shell). This typically happens when a component accesses request values like `cookies()`, `headers()`, or `searchParams`, placing it inside a Suspense boundary. (...) In serverless environments, each instance has its own ephemeral memory with low cache hit rates.

그냥 `'use cache'`면 인스턴스별 인메모리 캐시라 서버리스에서 공유되지 않는다. 적중률이 낮으면 **크롤이 태그를 무효화하는 설계 자체가 무의미해진다** — 버릴 캐시가 애초에 거의 없기 때문이다. 문서가 제시한 remote 적합 조건도 맞는다: 캐시 키 조합이 작고(페이지 수 × 필터 조합), 데이터는 시간 단위로만 바뀐다.

### 세부 판단 2: `{ expire: 0 }`이지 `'max'`가 아니다

`revalidateTag`의 권장값은 `'max'`(stale-while-revalidate)지만 여기서는 쓰지 않는다. `'max'`는 다음 요청에 **낡은 내용을 내보내면서** 뒤에서 갱신하는데, 이 서비스에서 크롤 직후의 첫 방문자는 십중팔구 **방금 알림을 받고 들어온 사람**이다. 그 사람에게 정작 그 공고가 빠진 목록을 보여주는 것은 파이프라인 전체의 목적을 무너뜨린다.

`updateTag`(즉시 만료)는 Server Action 전용이라 Route Handler에서 쓸 수 없다. 문서가 이 경우를 명시한다:

> When the invalidation comes from outside a Server Action, for example a webhook or another service calling a Route Handler, `updateTag` is not available. Pass `{ expire: 0 }` to expire the data immediately.

### 세부 판단 3: 세그먼트 설정은 전면 제거한다

`cacheComponents`는 `dynamic`·`revalidate` 세그먼트 설정과 비호환이고 빌드가 이를 거부한다. cron 라우트의 `force-dynamic`을 지워도 요청 시점 실행은 그대로 보장된다 — 핸들러가 `request.headers.get('authorization')`을 읽는 시점에 프리렌더가 중단되기 때문이다. **인증 검사가 곧 동적 실행 보장이다.** POST 핸들러 2개는 애초에 캐시 대상이 아니다.

## 측정으로 정정된 추정 (같은 실수 반복 방지)

플래그를 켜기 전 코드만 읽고 세운 추정 중 둘이 틀렸다. 둘 다 **빌드를 돌려서** 드러났다.

1. **"`force-dynamic`이 붙은 API 라우트 3개는 이미 opt-out이라 영향 없다"** → 틀렸다. `dynamic` 설정은 `cacheComponents`와 **비호환**이라 빌드가 거부한다. opt-out이 아니라 금지다.
2. **"Step b의 자격 증명 부재 가드는 그대로 필요하다"** → 틀렸다. PPR에서 이 조회는 `searchParams` 뒤에 있어 **빌드 시점 프리렌더가 아예 호출하지 않는다**(env 없는 빌드에서 경고 로그가 찍히지 않는 것으로 확인). 가드의 존재 이유였던 "CI가 env 없이 빌드한다"가 성립하지 않는다.

## 배제한 접근 (회귀 방지)

이미 폐기한 접근이 되살아나지 않도록 기록한다.

- **경로 기반 무효화(`revalidatePath`)로 복귀** — 쿼리 조합별 캐시 항목을 지목할 수 없다. 되살리면 `?page=2` 이후 페이지가 낡은 채로 남는다.
- **`revalidateTag(tag)` 단일 인자 호출** — deprecated이며 향후 제거 예고. 두 번째 인자를 반드시 넘긴다.
- **`revalidateTag(tag, 'max')`** — 위 세부 판단 2. 알림 수신자에게 낡은 목록을 보여준다.
- **자격 증명 부재 가드(`hasCredentials` → 빈 목록) 부활** — 근거가 소멸했다. 남겨두면 자격 증명이 빠진 배포가 에러 대신 "공고 없음"으로 위장된다. `getSupabaseAdminClient()`가 어떤 env가 없는지 짚어 throw한다.
- **`export const dynamic` / `export const revalidate` 재도입** — 빌드가 거부한다. 캐시 수명은 `cacheLife`, 동적 실행은 request-time 접근으로 표현한다.

## 결과

- 빌드 출력이 의도한 모양이 됐다: `/announcements`·`/subscribe`는 `◐`(Partial Prerender), API 라우트와 `/auth/callback`은 `ƒ`(Dynamic).
- `/subscribe`도 세션 조회를 Suspense로 분리했다. #83 범위 밖이지만 플래그의 필수 낙진이다.
- **c-3(필터 UI)의 작업량이 줄었다.** 필터를 캐시 키 인자로 추가하면 되고, 무효화 코드는 손대지 않는다.
- **검증됨 (2026-09-02, 프로덕션)**: remote 캐시 핸들러를 호스팅 제공자가 자동 구성한다는 것은 문서 서술("hosting providers should typically provide this automatically")에 의존했으나, Vercel 프로덕션에서 적중을 확인했다. 측정 방법과 한계는 아래 "캐시 적중 검증" 참조.
- **되돌리는 비용**: 플래그 제거 + 페이지를 async로 되돌리고 `revalidate` 복원 + cron `revalidatePath` 복원. 다만 되돌리는 순간 페이지네이션이 있는 한 캐싱은 성립하지 않는다(선택지 1로 귀결).
- 보편 패턴은 `docs/learning/step83-cache-components.md`에 정리한다. Step b 시점의 ISR 정리(`docs/learning/step83-isr.md`)는 그대로 두고 포인터만 잇는다 — 그 시점의 판단 기록으로서 유효하다.

## 캐시 적중 검증 (2026-09-02, 프로덕션)

Vercel은 데이터 캐시 적중을 요청 헤더로 노출하지 않는다. 그래서 **타이밍 기반으로** 확인했다.

측정 설계에서 통제한 교란 요인 둘:

1. **람다 웜업** — 콜드 키와 웜 키를 같은 세션에서 **번갈아** 요청해 상쇄했다. 순차로 몰아 재면 "나중 요청이 빠른" 것이 캐시 때문인지 인스턴스가 데워져서인지 갈리지 않는다.
2. **fallback count 쿼리** — 범위를 벗어난 page는 `PGRST103` 경로로 빠져 count 조회가 한 번 더 나간다(쿼리 2회). 콜드 키를 전부 **1페이지(범위 내)** 로 잡아 제거했다.

전체 응답 시간(초):

| 구분                            | 측정값                        |
| ------------------------------- | ----------------------------- |
| 웜 키 (같은 조합 반복)          | 0.332 · 0.336 · 0.355 · 0.366 |
| 콜드 키 (처음 보는 조합)        | 1.014 · 0.341 · 0.524 · 1.024 |
| 위 콜드 키들의 **두 번째** 요청 | 0.332 · 0.356 · 0.356 · 0.509 |

**결정적 근거는 세 번째 줄이다** — 처음 1.0s였던 키가 두 번째 요청에서 0.33s로 떨어진다. 웜 기준선(0.33~0.37s)은 분산이 매우 작고, 콜드는 최대 3배까지 벌어진다.

PPR shell은 별개로 확인됐다: `X-Nextjs-Prerender: 1` + `X-Vercel-Cache: HIT`, 첫 바이트가 모든 요청에서 0.12~0.15s로 일정하다(껍데기는 CDN에서 즉시 나가고 목록만 스트리밍된다).

**한계**: 직접 관측이 아니라 추론이다. 콜드 샘플 1건(`?type=public&recruitment=initial`, 0.341s)은 처음부터 빨랐는데, 그 조합의 결과가 1건뿐이라 쿼리 자체가 싼 탓일 수 있다. 캐시가 실제로 죽었는지 의심되면 같은 방법(웜/콜드 교차, 범위 내 페이지)으로 다시 재는 것이 재현 절차다.
