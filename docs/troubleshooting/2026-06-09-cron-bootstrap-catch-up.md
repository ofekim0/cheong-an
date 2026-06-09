# 2026-06-09 cron 첫 호출 109분 catch-up loop

- **연관**: Issue #36 / ADR 005 / 본 PR

## 증상

`pnpm dev` 후 `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/crawl` 첫 호출:

- PowerShell `curl.exe`가 응답 본문을 안 보여줌 (Ctrl+C로 끊자 dev 콘솔이 흘러나옴).
- dev 서버 로그: `GET /api/cron/crawl 200 in 74s (application-code: 74s)` — 서버는 정상 200을 logged.
- `announcements` 0건, `crawl_state.last_board_id`는 시드 0 그대로.

## 초기 가설 — 모두 빗나감

`last_board_id = 0`을 "서비스가 `latestBoardId = 0`을 반환했다"로 해석한 게 공통 함정.

| 가설 | 시나리오                                                                                   | 빗나간 이유                                               |
| ---- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| A    | JSON list 빈 응답 → 빈 items 분기 → `latestBoardId = lastBoardId = 0`. 74초는 retry 백오프 | 3회 × maxDelay 10s ≈ 22.5초 상한. 74초 안 맞음            |
| B    | view.do 호출은 일어났는데 모두 633B 에러                                                   | 그 경로면 `latestBoardId`는 JSON에서 산출한 값이지 0 아님 |
| C    | Supabase update가 `gte('id', 0)` 필터로 다른 행을 잡았다                                   | 단일 행이고 `last_crawled_at`은 정확히 그 행에 update됨   |

셋 모두 "핸들러가 끝까지 가서 `updateLastBoardId(client, 0)`을 호출했다"고 가정. 실제로는 그 함수가 **호출조차 안 됐다**.

## 진단 과정

- **응답 본문 확보**: `curl.exe ... -o /tmp/response.json -D /tmp/headers.txt`로 파일 리다이렉트, timeout 600s까지 늘림. client 측은 매번 0바이트 timeout으로 끊김.
- **dev stdout 캡처**: `pnpm dev > /tmp/dev.log 2>&1`을 background로, `tail -F`로 실시간 추적.
- **진단 console.log**: 핸들러/서비스에 단계별 시간 stamp + 진행 카운터 (`[crawl/diag] view.do progress 10/N ...`) HMR로 즉시 반영. 다음 호출에서 결정적 단서:

```
[crawl/diag] json fetched in 50ms: items=10, sampleBoardIds=6561,6560,6559,6558,6557
[crawl/diag] latestBoardId=6561, newBoardIds.length=6561 (first=1, last=6561)
[crawl/diag] view.do progress 10/6561 (lastBoardId=10, elapsed=9972ms)
```

## 진짜 원인

`crawlNewAnnouncements`의 신규 boardId 계산이 `lastBoardId + 1 ~ latestBoardId`라, 시드 0 + 사이트 최신 6561이면 6561개를 view.do로 두드림. 1초 rate limit × 6561 ≈ **109분**. 핸들러가 끝까지 못 가서 `updateLastBoardId`까지 도달 못 함. **부트스트랩 정책이 누락된 설계 문제**.

## 해결

ADR 005 옵션 B — `lastBoardId === 0`이면 catch-up 루프 생략, `latestBoardId`만 반환:

```ts
if (lastBoardId === 0) {
  return { newDetails: [], latestBoardId, skippedBoardIds: [] };
}
```

로컬 검증: 1차 호출 1020ms `{newCount:0, latestBoardId:6561}`, 2차 호출 172ms (정상 흐름).

## 미해결 부수 의문

진단 중 모든 long-running 호출에서 dev 서버가 **약 3분(180초) 시점에 `200 in 3.0min`을 logged**했다. 6561번 루프가 그 시점에 끝났을 리 없으니 정상 응답이 아닌 다른 메커니즘(undici/turbopack default timeout, keepalive idle 등). 부트스트랩 픽스 후 재현 안 됨. 운영 영향 없음, 추후 long-running 핸들러를 다시 만들면 그때 확인.

## 교훈

- **DB 상태가 부분 갱신처럼 보이면 "잘못된 값으로 update됐다"가 아니라 "어떤 update가 호출 안 됐다"를 먼저 의심**. 본 건은 `last_crawled_at`만 갱신되고 `last_board_id`는 시드 그대로였는데, 가설 전부가 "0으로 update됐다"에 매여 진짜 원인(updateLastBoardId 미호출)을 놓쳤다.
- **장시간 핸들러 진단은 단계별 console.log + 진행 카운터 + dev stdout 캡처가 가장 빠르다**. HMR로 코드 즉시 반영 가능하니 부담도 작다.

## 다음에 비슷한 증상이면 확인할 것

- 응답 본문 0바이트 → hang 아니라 client timeout < 서버 처리시간일 수 있음. 서버 측 로그(`X in Ys`)와 client timeout 비교.
- 핸들러가 너무 오래 걸리면 → 단계별 + 시간 stamp + 진행 카운터로 진단 console.log. HMR 활용.
- DB가 일부만 갱신 → 어떤 update 호출이 누락됐는지 먼저 의심.
