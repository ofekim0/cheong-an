# cheerio — Node에서 HTML 파싱

서버에서 HTML 문자열을 DOM처럼 탐색할 수 있게 해주는 라이브러리. 브라우저 없이 동작하고 jQuery API를 그대로 차용했다.

```
브라우저의 document.querySelector('li')  ←→  cheerio의 $('li')
```

## 1. 핵심 패턴: load → select → extract

cheerio 사용은 항상 이 세 단계를 따른다:

```ts
import * as cheerio from 'cheerio';

// 1. load: HTML 문자열을 cheerio에 넘겨서 탐색 가능한 객체($)를 만든다
const $ = cheerio.load('<ul><li class="item">Hello</li><li>World</li></ul>');

// 2. select: CSS 선택자로 원하는 요소를 찾는다
const $items = $('li'); // 모든 <li>
const $first = $('li.item'); // class="item"인 <li>

// 3. extract: 요소에서 데이터를 꺼낸다
$first.text(); // 'Hello'    — 텍스트 내용
$first.attr('class'); // 'item'     — 속성값
$items.length; // 2          — 매칭된 요소 개수
```

## 2. `$`는 무엇인가

`$`는 cheerio가 반환하는 **탐색 함수**다. jQuery 관례를 그대로 따른 것. `$('선택자')` 형태로 CSS 선택자를 넘기면 해당하는 HTML 요소들을 반환한다.

## 3. CSS 선택자 — 자주 쓰는 패턴

CSS 선택자는 프론트엔드에서 스타일링할 때 쓰는 그것과 동일하다.

| 선택자               | 의미                             |
| -------------------- | -------------------------------- |
| `ul.list-class`      | class가 `list-class`인 `<ul>`    |
| `ul.list > li`       | 위 ul의 **직계 자식** `<li>`만   |
| `a[href*="keyword"]` | href 속성에 "keyword"를 **포함** |
| `p.subject`          | class가 `subject`인 `<p>`        |
| `div#main`           | id가 `main`인 `<div>`            |
| `a:first-child`      | 부모의 첫 번째 자식인 `<a>`      |

## 4. 자주 쓰는 메서드

```ts
// 텍스트/속성 추출
$('p').text(); // 요소의 텍스트 내용
$('a').attr('href'); // href 속성값

// 순회 — each의 콜백에서 받은 raw element를 $()로 다시 감싸야 cheerio 메서드 사용 가능
$('li').each((index, element) => {
  const $el = $(element);
  $el.text();
});

// 하위 요소 탐색
$parent.find('a'); // $parent 안에서 <a>를 찾음
$parent.find('span.title'); // $parent 안에서 class="title"인 <span>

// 클래스 확인
$el.hasClass('active'); // class에 'active'가 있는지 boolean

// 첫 번째 요소
$('p').first(); // 여러 매칭 중 첫 번째만
```

## 5. 흔한 함정

- **`each` 콜백의 element는 raw DOM 객체**. 그 위에 `.find()` / `.text()`를 부르려면 반드시 `$(el)`로 한 번 더 감싸야 함
- **속성이 없으면 `attr()`이 `undefined` 반환** — `?? ''` 같은 기본값 처리 필수
- **`$('selector').text()`는 매칭 전체를 합친 문자열** — 여러 요소가 매칭되면 의도와 다를 수 있음. 첫 번째만 원하면 `$('selector').first().text()`
- **HTML이 깨져 있어도 cheerio는 best-effort로 파싱** — 에러 없이 빈 결과를 줄 수 있으니 길이 검증 필요

## 6. 대안과 비교

| 도구                     | 장점                     | 단점                            | 적합한 상황               |
| ------------------------ | ------------------------ | ------------------------------- | ------------------------- |
| **cheerio**              | 가볍고 빠름, jQuery 문법 | JS 실행 불가                    | SSR 페이지 파싱           |
| **Playwright/Puppeteer** | 브라우저 렌더링, JS 실행 | 무겁고 느림, 리소스 큼          | CSR 페이지, 인터랙션 필요 |
| **정규표현식**           | 의존성 없음              | HTML 파싱에 부적합, 깨지기 쉬움 | 단순 문자열 추출만        |

HTML 구조에 의존하는 작업이라면 정규식은 거의 항상 답이 아니다. 구조가 한 칸만 바뀌어도 패턴이 깨진다.
