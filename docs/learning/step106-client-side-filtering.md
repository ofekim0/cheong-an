# 소량·주기 갱신 데이터의 필터링 — 서버 왕복을 없애는 세 조각

필터·페이지네이션이 있는 목록 페이지에서 "클릭이 느리다"는 체감은 대개 **클릭마다 서버 왕복이 필요한 구조**에서 온다. 데이터가 작고(수백 건) 갱신이 주기적(시간 단위)이라면 그 왕복 자체를 없앨 수 있다. #106에서 목록 페이지를 전환하며 확인한, **다른 프로젝트에도 가져갈 보편 패턴**을 추린다. 청안 고유 판단(선택지 비교, 성장 트리거 수치, 배제한 접근)은 `docs/adr/015-list-data-delivery-model.md` 소관이다.

기준 버전: Next.js 16.2.1 (App Router, Turbopack), `cacheComponents: true`.

선행 문서: [`step83-cache-components.md`](./step83-cache-components.md) — Cache Components의 트리 단위 판정과 `'use cache'` 변종. 이 문서는 그 §3의 "request-time 데이터 **앞**에 있다" 분기를 끝까지 밀어붙인 결과다.

---

## 1. 진단 — 체감 지연은 세 겹으로 쌓인다

"느리다"를 분해하면 원인이 셋으로 갈린다. 각각 다른 처방이 있고, 하나만 고치면 나머지가 남는다.

| 겹          | 증상                     | 원인                                                                                                                                   |
| ----------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 피드백 부재 | 클릭했는데 화면이 그대로 | 선택 상태(어느 칩이 활성인가)가 서버 렌더 결과에 있다. React transition은 응답이 올 때까지 기존 화면을 유지한다                        |
| 왕복 필수   | 매 클릭마다 네트워크     | 데이터가 `searchParams` 뒤에 있어 요청 시점에만 렌더된다. prefetch는 static shell만 미리 받으므로 같은 라우트의 쿼리 변경에는 무력하다 |
| 왕복이 길다 | 히트여도 수백 ms         | 브라우저 → 함수 → 캐시 저장소 → 회신. 콜드면 DB까지                                                                                    |

첫 겹만 고치는 것(낙관적 UI, pending 표시)은 기다림을 **보이게** 할 뿐 없애지 않는다. 둘째 겹을 없애면 첫째·셋째가 함께 사라진다. 그래서 질문은 "어떻게 빨리 응답하나"가 아니라 **"왜 서버가 잘라 줘야 하나"**다.

## 2. 조각 1 — request-time 값을 서버에서 읽지 않는다

Cache Components에서 `'use cache'` 함수의 결과가 static shell에 들어가는 조건은 **그 호출이 `searchParams`·`cookies()`·`headers()` 같은 request-time 값 앞에 있는 것**이다(선행 문서 §3). 목록 페이지가 `searchParams`를 읽는 이유는 오직 "어느 부분을 보여줄지" 결정하기 위해서다. 그 결정을 브라우저로 넘기면 서버는 request-time 값을 읽을 필요가 없어지고, 전량 조회가 shell에 실린다.

```tsx
// page.tsx — searchParams prop 자체를 받지 않는다
async function fetchAll() {
  'use cache';
  cacheLife('hours');
  cacheTag(TAG);
  return repository.listAll(adminClient());
}

export default async function Page() {
  const items = await fetchAll(); // 프리렌더 때 실행, 결과는 빌드 산출물
  return (
    <Suspense fallback={<Skeleton />}>
      <List items={items} />
    </Suspense>
  );
}
```

빌드 출력에서 확인할 것은 라우트 기호다. `◐`(Partial Prerender)였던 페이지가 `○`(Static)이 되면 shell에 데이터까지 들어간 것이다. Revalidate 열에 `cacheLife`가 준 수명이 찍힌다.

`remote`를 쓰지 않는 이유는 선행 문서 §3의 판단 기준 그대로다 — 앞에 있으니 결과가 CDN까지 간다. 인메모리 공유 문제가 성립하지 않는다.

**태그 무효화는 그대로 동작한다.** 쓰기 경로가 `revalidateTag(tag, { expire: 0 })`를 호출하면 다음 요청에서 shell이 재생성된다. 항목이 여러 개에서 하나로 줄었을 뿐 무효화 코드는 무변경이다.

## 3. 조각 2 — 브라우저가 URL을 읽어 고른다

`useSearchParams`를 쓰는 클라이언트 컴포넌트가 props로 받은 전량에서 필터·페이지를 계산한다.

```tsx
'use client';
export function List({ items }: { items: readonly Item[] }) {
  const searchParams = useSearchParams();
  const { page, filters } = parseQuery(searchParams); // 순수 함수
  const view = select(items, { page, pageSize, filters }); // 순수 함수
  return <>{/* 필터 바 · 건수 · 카드 · 페이지네이션 */}</>;
}
```

세 가지가 중요하다.

**컴포넌트에 분기를 두지 않는다.** 파싱(화이트리스트, 중복 키는 첫 값, 잘못된 page는 1)과 선택(AND 필터, 범위 밖 page는 빈 배열, 0건도 1페이지)은 `lib`의 순수 함수로 빼서 유닛 테스트를 붙인다. 컴포넌트 테스트 도구 없이도 분기가 전부 덮인다. 데이터 공급원이 바뀌어도(전량 임베드 → 청크 지연 로드) 이 함수들은 그대로 쓰인다.

**파싱 규칙을 두 벌 만들지 않는다.** 서버가 `searchParams`를 읽던 시절의 파서가 있다면 입력 어댑터 하나(`URLSearchParams` → 같은 레코드 모양, 중복 키는 배열)만 얹어 재사용한다. 서버에서 읽든 브라우저에서 읽든 같은 URL은 같은 결과를 내야 한다.

**`useSearchParams`는 Suspense 경계를 요구한다.** Cache Components 빌드가 이를 검사한다. 프리렌더 시 이 하위 트리는 클라이언트 렌더로 빠져 shell에는 fallback이 실리고, 하이드레이션 직후 URL대로 그려진다. 데이터는 이미 페이로드에 있어 서버 왕복은 없지만, **쿼리가 있는 URL로 직접 진입하면 자리표시자가 한 프레임 보인다.** 이 한 프레임은 구조의 대가다. 서버가 URL을 모르는데 URL대로 그릴 수는 없다.

## 4. 조각 3 — 링크는 `href`를 남기고 `pushState`로 URL만 바꾼다

`Link`의 기본 네비게이션에 맡기면 같은 라우트의 쿼리 변경에도 라우터가 RSC 페이로드를 다시 요청할 수 있다. 서버 요청 0을 **보장**하는 것은 Next가 공식 지원하는 shallow routing이다 — `window.history.pushState`를 직접 호출하면 라우터가 감지해 `useSearchParams`를 갱신한다.

```tsx
'use client';
export function ShallowLink({ href, ...rest }: Props) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainLeftClick(e)) return; // 수정키·가운데 클릭은 브라우저에 맡긴다
    e.preventDefault();
    window.history.pushState(null, '', href);
  };
  return <Link href={href} prefetch={false} onClick={onClick} {...rest} />;
}
```

**`<button>`으로 바꾸지 않는 이유**가 이 조각의 핵심이다. `href`가 남아 있으면 JS가 꺼져도 전체 로드로 동작하고, 새 탭 열기·링크 복사·뒤로 가기가 브라우저 기본 동작으로 유지된다. 그래서 수정키(⌘·Ctrl·Shift·Alt)나 가운데 클릭은 가로채지 않는다 — 그건 사용자가 "다른 곳에 열겠다"고 말한 것이다. URL이 상태라는 원칙은 그대로고, 바뀐 것은 그 URL로 가는 방법만이다.

`prefetch={false}`는 같은 라우트라 얻을 것이 없기 때문이다. 마우스를 올릴 때마다 나가는 빈 요청만 줄인다.

페이지네이션은 이동 후 맨 위로 스크롤하고 필터 바는 하지 않는다. `pushState`는 스크롤을 건드리지 않으므로 필요한 곳에서만 직접 올린다.

## 5. 검증 — 요청이 0건인지 직접 센다

"빨라졌다"는 느낌이 아니라 **네트워크 요청 수**로 확인한다. Playwright에서 `page.on('request')`로 document·fetch·xhr을 모으고, 필터·페이지 클릭 뒤 그 배열이 비어 있는지 단언한다. 정적 자산과 dev 서버의 websocket은 제외한다. 같은 방식으로 뒤로 가기, 쿼리 있는 URL 직접 진입, 수정키 클릭(새 탭이 열리고 원 탭은 그대로)을 함께 본다.

DevTools에서는 Network 탭 필터를 `_rsc`로 두고 클릭해 보면 된다. 한 건이라도 뜨면 어딘가 `Link` 기본 동작이 살아 있다.

## 6. 함정 — 빌드가 DB를 읽게 되면 모든 빌드 환경에 자격 증명이 필요하다

조각 1의 직접적 결과다. 조회가 `searchParams` 뒤에 있던 시절에는 빌드가 DB를 부르지 않았으므로 env 없는 빌드가 통과했다. 앞으로 옮기면 **빌드가 실행되는 모든 곳**이 DB에 닿아야 한다.

- **CI**: 빌드 단계에 자격 증명을 주입한다. 테스트용 프로젝트를 쓴다.
- **호스팅 Preview 배포**: 잊기 쉬운 곳이다. Vercel은 환경 변수를 Production/Preview/Development로 나눠 적용하므로, Production에만 등록된 변수는 PR 배포 빌드에 없다. 첫 PR 배포가 여기서 깨졌다.
- **폴백을 두지 않는다.** env 부재 시 빈 목록으로 렌더하는 가드는 자격 증명이 빠진 배포를 에러 대신 "데이터 없음"으로 위장한다(선행 문서 §6). 빌드가 실패하는 쪽이 낫다.

Preview에 프로덕션 자격 증명을 넣으면 편하지만 PR 브랜치가 프로덕션 전권 키를 갖게 된다. **프로덕션 배포가 아닌 모든 자동 실행(CI·E2E·Preview)은 테스트 프로젝트를 쓴다**는 한 줄 규칙이 판단을 대신한다. 이때 서버용 변수만 바꾸고 `NEXT_PUBLIC_*`(브라우저·세션 클라이언트)을 프로덕션에 두면 한 화면이 두 DB에 걸치므로 묶음 전체를 같은 프로젝트로 맞춘다.

## 7. 어디까지 유효한가 — 데이터 크기와 UX를 분리하는 상한

이 패턴은 **데이터 크기가 곧 첫 로드 크기**가 되는 구조다. 그래서 상한을 숫자로 정해두고, 넘으면 다음 단계(최근 N건만 임베드 + 과거 청크 지연 로드)로 간다. 상한이 없으면 "언제 바꾸나"가 판단이 되고, 있으면 측정이 된다. 어디에 두는지는 프로젝트마다 다르다(청안은 ADR 015). 중요한 것은 조각 2·3(순수 함수, shallow link)이 다음 단계에서도 그대로 쓰이도록 짜두는 것 — 그러면 미루는 대가가 "다시 짠다"가 아니라 "한 층 얹는다"가 된다.

---

## 정리

- 체감 지연은 **피드백 부재 · 왕복 필수 · 긴 왕복** 세 겹이다. 둘째를 없애면 나머지가 따라 사라진다. 낙관적 UI만 얹는 것은 기다림을 보이게 할 뿐이다.
- `'use cache'` 결과를 shell에 넣는 조건은 **request-time 값 앞에 있는 것**이다. "어느 부분을 보여줄지"를 브라우저로 넘기면 서버는 `searchParams`를 읽을 이유가 없다. 빌드 기호 `◐` → `○`로 확인한다.
- 파싱·선택은 **순수 함수**로 빼서 테스트한다. 컴포넌트에는 분기를 두지 않는다. 데이터 공급원이 바뀌어도 이 함수는 남는다.
- 링크는 **`href` 유지 + `pushState`**. `<button>`은 JS 없는 동작·새 탭·링크 복사를 잃는다. 수정키 클릭은 가로채지 않는다.
- "빨라졌다"는 **요청 0건**으로 센다.
- 빌드가 DB를 읽으면 **CI와 호스팅 Preview 모두**에 자격 증명이 필요하다. 폴백 대신 실패를 택하고, 프로덕션 아닌 곳은 테스트 프로젝트를 쓴다.
- 첫 로드 크기 **상한을 숫자로** 정해둔다. 다음 단계는 판단이 아니라 측정으로 시작한다.
