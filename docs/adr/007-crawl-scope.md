# ADR 007: 크롤 범위 결정 — 전역 boardId gap-fill 폐기, 목록 기반 크롤

- **상태**: 제안됨
- **작성일**: 2026-06-17
- **대체 대상**: ADR 002 (view.do "gap 보강" 역할), ADR 003 (신규 집합 정의 "JSON 신규 ∪ gap")
- **관련 이슈**: #42

## 맥락

운영 중 크론이 2026-06-16 10:12부터 연속 HTTP 500으로 동결됐다(이전 성공 04:46). 조사 결과 boardId가 **여러 게시판(BMSR00015 청년안심주택, BMSR00013 공지사항 등)이 공유하는 전역 시퀀스**임이 확인됐다. `view.do`는 경로의 bbsId를 무시하고 boardId만으로 콘텐츠를 반환한다(검증: boardId 6563을 BMSR00015·BMSR00013 경로로 각각 호출 → 동일한 "희망두배 청년통장" 페이지 반환. BMSR00013 목록 1위 = 6563, BMSR00015 목록엔 6563 없음 — 6562 → 6564로 점프).

ADR 002 옵션 C와 ADR 003 옵션 B는 "lastBoardId+1 ~ latestBoardId 사이 gap을 view.do로 직접 호출하고 633B 마커로 비존재 판별"한다고 가정했다. 이 가정은 gap이 (a) BMSR00015 누락분이거나 (b) 633B 비존재 둘 중 하나라는 전제에 선다. 그러나 전역 시퀀스에서 gap은 대부분 (c) **타 게시판의 살아있는 200 공고**다. 633B 가드로는 (c)를 거를 수 없다.

실제 발현: gap 6563(BMSR00013 공지)이 BMSR00015 공고로 수집됐고, 이 공지는 `공고게시일` 필드가 없어 `parseDetailPage`가 `postDate=""`를 반환 → `post_date DATE NOT NULL` 위반 → 배치 upsert 전체 실패 → cron 500 → `last_board_id` 미전진 → 매시간 동일 실패(영구 동결). 청량리역 퀸즈W(6564)와 이후 신규가 모두 누락됐다. (자세한 재현은 #42)

## 고려한 선택지

### 선택지 1: 목록 기반 크롤 (gap-fill 폐기)

BMSR00015 JSON 목록에 실제 존재하는 boardId만 크롤한다. 폴링 사이 1페이지를 넘겨 밀려난 신규를 보전하기 위해, 페이지의 최소 boardId가 lastBoardId 이하가 될 때까지 pageIndex를 증가시켜 목록을 페이지네이션한다. view.do 보강(ADR 003 옵션 B)은 목록 항목에 대해 그대로 유지.

- 장점: 게시판 소속이 구조적으로 보장됨(목록이 곧 BMSR00015 멤버십). 오염 원천 차단.
- 장점: ADR 002 하이브리드의 "누락 방지" 목적을 페이지네이션으로 정확히 계승.
- 단점: 숫자 gap-fill이 주던 "JSON에 안 뜬 BMSR00015 boardId 보전" 환상을 버림(실제로 그런 boardId는 목록 페이지네이션으로 잡히므로 손실 없음).

### 선택지 2: gap-fill 유지 + 게시판 소속 검증

gap으로 받은 view.do 페이지가 BMSR00015 소속인지 검증.

- 단점: view.do 응답에 신뢰할 만한 게시판 식별자가 없음(bbsId 무시). "목록에 있는가"가 유일한 신뢰 신호인데 gap boardId는 정의상 목록에 없음 → 검증 불가. 사실상 선택지 1로 붕괴.

### 선택지 3: 저장 단계 회복력만 추가 (설계 유지)

gap-fill은 두되 불량 row만 건너뛰고 last_board_id를 전진.

- 단점: 동결(B)은 풀리나 오염(A)은 그대로. post_date만 채워진 타 게시판 공고는 계속 저장됨.

## 결정

선택지 1 — 전역 boardId gap-fill을 폐기하고, BMSR00015 JSON 목록(필요 시 페이지네이션)에 존재하는 boardId만 크롤한다. view.do 보강은 유지한다.

## 근거

- 오염을 사후 필터가 아니라 **구조적으로** 차단한다(목록 = 멤버십 정의).
- gap-fill의 정당화였던 "페이징 한계 보완"(ADR 002)을 목록 페이지네이션이 더 정확히 수행한다 — 숫자 추측 대신 실제 멤버 열거.
- 선택지 2는 분석상 선택지 1로 환원되고, 선택지 3은 근본 결함을 남긴다.

## 결과

- `announcementService.crawlNewAnnouncements()` 재설계:
  - 신규 집합 = "JSON 목록에서 boardId > lastBoardId인 항목" (gap 정수 열거 제거).
  - 1페이지 최소 boardId > lastBoardId면 추가 페이지 조회(오버플로 보전).
  - 각 신규 boardId만 view.do 보강 → `AnnouncementDetail`.
- `isViewErrorPage`의 역할 축소: 목록에 뜬 boardId가 view.do에서 633B면 그때만 skip(드문 경쟁 상황). 더는 cross-board 판별 책임 없음.
- 방어적으로, 저장 전 `checkDetailInvariants` 게이트 + row별 격리를 추가해 단일 불량 row가 회차를 막지 않게 한다(동결 재발 방지). `last_board_id`는 위반 row가 있어도 latest까지 전진.
- 통합 테스트: "목록에 6562·6564만, 사이 6563은 타 게시판" 시나리오에서 6563이 크롤되지 않음을 검증. 오버플로(신규 >10건) 페이지네이션 시나리오 추가.
- ADR 002/003은 폐기가 아니라 부분 대체: JSON 주 소스 + view.do 보강 골격은 유지하고 "신규 집합 정의"만 교정한다.
