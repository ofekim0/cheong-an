# Step 6. 데이터 소스 재설계 — JSON API + view.do 하이브리드

> 관련: [ADR 002 — 크롤링 데이터 소스 전략](../adr/002-crawling-data-source.md), epic [#19](https://github.com/ofekim0/cheong-an/issues/19)
> 선행: [step4-crawling.md](./step4-crawling.md), [step5-service-layer.md](./step5-service-layer.md), [step5-msw-testing.md](./step5-msw-testing.md)

Step 4~5에서 만든 메인 페이지 HTML 파싱 기반 파이프라인을 **데이터 소스 자체부터 다시 설계**한 작업의 학습 박제. 사이트의 진짜 데이터 흐름을 추적하면서 배운 것들, 새로 도입한 패턴, 그리고 의사결정 과정을 정리한다.

## 1. 작업 요약

| 파일                                              | 작업   | 목적                                                      |
| ------------------------------------------------- | ------ | --------------------------------------------------------- |
| `docs/adr/002-crawling-data-source.md`            | 생성   | 데이터 소스 옵션 비교 + 옵션 C(하이브리드) 결정 박제      |
| `src/lib/crawler/parseListJson.ts`                | 생성   | JSON 목록 응답 → `AnnouncementListItem[]` 변환            |
| `src/lib/crawler/fetchJsonText.ts`                | 생성   | POST + `application/x-www-form-urlencoded` JSON 호출 래퍼 |
| `src/lib/crawler/isViewErrorPage.ts`              | 생성   | view.do 빈 번호 응답(633B HTML) 판별                      |
| `src/lib/crawler/announcementService.ts`          | 재작성 | JSON 본진 + gap에 한해 view.do 보강                       |
| `src/lib/crawler/fetchHtml.ts`                    | 수정   | `headers` 옵션 추가 (view.do Referer 주입용)              |
| `src/lib/crawler/__fixtures__/listJson.json`      | 생성   | 2026-05-20 실 응답 박제 (65KB)                            |
| `src/lib/crawler/__fixtures__/viewErrorPage.html` | 생성   | 633B 빈 번호 에러 응답 박제                               |
| `src/lib/crawler/__fixtures__/detailPage.html`    | 교체   | 가짜 시드 HTML → 실 응답(boardId 6539) 박제               |
| `src/lib/crawler/parseMainPage.ts` 등             | 삭제   | 메인 페이지 HTML 파서 전체 폐기                           |

**결과**: 사이트가 실제로 사용하는 JSON API를 1차 데이터 소스로, JSON 페이지 한계로 누락될 수 있는 boardId만 view.do로 한 건씩 확인하는 보강 구조로 재설계.

## 2. 왜 재설계가 필요했나 — 사이트 데이터 흐름 재발견

Step 4의 `parseMainPage`는 청년안심주택 메인(`main.do`)의 `ul.mainBoard_list`를 cheerio로 파싱했다. 단위 테스트는 통과했고 fixture 기반 검증도 그린이었다. 하지만 실 사이트에서 동작시키면 추출되는 항목이 0이었다.

DevTools로 추적하면서 알게 된 것:

1. 페이지 로드 직후의 HTML에는 `ul.mainBoard_list`가 존재
2. 페이지 로드 후 JS가 그 `<ul>`을 비우고 별도 AJAX 호출 결과로 다시 채움
3. AJAX는 `bbsListJson.json`을 POST + form body로 호출
4. 우리 크롤러가 받는 HTML은 1번 시점의 빈 골격 — `<li>`가 0개

즉 사용자가 보는 데이터는 메인 HTML이 아니라 별도 JSON API의 응답이었고, 그 사실을 모른 채로 **HTML이 데이터의 원천이라고 가정**했던 게 실수였다. 단위 테스트가 그린이었던 이유는 fixture가 "PR #15 당시 사이트가 일시적으로 데이터를 HTML에 같이 보냈을 때 받아둔 응답"이거나(추정), 혹은 PR 작성자가 일부 손으로 작성한 HTML이었을 가능성.

학습:

- **fixture가 단위 테스트를 그린으로 만들었다는 사실은 "실 사이트와 호환된다"는 보장이 아니다.** fixture는 "그 시점의 응답"만 보장한다.
- **실 사이트에서 한 번이라도 직접 돌려보는 단계가 빠지면 안 된다.** 우리 경우는 `curl`로 직접 호출해 응답이 비어있다는 걸 확인하고서야 알았다.
- DevTools의 Network 탭을 살펴 **사용자가 실제로 보는 데이터가 어디서 오는지**를 추적하는 게 크롤러 설계의 1단계.

## 3. ADR 002 — 의사결정 박제

옵션 비교는 ADR 002에 자세히 적었지만, 학습 포인트만 짧게:

| 옵션 | 요지                                   | 채택 여부                        |
| ---- | -------------------------------------- | -------------------------------- |
| A    | 메인 HTML만 — 현 구조 유지             | ❌ 빈 응답으로 작동 불가         |
| B    | JSON API만                             | ❌ 페이징 한계로 보강 fetch 필요 |
| C    | JSON API(주) + view.do(보강)           | ✅ 채택                          |
| D    | Playwright로 브라우저 실행 후 DOM 수집 | ❌ 무거움, 실행 환경 의존        |

옵션 C의 핵심 트레이드오프:

- 장: 사용자가 보는 데이터와 정확히 같은 소스 + 누락 방지
- 단: 두 종류의 호출이 필요해 코드 복잡도가 늘어남

**ADR 작성 단계에서 얻은 메타 학습**: 옵션을 적어두면 후일 "왜 D를 선택 안 했지?"라는 의문이 들 때 다시 거슬러 올라가 검증할 수 있다. ADR이 없으면 시간이 지난 후 같은 옵션을 다시 검토하는 비효율이 생긴다.

## 4. JSON API 호출 — POST + form body

`bbsListJson.json`은 GET이 아니라 **POST**를 받고, body는 JSON이 아니라 **`application/x-www-form-urlencoded`** 형태다. 한국 정부/공공 사이트의 AJAX 컨벤션이다 (jQuery `$.ajax`의 기본 동작이 form 인코딩이라 그 자취로 보임).

```ts
// fetchJsonText.ts
const response = await fetchImpl(url, {
  method: 'POST',
  headers: {
    'User-Agent': userAgent,
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json,text/plain,*/*',
    ...headers,
  },
  body: new URLSearchParams(formData).toString(),
  signal: controller.signal,
});
```

학습 포인트:

- **`Content-Type: application/json`을 보내면 사이트가 4xx를 준다.** 처음엔 "POST + JSON body"로 호출해서 한참 헤맸다. 사이트가 기대하는 형식을 정확히 흉내내야 한다.
- **`URLSearchParams`**: Node 표준. `{ key: value }` → `key=value&key2=value2`. 손으로 `encodeURIComponent`하는 것보다 안전.
- **JSON임에도 `Accept: application/json,text/plain,*/*`를 보낸다.** 사이트가 가끔 `Content-Type: text/plain`으로 JSON 본문을 주기 때문에 좁게 잡으면 거부당한다.

분리 결정:

- `fetchHtml`은 GET + HTML 응답 전용
- `fetchJsonText`는 POST + form body + JSON 텍스트 응답 전용

두 모듈은 `HttpError`/`InvalidContentTypeError`/`TimeoutError`를 공유한다. 에러 타입은 한 곳(가장 낮은 파일)에 정의하고 import해서 재사용. 호출자(`retry` 모듈)가 "어느 fetch에서 왔는지"에 무관하게 같은 분기 로직을 쓸 수 있다.

## 5. HTTP 200 + 에러 본문 패턴 — 633B 가드

청년안심주택 사이트는 존재하지 않는 boardId를 view.do로 호출해도 **HTTP 200**을 준다. 응답 본문은 약 633바이트짜리 에러 안내 페이지다.

```html
<!DOCTYPE html>
<html>
  <head>
    <title>에러안내</title>
    ...
  </head>
  <body>
    <div>
      <p>게시글에 대한 정보가 없습니다.</p>
    </div>
  </body>
</html>
```

표준 RESTful 사고로는 "없는 자원 = 404"가 자연스럽지만, 한국 JSP 기반 사이트는 자주 200 + 에러 페이지로 응답한다. JSP가 try/catch로 에러를 잡아 에러 페이지로 forward하면 HTTP 상태는 200이 되기 때문.

이걸 어떻게 가를까:

```ts
// isViewErrorPage.ts
export function isViewErrorPage(html: string): boolean {
  if (!html) return false;
  return (
    html.includes('<title>에러안내</title>') ||
    html.includes('게시글에 대한 정보가 없습니다')
  );
}
```

본문 마커 두 개를 OR로 검사. 둘 다 한국어인데, 사이트가 영어로 응답하는 일은 없으므로 보수적으로 충분.

학습:

- **HTTP 상태 코드가 거짓말을 할 수 있다.** 표준을 따른다고 가정하지 말고 실 응답을 직접 확인해야 한다.
- **마커 기반 가드는 표준이 아닌 사이트와 협상하는 현실적 도구.** 사이트가 마커 문구를 바꾸면 가드가 깨지므로, fixture를 박제해두고 변경을 카나리로 감지한다.
- **bytes-level 정밀도**: 우리는 마커가 동시에 일치하는 비대상 페이지가 있을 가능성을 줄이려 두 마커를 모두 본문에 박제한 633B 응답을 fixture로 보관한다. 사이트가 마커 문구를 한 글자라도 바꾸면 단위 테스트가 빨갛게 변한다.

## 6. 어댑터 패턴 — 두 타입을 하나로

JSON 응답은 `AnnouncementListItem`(목록용 필드)을 주고, view.do 보강은 `AnnouncementDetail`(상세용 필드)을 준다. 두 결과를 한 배열에 담으려면 모양을 통일해야 한다.

```ts
// announcementService.ts
function detailToListItem(detail: AnnouncementDetail): AnnouncementListItem {
  return {
    boardId: detail.boardId,
    title: detail.title,
    announcementType: detail.announcementType,
    recruitmentType: detail.recruitmentType,
    agency: null, // HTML엔 명시 필드 없음
    postDate: detail.postDate,
    applicationStartDate: detail.applicationStartDate,
    applicationEndDate: detail.applicationEndDate,
    attachmentId: extractAttachmentId(detail.attachmentUrl),
    rawContent: detail.rawContent,
  };
}

function extractAttachmentId(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/[?&]atchFileId=([^&]+)/);
  return match ? match[1] : null;
}
```

**디자인 패턴 이름**: 어댑터 패턴(adapter pattern). 인터페이스가 다른 두 객체 사이에 끼어들어 한쪽 모양을 다른 쪽 모양으로 변환해주는 함수/클래스. 어댑터는 **새 정보를 만들지 않고 모양만 바꾼다** (있는 건 매핑, 없는 건 null).

학습:

- **어댑터는 손실을 명시적으로 받아들이는 자리.** `agency: null`이 그 예 — HTML에는 일관된 위치가 없어 null로 두는 결정을 코드에 박제. 미래에 누가 "agency가 왜 null이지?"라고 물으면 이 자리에서 답을 찾는다.
- **두 타입 중 어느 쪽으로 통일할지의 결정**: 더 자주 쓰이는 타입(JSON 응답 = 매 사이클의 주 흐름)으로 통일하고 보강 결과를 변환. 반대로 했다면 매번 detail로 부풀려야 해서 손실이 더 컸을 것.
- **변환의 비대칭성**: ListItem → Detail은 불가능 (없는 정보를 만들 수 없음). Detail → ListItem만 가능. 어댑터는 항상 정보가 풍부한 쪽에서 빈약한 쪽으로 흐른다.

## 7. gap 계산 — JSON 페이징 한계 메우기

JSON API 응답은 페이지 1만 받는다 (보통 10~15건). 지난 사이클 끝 이후 새 공고가 그 페이지 크기를 넘어 등록되면 일부가 누락된다.

```ts
const observedIds = new Set(items.map((i) => i.boardId));
const latestBoardId = items.reduce(
  (max, item) => (item.boardId > max ? item.boardId : max),
  -Infinity,
);

const gap: number[] = [];
for (let id = lastBoardId + 1; id <= latestBoardId; id++) {
  if (!observedIds.has(id)) gap.push(id);
}
```

예: `lastBoardId = 100`, JSON = `[103, 100, 99, 98]` → `gap = [101, 102]`.

gap의 각 boardId에 대해 view.do를 한 건씩 호출:

```ts
for (const boardId of gap) {
  const html = await fetchViewWithPolicy(buildViewUrl(boardId));
  if (isViewErrorPage(html)) {
    skippedBoardIds.push(boardId); // 빈 번호
    continue;
  }
  const detail = parseDetailPage(html, boardId);
  newFromView.push(detailToListItem(detail)); // 진짜 누락분
}
```

학습:

- **이 알고리즘은 Step 4의 `findNewBoardIds`와 의도가 같다.** 다만 보강 대상 범위가 "메인 5건" → "JSON 한 페이지"로 바뀌었고, 빈 번호 판정도 404 캐치 → 마커 가드로 바뀌었다.
- **순차 루프인 이유**: `rateLimiter`가 호출 간격을 강제하므로 병렬로 던져도 큐에 줄을 선다. 순차가 의도를 코드 모양으로 그대로 드러낸다.
- **이론적 누락**: `latestBoardId` 이후로도 boardId가 더 있을 수 있지만, 그 영역은 다음 사이클의 JSON 페이지가 잡는다. 이 사이클의 책임은 "lastBoardId+1 ~ latestBoardId 사이의 누락 방지"로 한정.

## 8. 실 응답 fixture 박제 — byte-faithful 보존

PR D에서 `__fixtures__/detailPage.html`을 가짜 시드 HTML에서 실 응답(boardId 6539, 39KB)으로 통째로 교체했다. 이게 카나리(canary)로 작동한다.

전략:

- **`.prettierignore`에 `**/**fixtures**/**` 추가**해서 포매터가 손대지 못하게 함.
- **공백, 빈 줄, JSP 잔재까지 그대로 보존**. 가독성을 위해 정리하면 사이트가 응답을 바꿨는지 감지할 수 없다.
- **취득 경로 기록**: 우리 fixture는 `curl`로 직접 실 사이트에 호출해 받은 응답을 그대로 저장. 어디서 어떻게 얻었는지 PR 본문이나 ADR에 적어두면 미래에 재취득 가능.

카나리 효과:

- 사이트가 마크업을 한 글자라도 바꾸면 `parseDetailPage.test.ts`가 그것을 감지.
- 사이트가 633B 에러 페이지 문구를 바꾸면 `isViewErrorPage.test.ts`가 감지.
- 우리 단위 테스트의 신뢰도가 fixture의 진실성에 비례한다.

학습:

- **fixture는 데이터가 아니라 계약(contract).** "사이트는 이런 모양의 응답을 보낸다"는 우리 측 합의서. 합의서가 손으로 작성한 가짜라면 합의 자체가 없다.
- **fixture를 자주 갱신할수록 카나리 감도가 높아진다.** 분기별 한 번 정도 실 응답을 다시 받아 차이를 보는 게 좋다 (epic #19에서 이걸 안 했던 게 함정의 시작이었다).

## 9. MSW 동적 핸들러 — 시나리오마다 다른 분기

통합 테스트에서 시나리오마다 "어떤 boardId가 빈 번호인지"가 달라진다. 매번 핸들러를 길게 쓰는 대신 팩토리로 압축:

```ts
function viewHandler(errorIds: number[] = []) {
  const errorSet = new Set(errorIds);
  return http.get(VIEW_BASE, ({ request }) => {
    const boardId = Number(new URL(request.url).searchParams.get('boardId'));
    return htmlResponse(
      errorSet.has(boardId) ? viewErrorFixture : detailHtmlFixture,
    );
  });
}

// 사용
server.use(viewHandler([101])); // 101만 빈 번호, 나머지는 정상
server.use(viewHandler([])); // 모두 정상
server.use(viewHandler([101, 102, 103])); // 전부 빈 번호
```

학습:

- **테스트 의도가 코드 모양으로 드러남.** `viewHandler([101])`을 읽으면 "이 시나리오는 101이 빈 번호인 경우"라는 의도가 바로 보인다.
- **MSW는 `http.get`/`http.post`를 같이 등록 가능.** 우리 통합 테스트는 JSON 호출(`http.post`)과 view.do 호출(`http.get`)을 동시에 가로채야 한다.
- **fixture 재활용**: 통합 테스트가 단위 테스트와 **같은 fixture**를 읽어 쓴다. 두 레벨이 어긋날 수 없는 구조.

## 10. 한계와 다음 단계

- **첫 페이지 너머의 누락**: JSON API는 페이지를 더 받을 수 있지만(`pageIndex` 파라미터), 현재 코드는 페이지 1만 호출한다. `latestBoardId` 이후의 boardId는 다음 사이클 책임으로 미뤘다. 1시간 사이에 첫 페이지 크기(10~15건)를 초과하는 등록이 흔치 않다는 가정에 의존. 가정이 깨지면 페이징 도입 필요.
- **`agency` 손실**: view.do 보강 항목은 `agency`가 항상 null. JSON 항목은 채워져 있어 두 소스에서 온 결과의 정보 밀도가 다르다. 알림 메시지 형식이 agency를 의존하면 차이가 드러난다.
- **DB 미연동**: Sprint 1 잔여 ② (이슈 [#12](https://github.com/ofekim0/cheong-an/issues/12)).
- **스케줄링 미포함**: Sprint 1 잔여 ③ (이슈 [#13](https://github.com/ofekim0/cheong-an/issues/13)).

## 11. 메타 학습 — 이번 작업에서 얻은 것

- **사이트 데이터 흐름을 추적하는 게 크롤러 설계의 0단계.** HTML이 데이터의 원천이라고 가정하지 말고, DevTools Network 탭을 먼저 본다.
- **단위 테스트의 그린이 곧 실 사이트 호환을 의미하지 않는다.** fixture가 손으로 작성됐다면 더더욱.
- **표준 HTTP 상태에 대한 가정을 점검한다.** 한국 JSP 사이트는 200 + 에러 본문이 흔하다.
- **두 데이터 소스의 결과를 합칠 때 어댑터 패턴.** 한 쪽으로 모양을 통일하고, 손실되는 정보는 명시적으로 표기.
- **fixture는 카나리.** byte-faithful로 보존하고 포매터가 손대지 못하게 한다.
- **ADR로 옵션 비교를 박제하면 미래에 같은 의문이 다시 안 든다.**
