# Next.js Cache Components — 쿼리 파라미터가 붙은 페이지를 캐시하기

목록 페이지에 페이지네이션을 붙이려는 순간 ISR이 무력해진다. `?page=2` 같은 **쿼리 파라미터를 읽으면 라우트 전체가 동적 렌더링으로 승격**되기 때문이다. Cache Components(PPR)는 이 충돌을 라우트 단위가 아니라 **트리 단위**로 푸는 렌더링 모델이다. #83 Step c-2에서 전환하며 확인한 **어느 프로젝트에나 가져갈 보편 패턴**을 추린다. §8은 #96(상세 페이지)에서 **동적 세그먼트(`params`)**에 같은 모델을 적용하며 덧붙였다.

기준 버전: Next.js 16.2.1 (App Router, Turbopack), `cacheComponents: true`.

선행 문서: [`step83-isr.md`](./step83-isr.md) — `cacheComponents`를 켜지 않은 기본 설정에서의 ISR. 시간 기반·온디맨드 무효화의 성격과 "쓰기 완료 후 조건부 무효화" 규칙은 이 모델에서도 그대로 유효하니 먼저 읽는 게 좋다. 다만 그 문서의 §2(세그먼트 설정)·§5(빌드가 DB를 부른다)는 이 모델에서 **성립하지 않는다** — 아래 §5·§6에서 다룬다.

청안 고유 판단(왜 이 전환을 택했는지, 선택지 비교, 배제한 접근)은 `docs/adr/013-cache-components-rendering-model.md` 소관이다.

---

## 1. 문제 — `searchParams`는 request-time API다

공식 문서(`app/api-reference/file-conventions/page`)가 못 박는다.

> `searchParams` is a **Request-time API** whose values cannot be known ahead of time. Using it will opt the page into **dynamic rendering** at request time.

핵심은 **"페이지에서"가 아니라 "라우트 어디서든"**이라는 점이다. 컴포넌트 깊숙한 곳에서 읽어도 라우트 전체가 동적이 된다(기본 설정에서는). 따라서 다음 두 요구는 기본 설정에서 동시에 만족될 수 없다.

- 목록을 캐시하고 싶다 (정적/ISR)
- 페이지·필터를 URL 쿼리로 표현하고 싶다 (`searchParams`)

여기에 데이터 소스 종류가 겹치면 더 나빠진다. Next의 Data Cache는 `fetch`를 감싸는 계층이다. **DB 클라이언트 호출처럼 `fetch`를 통하지 않는 조회는 폴백조차 없다** — 동적 렌더링이 되면 매 요청이 그대로 DB를 친다.

## 2. 멘탈 모델 — 라우트 단위에서 트리 단위로

기본 설정의 정적/동적은 **라우트 하나에 하나의 판정**이다. Cache Components는 그 판정을 **컴포넌트 트리의 부분마다** 내린다.

```
                    ┌─ 정적 shell ──────────────┐
<main>              │ 빌드 때 렌더 → CDN        │  즉시 도달
  <header>          │                           │
    제목·레이아웃   │                           │
  <Suspense>        │ fallback도 여기 포함      │
    ─ ─ ─ ─ ─ ─ ─ ─ └───────────────────────────┘
    <List/>           요청 시점에 채워짐 (스트리밍)
      └ 'use cache'   ↳ 단, 조회 결과는 캐시에서
```

방문자는 shell을 먼저 받고, Suspense 안쪽이 이어서 흘러온다. 그래서 **`searchParams`를 읽는 위치가 곧 "얼마나 정적으로 남는가"를 결정한다.** 문서는 이를 "maximizing the static shell"이라 부른다.

실무 규칙 하나로 압축된다.

```tsx
// ❌ 페이지를 async로 만들고 최상단에서 await → shell이 사라진다
export default async function Page({ searchParams }) {
  const { page } = await searchParams;
  ...
}

// ✅ 페이지는 async가 아니다. promise를 그대로 내려보낸다
export default function Page({ searchParams }: PageProps<'/list'>) {
  return (
    <main>
      <h1>목록</h1>
      <Suspense fallback={<Skeleton />}>
        <List searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function List({ searchParams }: Pick<PageProps<'/list'>, 'searchParams'>) {
  const { page } = await searchParams; // 경계 안쪽에서 읽는다
  ...
}
```

같은 원리가 `cookies()`·`headers()`·`params`·캐시되지 않은 데이터 접근 전부에 적용된다. **await를 트리 아래로 미루는 것이 이 모델의 유일한 구조적 습관**이다.

> **함정: `PageProps` 같은 전역 헬퍼는 생성된 타입이다.** 위 예시의 `PageProps<'/list'>`는 `next dev`·`next build`·`next typegen`이 `.next/types`에 만들어내는 타입이다. 즉 **빌드 전에 `tsc --noEmit`을 돌리면 `TS2304: Cannot find name 'PageProps'`로 깨진다.** CI가 typecheck를 build보다 먼저 두는 구성(흔한 순서다)이나 갓 클론한 저장소가 그 상태다. 로컬에서는 이미 빌드한 적이 있어 통과하므로 **CI에서만 빨개진다.** 동적 세그먼트가 없는 라우트라면 헬퍼가 주는 이점(라우트 리터럴 기반 `params` 타이핑)이 없으니 `searchParams` 타입을 직접 적는 편이 낫다.
>
> ```ts
> type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;
> ```
>
> 검증도 CI와 같은 조건으로 해야 한다 — `rm -rf .next && tsc --noEmit`.

## 3. 세 가지 캐시 디렉티브 — 어느 것을 쓰는가

`'use cache'`는 함수/컴포넌트의 반환값을 캐시한다. **인자와 상위 스코프에서 캡처한 값이 캐시 키가 된다.** 변종이 셋이다.

| 디렉티브               | 저장 위치            | 공유 범위             | 언제                                            |
| ---------------------- | -------------------- | --------------------- | ----------------------------------------------- |
| `'use cache'`          | 인메모리(인스턴스별) | 전 사용자             | 결과가 **static shell에 들어가는** 경우         |
| `'use cache: remote'`  | 원격 캐시 핸들러     | 전 사용자·전 인스턴스 | 결과가 **요청 시점으로 밀리는** 경우            |
| `'use cache: private'` | 브라우저             | 그 사용자만           | 쿠키·헤더에 의존하는 결과에 수명을 주고 싶을 때 |

판단 기준은 하나다. **그 캐시 호출이 request-time 데이터 뒤에 있는가?**

- **앞에 있다** (프리렌더 때 실행 가능) → `'use cache'`. 결과가 static shell에 실려 CDN까지 간다.
- **뒤에 있다** (`searchParams`를 읽은 다음 호출) → static shell에 못 들어간다. 매 요청 실행되며 캐시를 조회하는데, 인메모리는 **서버리스에서 인스턴스 간 공유가 안 되고 요청 후 대체로 파괴된다.** 적중률이 낮아 캐시가 사실상 없는 것과 같다. 이때 `remote`를 고려한다.

문서가 remote를 정당화하는 조건과 피해야 할 조건을 같이 준다.

**맞을 때**: 상류가 rate limit이 있다 / DB가 트래픽에 병목이다 / 조회가 비싸다 / 외부 서비스가 불안정하다.
**안 맞을 때**: 조회가 이미 빠르다(<50ms) / **캐시 키가 요청마다 거의 유일하다**(자유 텍스트 검색, 가격 범위 등) / 데이터가 초·분 단위로 바뀐다.

키 공간 설계가 곧 적중률이다. 페이지 번호·닫힌 enum 필터처럼 **조합이 유한하고 작으면** 적중률이 높다. 자유 입력을 그대로 키에 넣으면 캐시 항목만 늘고 적중은 0에 가까워진다.

마지막 제약 하나: **캐시된 함수는 `cookies()`·`headers()`·`searchParams`를 직접 읽을 수 없다.** 바깥에서 값을 꺼내 **인자로 넘긴다**. 그 인자가 캐시 키가 되므로 이 제약은 사실 안전장치다 — 읽을 수 있게 하면 키에 반영되지 않은 입력으로 캐시가 오염된다.

## 4. 무효화 — 경로에서 태그로

선행 문서 §4의 `revalidatePath(PATH)`는 **경로 하나**를 지목한다. 쿼리 파라미터가 붙으면 이게 무력해진다.

```
캐시 항목:  page=1 / page=2 / page=3 / type=public&page=1 / ...
revalidatePath('/list') → 이 조합들을 지목할 방법이 없다
```

`cacheTag`로 이름표를 붙이면 조합 수와 무관하게 한 번에 무효화된다.

```ts
async function fetchPage(page: number) {
  'use cache: remote';
  cacheLife('hours');
  cacheTag('items'); // 모든 조합에 같은 이름표
  return db.query(...);
}

// 데이터를 쓰는 쪽
revalidateTag('items', { expire: 0 });
```

무효화 API가 셋이고 **의미가 다르다.** 잘못 고르면 조용히 낡은 화면이 나간다.

| API                               | 호출 가능 위치               | 다음 요청의 동작                           |
| --------------------------------- | ---------------------------- | ------------------------------------------ |
| `updateTag(tag)`                  | **Server Action 전용**       | 즉시 만료. 새 데이터를 기다린다            |
| `revalidateTag(tag, 'max')`       | Server Action, Route Handler | **낡은 내용을 내보내고** 뒤에서 갱신 (SWR) |
| `revalidateTag(tag, {expire: 0})` | 위와 동일                    | 즉시 만료. 새 데이터를 기다린다            |

선택 기준:

- **사용자가 자기 변경을 즉시 봐야 한다**(read-your-own-writes) → Server Action이면 `updateTag`.
- **웹훅·크론처럼 Server Action이 아닌 곳에서 왔고, 그래도 즉시 반영이어야 한다** → `revalidateTag(tag, { expire: 0 })`. 문서가 이 경우를 명시적으로 이 형태로 안내한다.
- **약간 낡아도 되는 콘텐츠**(블로그, 카탈로그) → `'max'`. 권장값이지만 **"권장"에 끌려 기본 선택하지 말 것.** 알림을 보내고 그 알림의 대상을 보여주는 화면이라면, 첫 방문자에게 정작 그 항목이 빠진 목록을 보여주게 된다.

두 가지 주의:

- **`revalidateTag(tag)` 단일 인자 호출은 deprecated다.** 현재는 `{ expire: 0 }`처럼 동작하지만 제거 예고가 있다. 두 번째 인자를 항상 넘긴다.
- **태그 문자열은 상수로 공유한다.** 선행 문서의 경로 문자열과 같은 이유다 — 어긋나도 에러가 없고, 무효화가 아무것도 안 지울 뿐이다. 256자를 넘는 태그는 아예 할당되지 않아 무효화가 무동작이 된다.

그리고 **무효화는 호출 시점에 재렌더를 일으키지 않는다.** "낡음"만 표시하고, 실제 갱신은 그 태그를 쓰는 페이지에 **다음 방문이 왔을 때** 일어난다. 그래서 무효화 자체는 싸고, 선행 문서 §4의 "쓰기 완료 후 + 변경이 있을 때만" 규칙은 그대로 유지된다.

## 5. 세그먼트 설정과 비호환 — 마이그레이션의 첫 벽

`cacheComponents: true`를 켜면 **`export const dynamic`·`export const revalidate`가 빌드 에러가 된다.**

```
Route segment config "dynamic" is not compatible with `nextConfig.cacheComponents`.
Please remove it.
```

opt-out이 아니라 **금지**다. "이미 `force-dynamic`이니 영향 없겠지"는 정확히 반대 방향의 추정이다. 표현 방식이 대체된다.

| 기본 설정                                | Cache Components                           |
| ---------------------------------------- | ------------------------------------------ |
| `export const revalidate = N`            | `cacheLife(...)` (캐시된 함수 안에서)      |
| `export const dynamic = 'force-dynamic'` | **request-time 데이터에 접근하는 것 자체** |

두 번째가 처음엔 불안하다. "매 요청 실행"을 무엇이 보장하는가? 답은 **프리렌더가 중단되는 조건**이다. 문서가 목록을 준다 — 다음 중 하나에 닿으면 프리렌더가 그 지점에서 멈추고 요청 시점으로 넘어간다.

- 네트워크 요청, DB 쿼리, 비동기 파일시스템 접근
- `request.url` / `request.headers` / `request.cookies` / `request.body` 등 request 객체 속성
- `cookies()` / `headers()` / `connection()`
- 비결정적 연산(`Math.random()`, `Date.now()`, `crypto.randomUUID()`)

그래서 인증 헤더를 검사하는 크론 엔드포인트는 `force-dynamic`이 없어도 매 호출 실행된다 — **인증 검사가 곧 동적 실행 보장**이다. 반대로 `Math.random()`처럼 무심코 들어간 비결정적 연산도 프리렌더를 깨므로, 값을 공유하려면 캐시하고 요청마다 달라야 하면 `connection()` + Suspense를 쓴다.

GET Route Handler도 이 모델을 따른다. 캐시된 함수는 핸들러 본문에 직접 쓸 수 없고 **헬퍼로 빼야** 한다. POST 등 나머지 메서드는 애초에 캐시 대상이 아니다.

## 6. 함정 — 방어 코드의 근거가 프레임워크 동작에 매여 있을 때

선행 문서 §5는 "ISR 페이지는 빌드 중에 데이터 소스를 부른다"는 함정과, CI가 env 없이 빌드할 때를 위한 가드를 다뤘다.

```ts
const hasCredentials = Boolean(process.env.DB_URL && process.env.DB_KEY);
if (!hasCredentials) return EMPTY; // 빌드 환경에서만 기대되는 경로
```

**Cache Components로 옮기면 이 가드의 근거가 사라질 수 있다.** 조회가 `searchParams` 뒤로 내려가면 빌드 시점 프리렌더는 그 조회를 **아예 실행하지 않는다.** 빌드가 DB를 부르지 않으므로 자격 증명이 없어도 깨지지 않는다.

근거가 사라진 가드를 남겨두는 건 중립이 아니다. 자격 증명이 빠진 배포가 **에러 대신 "데이터 없음"으로 위장된다** — 선행 문서가 `try/catch` 뭉개기를 경계한 바로 그 실패 모드를, 이번엔 가드가 만든다.

일반화하면: **방어 코드의 정당성이 프레임워크 동작에 매여 있으면, 렌더링 모델을 바꿀 때 그 정당성을 재검증해야 한다.** 검증 방법은 코드 읽기가 아니라 실행이다.

```bash
DB_URL='' DB_KEY='' npx next build   # 가드가 실제로 타는지 로그로 확인
```

이 경우 **경고 로그가 찍히지 않는 것**이 "빌드가 조회를 부르지 않는다"의 증거였다. 제거 후 다시 같은 빌드를 돌려 CI 경로가 그대로 그린인지 확인한다.

## 7. 빌드 출력에 기호가 하나 늘어난다

```
Route (app)
┌ ○ /
├ ◐ /announcements
├ ƒ /api/cron/crawl
└ ◐ /subscribe

○  (Static)             prerendered as static content
◐  (Partial Prerender)  prerendered as static HTML with dynamic server-streamed content
ƒ  (Dynamic)            server-rendered on demand
```

- `◐`가 **의도한 결과**다 — shell은 정적이고 안쪽이 스트리밍된다.
- `searchParams`를 쓰는 페이지가 `ƒ`로 나오면 Suspense 경계가 없거나 위치가 너무 높다.
- `◐`를 기대했는데 `○`라면 안쪽이 실제로는 정적이라는 뜻이다(캐시 호출이 request-time 데이터 앞에 있는 경우).

선행 문서 §6과 같은 습관이다. **표를 확인하는 것만으로 "캐시가 걸렸다고 생각했는데 매 요청 렌더되고 있었다"를 조기에 잡는다.**

## 8. 동적 세그먼트(`params`)도 같은 규칙을 따른다

`searchParams`로 이 모델을 익히고 나면 다음 질문이 자연스럽게 온다. **`/posts/[id]` 같은 동적 세그먼트는?** 경로 값은 쿼리와 달리 "미리 알 수 있는 값"처럼 보이니 다르게 취급될 것 같다.

결론부터: **`params`도 promise이고, 같은 규칙이 그대로 적용된다.**

```tsx
// 페이지는 async가 아니다 — params를 await하지 않고 그대로 내려보낸다
export default function DetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main>
      <nav>{/* 정적 — shell에 남는다 */}</nav>
      <Suspense fallback={<Skeleton />}>
        <DetailView params={params} />
      </Suspense>
    </main>
  );
}

async function DetailView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; // 경계 안에서 읽는다
  const data = await fetchOne(id); // 'use cache: remote' + cacheTag
  ...
}
```

빌드 출력에서 `◐`가 나오면 성립한 것이다. 동적 세그먼트는 한 줄이 더 붙는다.

```
├ ◐ /announcements/[boardId]
│ └ /announcements/[boardId]
```

### `generateStaticParams`가 필요한가

**대개 필요 없다.** 이 함수는 "빌드 시점에 어떤 id들을 미리 렌더할지" 목록을 주는 것이고, PPR의 static shell과는 별개의 최적화다. shell은 위 구조만으로 이미 정적이다.

판단 기준은 **집합이 얼마나 자주 바뀌는가**다.

- 문서 사이트처럼 id 집합이 배포 시점에 고정된다 → 프리렌더 이득이 있다
- 콘텐츠가 계속 추가된다 → 프리렌더 집합이 곧 낡고 결국 온디맨드로 떨어진다. 목록을 유지하는 비용만 남는다

후자라면 쓰지 않고 **캐시 디렉티브에 맡기는 편이 단순하다** — 첫 요청이 캐시를 채우고 이후는 적중한다.

### 경로 세그먼트는 문자열이므로 파싱이 곧 방어선이다

`searchParams`와 마찬가지로 경로도 누구나 바꿀 수 있다. 다만 처리가 다르다. 쿼리는 "모르는 값은 무시"(제약 없음으로 취급)가 자연스럽지만, **경로 세그먼트는 무시할 수 없다** — 그것이 곧 무엇을 보여줄지이므로 해석에 실패하면 404다.

숫자 id에서 `Number()`만 쓰면 새는 입력이 있다.

```ts
Number('12abc'); // NaN  — 걸린다
Number(' 12 '); // 12   — 샌다 (URL은 '%2012%20')
Number('1.2e1'); // 12   — 샌다
Number('0x0C'); // 12   — 샌다
```

URL에 있던 문자열과 다른 값으로 조회하게 되므로, **정규식으로 먼저 형태를 닫고 나서 변환한다.**

```ts
function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
```

`Number.isSafeInteger`까지 붙이는 이유는 자릿수가 아주 긴 입력이 정밀도를 잃고 엉뚱한 정수가 되는 것을 막기 위해서다. 그리고 이 검사는 **조회 계층보다 앞**에 둔다 — 리포지토리에 이상값을 넘겨 예외로 500이 나는 경로를 만들지 않는다.

### 캐시 태그를 id별로 나눌 것인가

id마다 태그를 두면(`post:${id}`) 정밀하게 무효화할 수 있다. 그러나 대가가 있다. **무효화하는 쪽 코드가 늘고, 태그 문자열이 어긋나면 조용히 실패한다**(무효화가 아무것도 지우지 않는다).

기준은 **개별 항목이 실제로 갱신되는가**다. 항목이 사실상 추가만 되고 수정되지 않는다면, 새 항목은 캐시 항목이 아직 없어 무효화할 대상 자체가 없다. 이 경우 목록과 태그를 공유하는 편이 단순하고 정확하다 — 약간 과하게 버릴 뿐이며, `cacheLife`가 상한을 잡는다. 항목별 수정이 잦아지면 그때 나눈다.

## 9. 마이그레이션은 추정하지 말고 플래그를 켜고 빌드한다

전역 플래그는 파급 범위를 코드 읽기로 추정하기 쉽다. 그리고 틀리기 쉽다. 실제로 두 가지가 틀렸고 **둘 다 빌드 한 번으로 드러났다** — `force-dynamic`이 opt-out이라는 추정(§5), 자격 증명 가드가 여전히 필요하다는 추정(§6).

빌드는 에러를 **한 번에 다 주지 않는다.** 세그먼트 설정 4건이 먼저 나오고, 그걸 고치면 프리렌더 단계에서 페이지 하나가 걸리고, 그걸 고치면 다음 페이지가 걸린다. 그러니 "빌드 → 수습 → 빌드"를 **끝까지 반복하는 것**이 절차다. 첫 에러 목록을 전체 범위로 착각하면 안 된다.

순서를 이렇게 두면 값이 싸다.

1. 플래그만 켜고 빌드 → 세그먼트 설정 충돌 관측
2. 수습 → 다시 빌드 → 프리렌더 위반 라우트 관측
3. 수습 → 다시 빌드 → Route 표로 의도 확인
4. 그 다음에 새 기능(페이지네이션 등) 코드를 얹는다

## 10. 테스트 — 바뀐 것은 모킹 대상뿐이다

선행 문서 §7의 원칙은 그대로다. `next/cache`를 모듈째 모킹하고, **캐시가 실제로 지워졌는가**가 아니라 **호출 조건과 순서**를 검증한다.

```ts
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

expect(revalidateTag).toHaveBeenCalledWith('items', { expire: 0 });
expect(revalidateTag).not.toHaveBeenCalled(); // 변경 0건 / 쓰기 실패 시
```

두 번째 인자까지 단정에 넣는 게 중요하다. `'max'`로 바뀌면 **테스트가 통과하는 채로** 낡은 화면이 나가기 시작한다 — 인자를 검증하지 않으면 그 회귀를 잡을 지점이 없다.

---

## 정리

- `searchParams`는 request-time API다. 기본 설정에서 읽으면 **라우트 전체가 동적**이 되고, 조회가 `fetch`가 아니면 Data Cache 폴백도 없다.
- Cache Components는 판정을 **트리 단위**로 내린다. 실무 규칙은 하나 — **페이지를 async로 만들지 말고 promise를 Suspense 아래로 내려보낸다.** await를 아래로 미룰수록 정적으로 남는 부분이 커진다.
- 캐시 디렉티브는 **그 호출이 request-time 데이터 뒤에 있는가**로 고른다. 뒤에 있으면 인메모리는 서버리스에서 적중하지 않으므로 `remote`를 고려한다. 캐시 키 공간이 작아야 적중률이 산다.
- 쿼리 조합이 있으면 **경로 무효화는 무력하다.** `cacheTag` + `revalidateTag(tag, ...)`로 옮긴다. 두 번째 인자가 의미를 바꾸고, 단일 인자 호출은 deprecated다. `'max'`는 권장값이지만 **낡은 내용을 내보낸다** — 알림과 연동된 화면에는 `{ expire: 0 }`.
- `dynamic`·`revalidate` 세그먼트 설정은 **금지**된다. 동적 실행은 request-time 접근이, 캐시 수명은 `cacheLife`가 대신한다.
- **동적 세그먼트(`params`)도 같은 규칙이다.** 경로 값이라고 특별 취급되지 않는다. `generateStaticParams`는 PPR shell과 무관한 별개 최적화이므로, id 집합이 계속 늘어나면 쓰지 않는 편이 단순하다. 경로 세그먼트는 무시할 수 없으니 파싱 실패는 404이고, `Number()` 앞에 정규식을 둬야 `' 12 '`·`'1.2e1'` 같은 입력이 새지 않는다.
- **방어 코드의 근거가 프레임워크 동작에 매여 있으면 모델 전환 때 재검증한다.** 근거가 사라진 가드는 장애를 "데이터 없음"으로 위장한다.
- 파급 범위는 추정하지 말고 **플래그를 켜고 빌드를 끝까지 반복한다.** 에러는 단계별로 나온다.
