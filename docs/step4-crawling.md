# Step 4: 크롤링 파이프라인 — 학습 정리

> Step 4에서 수행한 작업과, 각 작업이 의미하는 것을 정리한 문서.

---

## 목차

1. [수행한 작업 요약](#1-수행한-작업-요약)
2. [크롤링 기초 개념](#2-크롤링-기초-개념)
3. [cheerio 기초](#3-cheerio-기초)
4. [테스트 기초 (Vitest)](#4-테스트-기초-vitest)
5. [DB 기초 개념](#5-db-기초-개념)
6. [cheerio를 선택한 이유](#6-cheerio를-선택한-이유)
7. [크롤링 대상 사이트 분석](#7-크롤링-대상-사이트-분석)
8. [메인 페이지 파서 설계](#8-메인-페이지-파서-설계)
9. [상세 페이지 파서 설계](#9-상세-페이지-파서-설계)
10. [boardId 연속성 체크 알고리즘](#10-boardid-연속성-체크-알고리즘)
11. [HTML 스냅샷 기반 테스트 전략](#11-html-스냅샷-기반-테스트-전략)
12. [DB 스키마 설계 판단](#12-db-스키마-설계-판단)
13. [이 프로젝트에서 내린 판단들](#13-이-프로젝트에서-내린-판단들)

---

## 1. 수행한 작업 요약

| 파일                                                 | 작업 | 목적                                     |
| ---------------------------------------------------- | ---- | ---------------------------------------- |
| `src/types/announcement.ts`                          | 생성 | 공고 데이터 TypeScript 타입 정의         |
| `supabase/migrations/00001_create_announcements.sql` | 생성 | DB 스키마 (announcements, crawl_state)   |
| `src/lib/crawler/parseMainPage.ts`                   | 생성 | 메인 페이지에서 boardId, 제목, 날짜 추출 |
| `src/lib/crawler/parseDetailPage.ts`                 | 생성 | 상세 페이지에서 공고 전체 정보 추출      |
| `src/lib/crawler/checkBoardId.ts`                    | 생성 | 새 공고 감지 + 누락 방지 알고리즘        |
| `src/lib/crawler/__fixtures__/*.html`                | 생성 | 실제 사이트 기반 테스트용 HTML 스냅샷    |
| `src/lib/crawler/*.test.ts`                          | 생성 | 파서 및 boardId 로직 단위 테스트 (33개)  |

**결과**: 메인 페이지에서 최신 공고 목록을 추출하고, 상세 페이지에서 공고 정보를 파싱하며, boardId 비교로 새 공고를 감지하는 크롤링 파이프라인의 핵심 로직이 완성됨.

---

## 2. 크롤링 기초 개념

### 크롤링이란

웹 크롤링은 **프로그램이 사람 대신 웹 페이지에 접속해서 데이터를 수집하는 것**이다. 브라우저에서 직접 보고 복사하는 대신, 코드가 HTTP 요청을 보내고 응답으로 온 HTML에서 필요한 정보를 추출한다.

```
사람이 하는 일:
  브라우저 열기 → 사이트 접속 → 눈으로 읽고 → 복사/붙여넣기

크롤러가 하는 일:
  HTTP GET 요청 → HTML 응답 수신 → 파서로 데이터 추출 → DB에 저장
```

### 크롤링의 기본 흐름

```
1. 요청 (fetch)    — 대상 URL에 HTTP GET 요청을 보냄
2. 수신 (response) — 서버가 HTML 문자열을 응답으로 줌
3. 파싱 (parse)    — HTML에서 필요한 데이터를 추출
4. 저장 (store)    — 추출한 데이터를 DB 등에 저장
5. 반복 (loop)     — 주기적으로 1~4를 반복하여 변경사항 감지
```

이 프로젝트에서는 3번(파싱)을 먼저 만들었다. 1~2번(HTTP 요청)과 4번(DB 저장)은 서비스 레이어에서 추후 구현한다.

### SSR vs CSR이 크롤링에 미치는 영향

이 개념은 프론트엔드에서도 중요하지만, 크롤링에서는 **"HTTP 요청만으로 데이터를 받을 수 있는가"**에 직결된다.

| 렌더링 방식                        | HTML에 데이터가?                     | 크롤링 난이도                                              | 예시                  |
| ---------------------------------- | ------------------------------------ | ---------------------------------------------------------- | --------------------- |
| **SSR** (서버 사이드 렌더링)       | 있음                                 | 쉬움 — HTML만 받으면 됨                                    | 청안 메인/상세 페이지 |
| **CSR** (클라이언트 사이드 렌더링) | 없음 — JS가 실행돼야 데이터가 채워짐 | 어려움 — 브라우저 엔진이 필요하거나 API를 직접 호출해야 함 | 청안 리스트 페이지    |

```
SSR 페이지 크롤링:
  fetch(url) → 완전한 HTML → cheerio로 파싱 ✅

CSR 페이지 크롤링:
  fetch(url) → 빈 HTML (<div id="root"></div>) → 데이터 없음 ❌
  → 대안 1: Playwright로 브라우저를 띄워서 JS 실행 후 파싱 (무겁고 느림)
  → 대안 2: 브라우저 개발자 도구에서 API 엔드포인트를 찾아 직접 호출 (가능하면 이게 나음)
```

### 크롤링 시 알아야 할 주의사항

**robots.txt**: 사이트 루트에 있는 파일로, 크롤러의 접근 허용/차단 범위를 명시한다. 법적 강제력은 약하지만 지키는 것이 관례.

**요청 빈도 조절**: 짧은 시간에 대량 요청을 보내면 서버에 부하를 줄 수 있다. 이 프로젝트는 1시간 주기로 크롤링하므로 문제없다.

**사이트 구조 변경 리스크**: 크롤링은 사이트의 HTML 구조에 의존한다. 사이트가 리뉴얼되면 파서가 깨진다. 이를 감지하기 위해 HTML 스냅샷 기반 테스트를 사용한다.

---

## 3. cheerio 기초

### cheerio란

Node.js에서 **HTML 문자열을 DOM처럼 탐색**할 수 있게 해주는 라이브러리. 브라우저 없이 서버에서 동작한다. jQuery의 API를 그대로 차용했기 때문에, jQuery 문법을 알면 바로 쓸 수 있다.

```
브라우저의 document.querySelector('li')  ←→  cheerio의 $('li')
```

### 핵심 패턴: load → select → extract

cheerio 사용은 항상 이 세 단계를 따른다:

```ts
import * as cheerio from 'cheerio';

// 1. load: HTML 문자열을 cheerio에 넘겨서 탐색 가능한 객체($)를 만든다
const $ = cheerio.load('<ul><li class="item">Hello</li><li>World</li></ul>');

// 2. select: CSS 선택자로 원하는 요소를 찾는다
const $items = $('li'); // 모든 <li> 요소
const $first = $('li.item'); // class="item"인 <li>

// 3. extract: 요소에서 데이터를 꺼낸다
$first.text(); // 'Hello' — 텍스트 내용
$first.attr('class'); // 'item' — 속성값
$items.length; // 2 — 매칭된 요소 개수
```

### $는 무엇인가

`$`는 cheerio가 반환하는 **탐색 함수**다. jQuery에서 `$`를 쓰던 관례를 그대로 따른 것이다. `$('선택자')` 형태로 CSS 선택자를 넘기면, 해당하는 HTML 요소들을 찾아서 반환한다.

### CSS 선택자 — 이 프로젝트에서 쓰인 패턴들

CSS 선택자는 프론트엔드에서 스타일링할 때 쓰는 그 선택자와 동일하다:

| 선택자                   | 의미                                       | 프로젝트에서의 사용   |
| ------------------------ | ------------------------------------------ | --------------------- |
| `ul.mainBoard_list`      | class가 `mainBoard_list`인 `<ul>`          | 메인 페이지 공고 목록 |
| `ul.mainBoard_list > li` | 위 ul의 **직계 자식** `<li>`만             | 각 공고 항목          |
| `a[href*="boardId"]`     | href 속성에 "boardId"를 **포함**하는 `<a>` | 공고 링크             |
| `a[href*="fileDown.do"]` | href에 "fileDown.do"를 포함하는 `<a>`      | 첨부파일 링크         |
| `p.subject`              | class가 `subject`인 `<p>`                  | 공고 제목             |
| `span.title`             | class가 `title`인 `<span>`                 | 메타 정보 라벨        |

### 자주 쓰는 cheerio 메서드

```ts
// 텍스트 추출
$('p.subject').text(); // 요소의 텍스트 내용

// 속성 추출
$('a').attr('href'); // href 속성값

// 순회
$('li').each((index, element) => {
  const $el = $(element); // 각 요소를 다시 $()로 감싸야 cheerio 메서드 사용 가능
  $el.text();
});

// 하위 요소 찾기
$li.find('a'); // $li 안에서 <a>를 찾음
$li.find('span.txDate'); // $li 안에서 class="txDate"인 <span>을 찾음

// 클래스 확인
$li.hasClass('more_w'); // class에 'more_w'가 있는지 boolean 반환

// 첫 번째 요소만
$('p.subject').first(); // 여러 매칭 중 첫 번째만
```

### 실제 코드와 연결

```ts
// parseMainPage.ts에서:
$('ul.mainBoard_list > li').each((_, el) => {
  const $li = $(el);
  //        ↑ each의 콜백에서 받은 raw element를 $(el)로 감싸야
  //          .find(), .text() 등 cheerio 메서드를 쓸 수 있다

  if ($li.hasClass('more_w')) return; // "전체보기" 건너뛰기

  const href = $li.find('a').attr('href') ?? '';
  //          $li 안에서 <a>를 찾고 → href 속성을 가져옴
  //          ?? '' : href가 undefined이면 빈 문자열로 대체

  const boardIdMatch = href.match(/boardId=(\d+)/);
  //                   정규식으로 boardId=숫자 패턴을 찾음
  //                   (\d+)는 캡처 그룹 — 숫자 부분만 추출
});
```

---

## 4. 테스트 기초 (Vitest)

### 테스트를 왜 작성하는가

코드가 **의도대로 동작하는지 자동으로 확인**하기 위함이다. 수동으로 "실행해보고 눈으로 확인"하는 대신, 코드가 맞는지 검증하는 코드를 짜두면:

- 코드 수정 후 기존 기능이 깨지지 않았는지 즉시 확인할 수 있다
- CI에서 자동 실행되어, 깨진 코드가 머지되는 것을 방지한다
- 테스트 자체가 "이 함수가 뭘 하는지"에 대한 문서 역할을 한다

### 기본 구조: describe → it → expect

```ts
import { describe, it, expect } from 'vitest';

describe('parseMainPage', () => {
  // 테스트 그룹 — "무엇을 테스트하는가"
  it('최신 공고 5건을 추출한다', () => {
    // 개별 테스트 — "어떤 동작을 검증하는가"
    const results = parseMainPage(html);

    expect(results).toHaveLength(5); // 단언(assertion) — "결과가 기대와 같은가"
  });
});
```

| 키워드              | 역할                             | 비유              |
| ------------------- | -------------------------------- | ----------------- |
| `describe`          | 관련 테스트들을 묶는 그룹        | 시험지의 "대문항" |
| `it`                | 하나의 구체적 동작을 검증        | 시험지의 "소문항" |
| `expect(값).매처()` | 실제 값이 기대와 일치하는지 확인 | "정답 확인"       |

`it`은 `test`와 동일하다. `it('공고를 추출한다')` = `test('공고를 추출한다')`. 영어로 읽으면 "it extracts announcements"처럼 문장이 되므로 `it`을 더 많이 쓴다.

### 자주 쓰는 매처(matcher)

```ts
// 값 비교
expect(result).toBe(5); // === 비교 (원시값)
expect(result).toEqual([1, 2, 3]); // 깊은 비교 (객체, 배열)

// 포함 여부
expect(results).toHaveLength(5); // 배열 길이
expect(results).toContain(6485); // 배열에 특정 값 포함
expect(title).toContain('추가모집'); // 문자열에 특정 문구 포함
expect(results).not.toContain('전체보기'); // not — 포함하지 않음

// null/undefined
expect(result.complexName).toBeNull(); // null인지
expect(result.title).toBe(''); // 빈 문자열인지
```

### fixture 패턴

**fixture**는 테스트에서 사용할 **고정된 입력 데이터**다. 이 프로젝트에서는 실제 사이트의 HTML을 파일로 저장해서 쓴다:

```ts
// 파일에서 HTML을 읽어서 테스트 입력으로 사용
const fixtureHtml = readFileSync(
  join(__dirname, '__fixtures__', 'mainPage.html'),
  'utf-8',
);

it('최신 공고 5건을 추출한다', () => {
  const results = parseMainPage(fixtureHtml); // 실제 HTML로 테스트
  expect(results).toHaveLength(5);
});
```

왜 fixture를 쓰는가:

- **재현 가능**: 테스트할 때마다 실제 사이트에 접속하면 데이터가 바뀔 수 있다. fixture는 항상 같은 입력을 보장
- **오프라인 가능**: 네트워크 없이도 테스트 실행 가능
- **변경 감지**: 사이트 구조가 바뀌면 fixture를 업데이트하고, 테스트가 실패하면 파서를 수정

### 테스트 실행

```bash
pnpm test              # 모든 테스트를 1회 실행
pnpm test:watch        # 파일 변경 감시 + 자동 재실행 (개발 중 편리)
```

### 좋은 테스트의 특징

이 프로젝트의 테스트를 보면 패턴이 보인다:

```
1. 정상 동작 테스트 — "5건을 추출한다", "boardId를 정확히 추출한다"
2. 엣지 케이스 테스트 — "빈 HTML에서는 빈 배열을 반환한다"
3. 예외 처리 테스트 — "boardId가 없는 링크는 건너뛴다"
```

이 세 종류를 커버하면 기본적인 테스트로 충분하다.

---

## 5. DB 기초 개념

> 프론트엔드 개발자 관점에서, SQL 문법을 외우기보다 **"이게 왜 필요하고 어떤 역할인지"**를 이해하는 데 초점을 맞춘다.

### 마이그레이션(Migration)이란

DB 구조(테이블, 컬럼 등)를 **코드로 관리**하는 방식이다. SQL 파일을 작성해두면, 어떤 환경에서든 동일한 DB 구조를 재현할 수 있다.

```
프론트엔드 비유:
  package.json → pnpm install → 동일한 node_modules 재현
  migration.sql → supabase db push → 동일한 DB 구조 재현
```

왜 필요한가:

- DB 구조를 Git으로 버전 관리할 수 있다
- 팀원이나 CI에서 동일한 DB를 만들 수 있다
- "이 테이블이 언제, 왜 만들어졌는지" 이력이 남는다

파일명에 `00001_`같은 번호가 붙는 이유: 마이그레이션은 **순서대로** 실행되어야 하므로 번호로 순서를 보장한다.

### 테이블과 컬럼

```sql
CREATE TABLE announcements (
  id         BIGINT PRIMARY KEY,    -- 각 행을 구분하는 고유 식별자
  board_id   INTEGER NOT NULL,      -- 값이 반드시 있어야 함
  title      TEXT NOT NULL,
  district   TEXT,                   -- NULL 허용 (값이 없을 수 있음)
);
```

| SQL 개념    | 프론트엔드 비유                          | 설명                  |
| ----------- | ---------------------------------------- | --------------------- |
| 테이블      | TypeScript interface                     | 데이터의 구조를 정의  |
| 컬럼        | interface의 각 속성                      | 각 필드의 이름과 타입 |
| 행(row)     | 하나의 객체 `{}`                         | 실제 데이터 한 건     |
| `NOT NULL`  | 필수 속성 (`title: string`)              | 값이 반드시 있어야 함 |
| `NULL` 허용 | 옵셔널 속성 (`district: string \| null`) | 값이 없을 수 있음     |

### PRIMARY KEY

테이블의 각 행을 **유일하게 식별**하는 컬럼. 모든 테이블에 하나씩 있어야 한다.

```sql
id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
-- GENERATED ALWAYS AS IDENTITY: 새 행이 추가될 때마다 자동으로 1, 2, 3... 증가
-- 직접 id를 지정할 필요 없이 DB가 알아서 부여함
```

### UNIQUE 제약

```sql
board_id INTEGER NOT NULL UNIQUE
```

"이 컬럼의 값은 테이블 전체에서 중복될 수 없다." 크롤링에서 같은 공고를 두 번 저장하려고 하면 DB가 거부한다. 코드에서 중복 체크를 하지 않아도 **DB 레벨에서 안전장치**가 되는 것.

### INDEX (인덱스)

```sql
CREATE INDEX idx_announcements_board_id ON announcements (board_id);
CREATE INDEX idx_announcements_post_date ON announcements (post_date DESC);
```

인덱스는 **검색 속도를 높이기 위한 목차**다.

```
비유:
  인덱스 없음 = 책에서 특정 단어를 찾으려면 1페이지부터 끝까지 읽어야 함
  인덱스 있음 = 책 뒤의 색인(찾아보기)에서 바로 해당 페이지로 이동
```

자주 검색하는 컬럼에 인덱스를 건다. 이 프로젝트에서는:

- `board_id` — 크롤링 시 "이 공고가 이미 있는지" 조회
- `post_date DESC` — "최신 공고 순으로 보여줘" 조회
- `district` — "강남구 공고만 보여줘" 필터

### ENUM 타입

```sql
CREATE TYPE announcement_type AS ENUM ('public', 'private');
```

허용되는 값을 **DB 레벨에서 제한**한다. TypeScript의 유니온 타입(`'public' | 'private'`)과 같은 역할을 DB에서 하는 것.

`'pubilc'`(오타)을 넣으려고 하면 DB가 거부한다. 코드와 DB 양쪽에서 이중 안전장치.

### 트리거(Trigger)

```sql
CREATE TRIGGER announcements_updated_at
  BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

"특정 이벤트가 발생하면 자동으로 실행되는 함수." 여기서는 행이 수정(UPDATE)될 때마다 `updated_at` 컬럼을 자동으로 현재 시각으로 갱신한다.

```
프론트엔드 비유:
  DOM 이벤트 리스너: element.addEventListener('click', handler)
  DB 트리거: CREATE TRIGGER ... BEFORE UPDATE ... EXECUTE FUNCTION ...

  → "이벤트가 발생하면 자동으로 뭔가를 실행한다"는 개념은 동일
```

코드에서 매번 `updated_at = new Date()`를 넣을 필요 없이, DB가 알아서 처리한다.

### TypeScript 타입과 DB 스키마의 관계

```
TypeScript (코드)                    SQL (DB)
─────────────────                    ────────
interface AnnouncementRow    ←→      CREATE TABLE announcements
  boardId: number            ←→        board_id INTEGER
  title: string              ←→        title TEXT NOT NULL
  district: string | null    ←→        district TEXT  (NULL 허용)
  announcementType: 'public'|'private' ←→  announcement_type ENUM(...)
  createdAt: string          ←→        created_at TIMESTAMPTZ DEFAULT now()
```

주의: TypeScript는 camelCase(`boardId`), SQL은 snake_case(`board_id`). 코드와 DB 사이에서 변환이 필요하며, 이는 서비스 레이어에서 처리한다.

---

## 6. cheerio를 선택한 이유

### cheerio란

Node.js에서 jQuery 스타일로 HTML을 파싱하는 라이브러리. 브라우저 없이 서버 사이드에서 HTML 문자열을 DOM처럼 탐색할 수 있다.

```ts
import * as cheerio from 'cheerio';

const $ = cheerio.load('<ul><li>Hello</li></ul>');
$('li').text(); // 'Hello'
```

### 대안 비교

| 방식                     | 장점                     | 단점                            | 적합성               |
| ------------------------ | ------------------------ | ------------------------------- | -------------------- |
| **cheerio**              | 가볍고 빠름, jQuery 문법 | JS 실행 불가                    | ✅ SSR 페이지에 최적 |
| **Playwright/Puppeteer** | 브라우저 렌더링, JS 실행 | 무겁고 느림, 리소스 많이 소모   | ❌ 과도함            |
| **정규표현식**           | 의존성 없음              | HTML 파싱에 부적합, 깨지기 쉬움 | ❌ 유지보수 불가     |
| **JSDOM**                | 표준 DOM API             | cheerio보다 무겁고 느림         | △ 가능하지만 불필요  |

### 선택 근거

청년안심주택 메인 페이지와 상세 페이지가 모두 **SSR(Server-Side Rendering)**로 제공되어 단순 HTTP GET으로 완전한 HTML을 받을 수 있다. JavaScript 실행이 필요 없으므로 cheerio가 가장 적합하다.

단, 리스트 페이지(list.do)는 CSR이라 AJAX 엔드포인트 직접 호출이 필요하지만, 현재 전략에서는 메인 페이지 모니터링으로 충분하므로 사용하지 않는다.

---

## 7. 크롤링 대상 사이트 분석

### 페이지별 렌더링 방식

```
메인 페이지 (main.do)        → SSR  → HTTP GET으로 HTML 완전 수신
리스트 페이지 (list.do)      → CSR  → AJAX: /youth/pgm/home/yohome/bbsListJson.json
상세 페이지 (view.do?boardId=N) → SSR  → HTTP GET으로 HTML 완전 수신
```

### 메인 페이지 HTML 구조

```html
<div class="mainBoard_list_w on">
  <ul class="mainBoard_list">
    <li>
      <a href="/youth/bbs/BMSR00015/view.do?boardId=6485&menuNo=400008">
        [공공임대] 2026년 1차 청년안심주택 모집공고
      </a>
      <span class="txDate">2026-03-31</span>
    </li>
    <!-- ... 최대 5건 ... -->
    <li class="more_w">
      <a href="..." class="more">전체보기</a>
    </li>
  </ul>
</div>
```

핵심 포인트:

- `ul.mainBoard_list > li > a` 에서 href의 `boardId` 파라미터로 공고 식별
- `span.txDate`에 게시일
- 마지막 `li.more_w`는 "전체보기" 링크이므로 파싱에서 제외

### 상세 페이지 HTML 구조

```html
<div class="board_view">
  <div class="view_info">
    <p class="subject">[민간임대] 태릉입구역 이니티움 추가모집공고</p>
    <ul class="view_data">
      <li><span class="title">공고게시일</span>2026-03-26</li>
      <li><span class="title">청약신청일</span>2026-03-30</li>
    </ul>
    <!-- 카테고리(지역구)는 option 태그에 비어있지 않은 값으로 표시 -->
    <!-- 첨부파일은 a[href*="fileDown.do"]로 접근 -->
  </div>
</div>
<div class="board_cont">
  <!-- 자유 형식 HTML. ■ 기호로 항목 구분 -->
  <p>■단지명 : 태릉입구역 이니티움</p>
  <p>■주택위치 : 서울특별시 노원구 공릉동 ...</p>
  <p>■공급호수 : 총 100세대 중 ...</p>
</div>
```

핵심 포인트:

- 메타 정보는 `div.view_info` 안에 구조화
- 지역구는 `option` 태그 중 텍스트가 비어있지 않은 것
- 본문(`div.board_cont`)은 자유 형식 HTML — `■` 기호 + 정규식으로 추출

---

## 8. 메인 페이지 파서 설계

### 선택자 전략

```ts
$('ul.mainBoard_list > li').each((_, el) => {
  if ($li.hasClass('more_w')) return; // "전체보기" 건너뛰기

  const href = $li.find('a').attr('href');
  const boardId = href.match(/boardId=(\d+)/);
  const title = $li.find('a').text().trim();
  const postDate = $li.find('span.txDate').text().trim();
});
```

### 왜 이 선택자인가

- `ul.mainBoard_list`는 모집공고 섹션에만 존재하는 고유 클래스
- `> li` 직계 자식만 선택하여 중첩된 li를 배제
- `more_w` 클래스 체크로 "전체보기" 링크를 깔끔하게 제외

### 반환 타입

```ts
interface AnnouncementSummary {
  boardId: number; // 공고 고유 식별자
  title: string; // "[공공임대] 2026년 1차 ..."
  postDate: string; // "2026-03-31"
}
```

---

## 9. 상세 페이지 파서 설계

### 구조화된 영역 vs 자유 형식 영역

상세 페이지는 두 영역으로 나뉜다:

1. **구조화된 메타 정보** (`div.view_info`) — CSS 선택자로 안정적 추출
2. **자유 형식 본문** (`div.board_cont`) — 정규식 기반 추출

```ts
// 구조화 영역: CSS 선택자
const title = $('p.subject').text();
const postDate = /* view_data에서 "공고게시일" 라벨 찾기 */

// 자유 형식 영역: 정규식
const complexName = rawContent.match(/■\s*단지명\s*[:：]\s*(.+)/);
```

### 공고 유형 판별

제목 문자열에서 추론한다:

```ts
// "[공공임대] ..." → 'public'
// "[민간임대] ..." → 'private'
if (title.includes('공공임대')) return 'public';
return 'private';
```

모집 구분도 동일한 방식:

```ts
// "...추가모집공고" → 'additional'
// "...모집공고"     → 'initial'
if (title.includes('추가모집')) return 'additional';
return 'initial';
```

### 지역구 추출의 특이한 구조

사이트가 지역구를 `<option>` 태그 25개로 표시하되, 해당하는 구만 텍스트가 채워져 있다:

```html
<option value="08"></option>
<!-- 빈 값 -->
<option value="09">노원구</option>
<!-- 이것만 텍스트 있음 -->
<option value="10"></option>
<!-- 빈 값 -->
```

따라서 모든 `option`을 순회하며 `text().trim()`이 비어있지 않은 것을 찾는다.

---

## 10. boardId 연속성 체크 알고리즘

### 문제

메인 페이지에는 최신 5건만 표시된다. 만약 크롤링 주기(1시간) 사이에 6건 이상이 동시에 등록되면, 중간 공고가 메인 페이지에서 밀려나 감지되지 않는다.

### 해결: 범위 채우기 (Gap Filling)

```
예시:
  lastBoardId = 6477 (마지막으로 확인한 ID)
  메인 페이지: [6485, 6479, 6478, 6477, 6474]

  새 공고: 6478, 6479, 6485 (6477보다 큰 것)
  범위: 6478 ~ 6485

  후보 목록: [6478, 6479, 6480, 6481, 6482, 6483, 6484, 6485]
  ├── 확정 (메인에 있음): 6478, 6479, 6485
  └── 검증 필요: 6480, 6481, 6482, 6483, 6484
      → 각각 view.do?boardId=N 으로 접근하여 존재 여부 확인
```

### 두 단계 분리

```ts
// 1단계: 후보 목록 생성
const candidates = findNewBoardIds(currentBoardIds, lastBoardId);

// 2단계: 확정/미확인 분리
const { confirmed, needsVerification } = separateKnownAndUnknown(
  candidates,
  currentBoardIds,
);

// 3단계: 미확인 ID는 상세 페이지 fetch로 존재 확인 (서비스 레이어에서 처리)
```

이렇게 분리한 이유: 파서 레이어는 순수 함수로 유지하고, HTTP 요청은 서비스 레이어에서 담당하도록 관심사를 분리.

---

## 11. HTML 스냅샷 기반 테스트 전략

### 왜 스냅샷인가

크롤링 파서는 **외부 HTML 구조에 의존**한다. 사이트 구조가 변경되면 파서가 깨진다. 이를 조기에 감지하려면:

1. 실제 사이트의 HTML을 **fixture 파일로 저장**
2. 이 fixture로 파서를 테스트
3. 사이트 구조가 변경되면 → fixture 업데이트 → 테스트 실패 → 파서 수정

```
src/lib/crawler/__fixtures__/
├── mainPage.html      # 메인 페이지 모집공고 섹션
└── detailPage.html    # 민간임대 상세 페이지 (태릉입구역 이니티움)
```

### 테스트 구성

```
parseMainPage.test.ts   — 7개 테스트
  ├── 5건 추출 확인
  ├── boardId 정확성
  ├── 제목 추출
  ├── 날짜 추출
  ├── "전체보기" 제외
  ├── 빈 HTML 처리
  └── boardId 없는 링크 건너뛰기

parseDetailPage.test.ts — 13개 테스트
  ├── 제목, boardId, 유형, 모집구분
  ├── 날짜, 지역구, 단지명, 주소, 세대수
  ├── 첨부파일 URL/이름
  ├── 공공임대 유형 판별
  └── 빈 HTML 안전 처리

checkBoardId.test.ts    — 13개 테스트
  ├── 새 공고 감지
  ├── 빈 번호 후보 포함
  ├── 새 공고 없는 경우
  ├── 오름차순 정렬
  └── 확정/미확인 분리
```

### 엣지 케이스

- **빈 HTML**: 파서가 에러 없이 빈 배열/기본값 반환
- **boardId 없는 링크**: 정상적으로 건너뜀
- **모든 공고가 이미 확인된 경우**: 빈 배열 반환

---

## 12. DB 스키마 설계 판단

### announcements 테이블

```sql
CREATE TABLE announcements (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  board_id      INTEGER NOT NULL UNIQUE,  -- 사이트의 boardId
  title         TEXT NOT NULL,
  announcement_type  announcement_type NOT NULL,  -- 'public' | 'private'
  recruitment_type   recruitment_type NOT NULL,    -- 'initial' | 'additional'
  complex_name  TEXT,      -- 단지명 (공공임대는 여러 단지라 null 가능)
  district      TEXT,      -- 지역구
  ...
);
```

**boardId를 UNIQUE로 설정한 이유**: 크롤링 시 중복 저장을 DB 레벨에서 방지. `INSERT ... ON CONFLICT` 패턴으로 upsert 가능.

### crawl_state 테이블

```sql
CREATE TABLE crawl_state (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  last_board_id   INTEGER NOT NULL DEFAULT 0,
  last_crawled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

크롤링할 때마다 `last_board_id`를 갱신하여 다음 크롤링의 비교 기준으로 사용.

### ENUM 타입 사용

```sql
CREATE TYPE announcement_type AS ENUM ('public', 'private');
CREATE TYPE recruitment_type AS ENUM ('initial', 'additional');
```

문자열 대신 ENUM을 사용하면:

- 잘못된 값 삽입을 DB 레벨에서 방지
- TypeScript 유니온 타입과 1:1 매핑

---

## 13. 이 프로젝트에서 내린 판단들

### 파서 / 서비스 / 핸들러 레이어 분리

```
파서 (parseMainPage, parseDetailPage)
  → 순수 함수. HTML string → 구조화된 데이터
  → 테스트가 쉽고, 외부 의존성 없음

서비스 (추후 구현)
  → HTTP 요청 + 파서 호출 + DB 저장
  → 비즈니스 로직 담당

핸들러 (추후 구현)
  → API Route Handler
  → 요청/응답 처리 + 서비스 호출
```

이렇게 분리하면 파서만 단독으로 테스트할 수 있고, HTTP 요청 실패와 파싱 실패를 독립적으로 처리할 수 있다.

### 공공임대 상세 페이지의 한계

공공임대 공고(boardId=6485)는 본문에 단지명, 주소가 없다. 573세대를 여러 단지에 걸쳐 모집하기 때문에 상세 정보는 첨부 PDF에만 있다. 이 경우 `complexName`, `address`가 null이 된다.

현재는 이를 허용하고, 추후 PDF 파싱이 필요하면 별도 이슈로 다룬다.

### 정규식 기반 본문 파싱의 한계

`■단지명 : 값` 패턴은 현재 공고들에서 잘 동작하지만, 사이트에서 형식을 바꾸면 깨질 수 있다. 이를 보완하기 위해:

- `rawContent`를 DB에 저장하여 나중에 재파싱 가능
- HTML 스냅샷 테스트로 구조 변경을 조기 감지
- Sentry 에러 모니터링으로 파싱 실패 시 알림 (Phase 3에서 도입)
