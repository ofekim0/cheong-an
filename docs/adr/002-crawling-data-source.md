# ADR 002: 크롤링 데이터 소스 전략 — JSON API + HTML 하이브리드

- **상태**: 수락됨
- **작성일**: 2026-05-20

## 맥락

Phase 1 Sprint 1에서 메인 페이지·상세 페이지 파서를 cheerio 기반으로 구현(PR #15)하고 MSW 통합 테스트를 추가(PR #17)했다. 그러나 코드가 실제 청년안심주택 사이트(`soco.seoul.go.kr`)와 정렬되었는지는 검증된 적이 없었다.

2026-05-20 실 사이트 probe(curl 다회 호출)로 다음을 확인했다:

1. **코드 가정 URL이 데드 URL이다**
   - 코드의 `DEFAULT_MAIN_PAGE_URL`(`/youth/pgm/home/yohome/bbsListJ.do?menuNo=400008`) → HTTP 200 + 586B 에러 페이지(`/cmmn/error.jsp` 리다이렉트)
   - 실제 게시판: `/youth/bbs/BMSR00015/list.do?menuNo=400008`

2. **목록 페이지는 SPA 스타일이며 정적 HTML에 boardId가 없다**
   - `list.do`의 정적 HTML은 빈 `<tbody id="boardList">`만 포함
   - JS가 `POST /youth/pgm/home/yohome/bbsListJson.json`을 호출해 동적으로 행을 렌더링
   - 즉 cheerio로 boardId 추출이 불가능

3. **JSON API 응답에 본문까지 포함된다**
   - 응답 스키마: `{ pagingInfo: { totRow, totPage, pageIndex, ... }, resultList: [{ boardId, nttSj, content, optn1~5, atchFileId, regDate, ... }] }`
   - 한 번 호출로 boardId·제목·본문·분류 코드·첨부 ID를 모두 수신
   - 응답 크기: 1페이지 10건 기준 약 65KB

4. **상세 페이지(`view.do`)는 살아 있고, 비존재 boardId는 HTTP 200 + 633B 에러 페이지로 응답한다**
   - 존재: HTTP 200, 약 40KB
   - 비존재: HTTP 200, 633B, `<title>에러안내</title>` + `'게시글에 대한 정보가 없습니다.'`
   - 즉 코드의 "404 분기" 가정은 무효

데이터 소스 전략을 처음부터 재선택해야 했다.

## 고려한 선택지

### 선택지 A: JSON API 단독

매 사이클 `bbsListJson.json`을 호출해 본문까지 일괄 수신. `view.do` HTML은 사용하지 않는다.

- 장점:
  - 한 번 호출로 모든 데이터 확보, 가장 단순함
  - JSON이라 파싱 안정적 (HTML selector 깨질 위험 없음)
  - 분류 코드(공공/민간, 최초/추가) 등 메타데이터를 손실 없이 보존
- 단점:
  - 비공개 내부 API에 의존(공식 문서 없음). 서버 측 변경 시 즉시 사망
  - 메인 페이지가 상위 N건만 노출하는 페이징 한계를 보완할 별도 경로 없음

### 선택지 B: HTML `view.do` 단독

목록을 무시하고 마지막 알려진 boardId 이후를 순차적으로 추측 호출. 633B 에러 마커로 비존재 판별.

- 장점:
  - 비공개 API 의존 없음
- 단점:
  - boardId가 sparse하면 매 사이클 다수 호출
  - 분류 코드 등 JSON에만 있는 메타데이터를 HTML 파싱으로 재추출해야 함
  - 신규 boardId 발견 진입점이 없어 추측 범위가 폭주할 위험

### 선택지 C: 하이브리드 (JSON API + `view.do` 보강)

- JSON API를 주 데이터 소스로 사용 — 정기 조회로 신규 boardId 발견 + 본문/메타데이터 수신
- `view.do` HTML은 누락 보강용 — 마지막 알려진 boardId와 JSON 최신 boardId 사이의 gap을 직접 호출하고, 633B 가드 마커로 비존재 판별

- 장점:
  - 평시 1회 JSON 호출로 빠른 동작
  - JSON API와 view.do가 서로 다른 시점에 변경될 가능성이 높아, 한쪽이 깨졌을 때 다른 쪽으로 임시 대응할 여지가 생김
  - 분류 코드 손실 없음
  - 메인 페이지 페이징 한계 보완 → 알림 누락 위험 감소
- 단점:
  - 의존성 2개
  - 두 경로 사이의 데이터 정합 로직이 필요

## 결정

선택지 C — JSON API를 주 데이터 소스로 하고 `view.do` HTML을 누락 보강 경로로 함께 사용한다.

## 근거

- **누락 없는 알림이 이 프로젝트의 핵심 가치**다. 메인 페이지 페이징과 무관하게 view.do 직접 호출로 missing boardId를 확인할 수 있는 옵션 C가, 단일 소스에 의존하는 A/B 대비 우위.
- **운영 리스크 분산**: JSON API는 비공개라 변경 위험이 크지만 view.do는 사용자 UI가 직접 의존하므로 변경 빈도가 낮을 것으로 추정된다. 변경 시점이 다르면 한쪽 깨졌을 때 다른 쪽으로 시간을 벌 수 있다.
- **포트폴리오 가치**: 단일 소스의 한계와 그에 대한 방어 설계를 명시적으로 드러낼 수 있다. 면접에서 "왜 두 경로를 함께 쓰는가"를 설명할 수 있는 형태.
- **데이터 완전성**: JSON API의 분류 코드(공공/민간, 최초/추가)는 사용자에게 직접 가치가 있는 알림 메타데이터다. 옵션 B는 이 정보를 HTML 파싱으로 재추출해야 하며 비용 대비 가치가 낮다.

## 결과

- `parseMainPage.ts`(cheerio 기반 HTML 파서) 및 그 단위 테스트 폐기. 대체 파일로 `parseListJson.ts` 신규 작성
- `announcementService.ts` 재설계:
  - 데이터 소스 = `POST bbsListJson.json` + `GET view.do` 보강
  - 비존재 판별 = HTTP 404 분기 ⇒ 본문 마커(`<title>에러안내</title>` 또는 `'게시글에 대한 정보가 없습니다.'`) 가드
- `parseDetailPage.ts`는 view.do HTML이 살아 있으므로 selector 재검증 후 유지 (별도 작업)
- `fetchHtml.ts`는 GET HTML 외에 POST JSON도 다뤄야 하므로 분리하거나 확장 (구현 단계에서 결정)
- 모든 MSW 테스트 fixture를 실 응답 기반으로 재작성
- 학습 정리 문서(`docs/learning/step6-*.md`)에 비공개 API 의존의 트레이드오프와 robots/약관 점검 메모를 첨부
