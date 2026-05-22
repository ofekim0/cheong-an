# ADR 003: 저장 매핑 전략 — 저장 전 view.do 보강

- **상태**: 수락됨
- **작성일**: 2026-05-22
- **관련 ADR**: ADR 002 (크롤링 데이터 소스 전략 — 옵션 C 하이브리드)

## 맥락

epic #19(PR #20~23, #25)로 데이터 소스를 JSON API 주 + `view.do` 보강 하이브리드로 재설계했다. 현재 `announcementService.crawlNewAnnouncements()`는 `AnnouncementListItem[]`을 반환한다.

`announcements` 테이블 스키마(`supabase/migrations/00001_create_announcements.sql`)와 JSON 응답 필드를 비교하면 다음 컬럼이 JSON에는 없다:

- `complex_name`
- `district`
- `address`
- `total_units`
- `result_date`
- `attachment_url` / `attachment_name` (JSON에는 `atchFileId`만)

이 정보들은 `view.do` 상세 페이지에서만 얻을 수 있다. 즉 JSON으로 발견한 신규 boardId를 그대로 저장하면 위 컬럼은 모두 NULL이 된다. 한편 PROJECT_PLAN에서 Sprint 3의 차별화 핵심은 **서울시 구 단위 필터**(`district`)다. district가 NULL인 row가 다수면 필터 적용 자체가 불가능해진다.

#12 작업을 시작하기 전에 매핑 전략을 확정해야 한다.

## 고려한 선택지

### 선택지 A: 부분 저장 + 별도 보강 잡

JSON 응답을 그대로 저장하고(`district` 등 NULL 다수), 별도 보강 잡이 NULL row를 `view.do`로 채운다.

- 장점:
  - 저장 단계가 빠름(view.do 추가 호출 0).
  - 저장과 보강이 독립적이라 보강 실패가 알림을 막지 않음.
- 단점:
  - 두 단계(저장·보강) 운영이 필요해 복잡도 증가.
  - Sprint 2 알림 시점에 `district`가 비어 있을 수 있어 필터 기반 알림이 막힘.
  - Sprint 3 진입 전 보강 잡이 모든 NULL row를 채워야 한다는 추가 일정 제약.

### 선택지 B: 저장 전 view.do 보강

모든 신규 boardId(JSON 신규 + gap)에 대해 `view.do`를 호출해 `AnnouncementDetail`을 만든 뒤 저장. JSON은 신규 boardId 발견과 latest 추적 용도만 담당.

- 장점:
  - 모든 row가 동일하게 완전한 detail을 가짐 → 데이터 비대칭 없음.
  - Sprint 3 필터 진입 시 추가 작업 0.
  - 운영 단계가 한 단계(저장)로 단순.
- 단점:
  - 신규 N건마다 view.do N회 추가 호출.
  - announcementService 책임 재설계 필요(현재의 "gap만 view.do" 패턴에서 "모든 신규 view.do" 패턴으로).

### 선택지 C: 현재 코드 그대로 (JSON 신규 부분 + gap 완전)

`crawlNewAnnouncements`가 반환하는 그대로 저장. JSON에서 온 항목은 NULL 다수, gap 보강은 detail 완전.

- 장점:
  - 추가 변경 없음. 가장 빠른 진행.
- 단점:
  - row 간 데이터 비대칭(JSON 신규는 NULL 다수, gap은 완전). 운영·필터 적용 시 분기 발생.
  - Sprint 3 진입 시 JSON 신규 row만 골라서 보강해야 하는 추가 작업이 사실상 선택지 A와 같은 비용으로 미뤄짐.

## 결정

선택지 B — 모든 신규 boardId를 `view.do`로 보강해 `AnnouncementDetail` 형태로 저장한다. announcementService를 "JSON은 신규 boardId 발견, 저장 대상은 항상 view.do detail" 패턴으로 좁힌다.

## 근거

- **신규 빈도가 낮다**. 청년안심주택 공고는 영업일 기준 산발적이라 1시간 회차당 신규는 0~3건 수준으로 추정된다. rateLimit 1초 가정 시 회차당 추가 지연은 3초 이내. 트래픽 차단 위험도 낮음.
- **Sprint 3 필터가 차별화 핵심**(PROJECT_PLAN 5장). district 결손은 곧 차별화 기능 결손. 결손을 회피하는 가장 단순한 길이 B.
- **운영 단계 단순화**. 옵션 A의 "두 단계 + 보강 진척 추적"보다 옵션 B의 "한 단계 + 모두 완전"이 1인 운영에 유리.
- **ADR 002와의 정합**. 옵션 C 하이브리드의 핵심은 "JSON으로 빠른 발견 + view.do로 누락 방지"였다. 옵션 B는 이 하이브리드를 그대로 유지하되 view.do 호출 범위를 "gap"에서 "모든 신규"로 넓힌 것에 해당한다. ADR 002의 폐기가 아니라 좁힘.

## 결과

- `announcementService.crawlNewAnnouncements()` 재설계:
  - 입력: `lastBoardId`.
  - 출력: `AnnouncementDetail[]` + `latestBoardId` + `skippedBoardIds`.
  - 흐름: JSON 호출 → 신규 boardId 집합 산출(JSON 신규 ∪ gap) → 각 boardId에 대해 view.do 호출 → 633B 에러면 skipped, 정상이면 `parseDetailPage` → `AnnouncementDetail`.
- `detailToListItem` 어댑터는 더 이상 필요 없음(반환 타입이 `AnnouncementListItem`이 아니라 `AnnouncementDetail`로 통일).
- 저장 서비스(`src/lib/supabase/`)는 `AnnouncementDetail`을 `announcements` row(snake_case)로 매핑해 UPSERT.
- `crawl_state.last_board_id`는 같은 회차에서 `latestBoardId`로 갱신.
- 통합 테스트는 "JSON 신규 + gap" 시나리오에서 view.do가 신규 건수만큼 호출되는지 검증.
