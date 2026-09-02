# Next.js ISR — 정적 페이지를 데이터 변경 시점에 갱신하기

App Router의 ISR(Incremental Static Regeneration)은 "빌드 때 만든 HTML을 계속 쓰되, 정해진 조건에서만 다시 만드는" 렌더 전략이다. 공고 목록 페이지(#83 Step b)를 붙이며 확인한 **어느 프로젝트에나 가져갈 보편 패턴**을 추린다. 청안 고유 판단(조회를 service role로만 하는 이유, 페이지 분할 순서)은 #83 이슈 본문과 코드 주석 소관이다.

기준 버전: Next.js 16.2.1 (App Router, Turbopack). `cacheComponents`는 켜지 않은 기본 설정.

> **후속**: Step c-2에서 페이지네이션을 붙이며 `cacheComponents`로 전환했다. 이 문서의 §2(세그먼트 설정)·§5(빌드가 데이터 소스를 부른다)는 그 모델에서 성립하지 않는다 — [`step83-cache-components.md`](./step83-cache-components.md)와 `docs/adr/013-cache-components-rendering-model.md` 참조. 나머지(무효화 시점 규칙, 빌드 출력 확인, 테스트 전략)는 그대로 유효하다. 이 문서는 그 시점의 판단 기록으로 남긴다.

---

## 1. 멘탈 모델 — 렌더가 언제 일어나는가

정적/동적은 "서버 컴포넌트냐"가 아니라 **HTML을 만드는 시점**의 문제다.

```
동적 (SSR)      요청 ──▶ 매번 렌더 ──▶ HTML          느림, 항상 최신
정적 (SSG)      빌드 ──▶ 한 번 렌더 ──▶ HTML 재사용   빠름, 영영 그대로
ISR             빌드 ──▶ 렌더 ──▶ HTML 재사용
                          ▲              │
                          └── 조건 만족 시 다시 만듦
```

ISR은 SSG의 속도를 유지하면서 "다시 만드는 조건"만 붙인 것이다. 조건은 두 가지다.

| 방식      | 트리거                                 | 성격                                  |
| --------- | -------------------------------------- | ------------------------------------- |
| 시간 기반 | `export const revalidate = N` (초)     | 최대 N초까지는 낡아도 된다는 **상한** |
| 온디맨드  | `revalidatePath()` / `revalidateTag()` | 데이터가 바뀐 **그 순간** 무효화      |

## 2. 세그먼트 설정은 리터럴이어야 한다

```ts
// app/announcements/page.tsx
export const revalidate = 3600; // ✅
```

```ts
import { REVALIDATE_SECONDS } from '@/constants/announcements';
export const revalidate = REVALIDATE_SECONDS; // ❌ 동작하지 않는다
```

Next는 이 값을 **번들을 실행하지 않고 소스에서 정적 분석**해 읽는다. import한 식별자는 그 시점에 값을 알 수 없다. 같은 제약이 `dynamic`, `dynamicParams`, `fetchCache` 등 다른 세그먼트 설정에도 적용된다.

실무적으로는 "상수는 상수 파일로 뺀다"는 습관과 정면으로 부딪히므로, **왜 여기만 리터럴인지 주석으로 남기는 편이 낫다.** 상수 파일 쪽에도 "여기 두지 말 것"을 적어두면 다음 사람이 되돌리지 않는다.

## 3. 두 방식은 배타적이지 않다 — 같이 걸면 서로를 보완한다

각각의 약점이 정확히 반대다.

- **시간 기반만**: 데이터가 바뀌어도 최대 N초 낡은 화면이 나간다. 대신 아무 트리거도 필요 없다.
- **온디맨드만**: 즉시 반영되지만, **트리거가 실패하면 영원히 낡는다.** 배포 파이프라인·웹훅·크론이 조용히 죽으면 되돌릴 장치가 없다.

그래서 정상 경로는 온디맨드가 담당하고, 시간 기반은 **트리거가 실패했을 때의 상한**으로 둔다.

```ts
// 페이지: 안전망
export const revalidate = 3600;

// 데이터를 쓰는 쪽(Route Handler): 정상 경로
if (newItems.length > 0) {
  revalidatePath('/announcements');
}
```

이렇게 두면 "최악의 경우에도 1시간 뒤엔 맞다"가 보장되면서, 평소 반영은 즉시다.

## 4. 무효화 호출은 "쓰기가 끝난 뒤 + 조건부"

`revalidatePath`를 어디서 부르냐가 정확성을 좌우한다.

```ts
await saveToDb(newItems);        // 1. 저장
await updateCursor(latestId);    // 2. 상태 갱신
if (newItems.length > 0) {       // 3. 바뀐 게 있을 때만
  revalidatePath(PATH);          //    무효화
}
await sendNotifications(...);    // 4. 나머지 후속 작업
```

- **저장보다 먼저 부르면 안 된다.** 무효화 후 다음 요청이 재렌더하는데, 그 시점에 아직 저장이 안 끝났으면 **낡은 상태를 다시 읽어 캐시에 굳힌다.** 무효화는 "지금 읽으면 최신"이 참일 때 해야 한다.
- **느린 후속 작업 뒤로 미루면** 그만큼 반영이 늦는다. 위 예에서 발송이 30초 걸리면 웹 반영도 30초 밀린다.
- **바뀐 게 없으면 부르지 않는다.** 내용이 같은데 캐시를 버리면 다음 방문자가 전체 렌더 비용만 다시 문다. 주기 실행되는 잡에서는 이 경로가 대부분이라 차이가 크다.
- 무효화 자체는 프레임워크 내부 캐시 조작이라 네트워크 실패 요소가 없다. 외부 호출처럼 try/catch로 감싸 격리할 필요는 없다.

**경로 문자열은 상수로 뺀다.** 페이지가 있는 경로와 무효화 대상 경로가 어긋나면 에러 없이 조용히 실패한다 — 캐시가 안 지워질 뿐이라 테스트도 통과하고 로그도 안 남는다. 한 곳에서만 정의하는 게 유일한 방어다.

## 5. 함정: 정적 프리렌더는 빌드 시점에 데이터 소스를 부른다

가장 놓치기 쉬운 지점이다. ISR 페이지는 **빌드 중에 한 번 렌더된다.** 즉 `next build`가 DB·API를 실제로 호출한다.

이건 빌드에 런타임 의존성을 심는다:

```
로컬 빌드    .env.local 있음        → 성공
Vercel 빌드  env 주입돼 있음        → 성공
CI 빌드      env 없이 pnpm build    → 💥 "SUPABASE_URL is not set"
```

CI가 빌드를 품질 게이트로 돌리는 구성이라면, 페이지 하나 추가했을 뿐인데 **모든 PR이 빨개진다.** 그때까지 DB를 쓰던 코드가 전부 동적 라우트(요청 시에만 실행)였다면 빌드가 건드린 적이 없어서 더 갑작스럽다.

선택지는 셋이다.

1. **CI에 자격 증명을 준다** — 빌드가 실제 경로를 그대로 검증한다. 대신 빌드가 외부 서비스 가동 상태에 묶인다. 테스트 DB가 잠들면 빌드가 깨진다.
2. **자격 증명이 없을 때만 조회를 건너뛴다** — 빌드가 외부에 의존하지 않는다. 아래 형태.
3. **페이지를 동적으로 돌린다** — ISR을 포기하는 것이라 목적과 어긋난다.

2번을 쓸 때 중요한 건 **좁게 흡수하는 것**이다.

```ts
async function fetchData() {
  const hasCredentials = Boolean(process.env.DB_URL && process.env.DB_KEY);
  if (!hasCredentials) {
    console.warn('[page] 자격 증명 없음 — 빈 데이터로 렌더');
    return EMPTY; // 설정 부재만 흡수
  }
  return query(); // 조회 실패(네트워크·권한·쿼리)는 그대로 throw
}
```

`try { query() } catch { return EMPTY }`로 뭉뚱그리면 **DB 장애가 "데이터 없음"으로 위장된다.** 빈 화면이 정상처럼 배포되고 아무도 모른다. 흡수 대상은 "설정이 없다"는 환경 조건이지 "조회가 실패했다"는 런타임 사건이 아니다.

검증도 실제 조건으로 해야 한다. env 파일을 잠시 치우고 빌드를 돌려 **양쪽 경로를 다 확인**한다 — env 있을 때 실데이터로 프리렌더되는지, 없을 때 경고만 남기고 통과하는지.

## 6. 빌드 출력으로 의도를 확인한다

`next build`의 Route 표가 각 라우트의 렌더 방식을 그대로 보여준다.

```
Route (app)                   Revalidate  Expire
┌ ○ /
├ ○ /announcements                    1h      1y
├ ƒ /api/cron/crawl
└ ƒ /subscribe

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

- `○` + Revalidate 값이 있으면 ISR이 걸린 것이다. `revalidate`를 썼는데 `ƒ`로 나온다면 그 페이지 어딘가가 동적 API(쿠키·헤더·검색 파라미터 등)를 건드려 동적으로 승격된 것이다.
- Expire는 재생성 실패가 이어질 때 캐시를 완전히 버리는 상한이다.

**이 표를 확인하는 걸 습관으로 두면 "ISR을 걸었다고 생각했는데 매 요청 렌더되고 있었다"를 조기에 잡는다.**

## 7. 테스트 — `revalidatePath`는 모킹하고 "언제 부르는가"만 본다

`revalidatePath`는 Next 런타임 컨텍스트 안에서만 동작하고, 밖에서 호출하면 throw한다. 유닛 테스트에서는 모듈째 대체한다.

```ts
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
```

검증 대상은 **캐시가 실제로 지워졌는가**가 아니다. 그건 프레임워크 책임이고 유닛으로 확인할 수 없다. 우리가 소유한 건 **호출 조건과 순서**다.

```ts
expect(revalidatePath).toHaveBeenCalledWith('/announcements'); // 신규 있을 때
expect(revalidatePath).not.toHaveBeenCalled(); // 신규 0건일 때
expect(revalidatePath).not.toHaveBeenCalled(); // 저장 실패했을 때
```

순서 보장은 mock의 호출 순번으로 고정할 수 있다.

```ts
const saveOrder = vi.mocked(save).mock.invocationCallOrder[0];
const revalidateOrder = vi.mocked(revalidatePath).mock.invocationCallOrder[0];
expect(saveOrder).toBeLessThan(revalidateOrder);
```

§4에서 본 "저장 뒤에 무효화" 규칙은 코드를 읽으면 지켜지지만 리팩터 중에 쉽게 뒤집힌다. 순서를 테스트로 못 박아 두면 그 회귀가 리뷰 전에 잡힌다.

---

## 정리

- ISR = SSG 속도 + 갱신 조건. 조건은 시간 기반과 온디맨드 두 가지이고 **같이 거는 게 기본형**이다 — 온디맨드가 정상 경로, 시간 기반이 트리거 실패 시 상한.
- 세그먼트 설정(`revalidate` 등)은 정적 분석 대상이라 **리터럴이어야 한다.**
- 무효화는 **쓰기 완료 후, 변경이 있을 때만.** 경로 문자열은 상수로 공유한다 — 어긋나면 조용히 실패한다.
- ISR 페이지는 **빌드 중에 데이터 소스를 부른다.** 빌드 환경(CI)에 자격 증명이 없으면 빌드가 깨지므로, 설정 부재만 좁게 흡수하고 조회 실패는 그대로 표면화한다.
- 빌드 출력의 Route 표로 의도한 렌더 방식이 나왔는지 확인한다.
- 테스트는 `next/cache`를 모킹하고 **호출 조건과 순서**만 검증한다.
