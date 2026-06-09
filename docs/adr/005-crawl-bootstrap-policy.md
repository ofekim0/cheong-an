# ADR 005: crawl_state 부트스트랩 정책 — lastBoardId=0이면 catch-up 건너뛰기

- **상태**: 수락됨
- **작성일**: 2026-06-09

## 맥락

`crawl_state` 테이블은 마이그레이션 시드로 `last_board_id = 0`을 가진다. 첫 cron 호출 시 `announcementService.crawlNewAnnouncements`가 `lastBoardId+1 ~ latestBoardId` 범위 전체를 view.do로 확인하는데, 현재 운영 시점의 `latestBoardId`가 6561이라 첫 호출이 6561회 view.do(1초 rate limit × 6561 ≈ 109분)를 시도하다 사실상 끝나지 않는다. 결과적으로 핸들러가 `updateLastBoardId`까지 도달하지 못해 `last_board_id`가 0 그대로 남고, 다음 호출도 동일하게 catch-up 루프에 빠진다(#36).

이 서비스의 목적은 "지금 이후의 새 공고 알림"이지 "지금 시점까지의 모든 과거 공고 백필"이 아니다. 그러나 코드와 마이그레이션 어느 쪽에도 "초기 가동 시 어떻게 시작하는가"의 정책이 명시돼 있지 않다.

## 고려한 선택지

### 선택지 A: 마이그레이션 시드값 변경

새 마이그레이션으로 `last_board_id`를 합리적 값(예: 마이그레이션 시점 latestBoardId 근처)으로 update.

- 장점:
  - 코드 분기 0.
- 단점:
  - 시드 값을 누가 어떻게 결정하나(수동 관찰 필요).
  - 마이그레이션 시점과 첫 cron 호출 사이에 새 공고가 게시되면 누락.
  - 추후 신규 환경(스테이징 등)을 만들 때마다 같은 결정 반복.

### 선택지 B: lastBoardId=0이면 catch-up 건너뛰고 latestBoardId만 저장 (코드 분기)

`crawlNewAnnouncements`가 `lastBoardId === 0` 신호를 부트스트랩 모드로 해석한다. JSON list에서 `latestBoardId`만 읽어 그대로 반환, view.do 루프 생략. 핸들러는 `latestBoardId`를 `last_board_id`에 기록하고 응답. 다음 호출부터 진짜 신규(`latestBoardId` 이후)만 처리.

- 장점:
  - 마이그레이션 불변.
  - 시드값과 첫 호출 시점이 분리돼도 정합.
  - 부트스트랩 의미가 코드에 명시됨.
- 단점:
  - 첫 호출은 알림 0건. 그러나 어차피 "신규"가 아니므로 손실 아님.

### 선택지 C: 한 호출당 view.do 상한 N

view.do 호출 횟수에 상한. 부족하면 다음 cron에서 이어감.

- 장점:
  - 과거 데이터도 점진적으로 백필 가능.
- 단점:
  - 본 서비스는 "신규 알림"이 목적이라 과거 백필 자체가 무의미.
  - 1시간 cron + N=50이면 6561 / 50 ≈ 131 사이클 ≈ 5.4일 백필 기간.
  - 그동안 진짜 신규 감지는 catch-up 큐 뒤로 밀린다.

### 선택지 D: lastBoardId=0 → latestBoardId − N 점프 (최근 N건만 신규로 간주)

첫 호출에서 최근 N건을 신규로 간주.

- 장점:
  - 첫 가동 직후 사용자 입장에서 "최근 공고가 알림으로 옴".
- 단점:
  - 신규 알림이 아닌 "이미 게시된 공고"가 알림으로 가는 게 본 정의에 어긋남.
  - N=5라도 첫 가동에서 5건이 한꺼번에 알림 → 폭주.

## 결정

선택지 B — `crawlNewAnnouncements`에서 `lastBoardId === 0`이면 catch-up 루프를 건너뛰고 `latestBoardId`만 반환한다. `newDetails`와 `skippedBoardIds`는 빈 배열. 핸들러는 `updateLastBoardId(latestBoardId)`만 수행하고 응답.

## 근거

- 신규 알림 서비스의 정의("지금 이후의 새 공고")와 정확히 부합. 첫 호출의 "0건"은 손실이 아니라 자연스러운 부트스트랩 결과.
- 마이그레이션 불변으로 신규 환경(스테이징, 재구축, 로컬) 어디든 같은 동작이 보장됨.
- 코드 분기 한 줄(`if (lastBoardId === 0)`)로 의도를 명시할 수 있어 가독성·테스트 단순.
- 첫 호출이 1초 안에 200 응답으로 끝나므로 GHA workflow의 `curl --fail`이 timeout으로 빨갛게 되는 일이 없다.

## 결과

- `src/lib/crawler/announcementService.ts`의 `crawlNewAnnouncements`에 `lastBoardId === 0` 부트스트랩 분기 추가:
  - JSON list 1회 호출 후 `items` 검사.
  - `lastBoardId === 0`이면 `latestBoardId`만 반환, view.do 루프 생략.
- `crawlNewAnnouncements` 통합 테스트에 부트스트랩 케이스 추가.
- `/api/cron/crawl` 경로 영향 없음(이미 반환값을 그대로 사용해 `updateLastBoardId` 호출).
- 운영: 첫 cron 호출은 약 1초 안에 200 응답. 다음 호출부터 진짜 신규만 처리.
