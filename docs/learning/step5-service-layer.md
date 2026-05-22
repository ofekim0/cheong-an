# Step 5-c. 크롤러 서비스 레이어 — 합성

> 선행: [step5-fetch-html.md](./step5-fetch-html.md), [step5-retry.md](./step5-retry.md), [step5-rate-limit.md](./step5-rate-limit.md)

> ⚠️ **이 문서의 §2 흐름 도식, §3-3 (404 = 빈 번호), §5 한계 일부는 epic [#19](https://github.com/ofekim0/cheong-an/issues/19) (2026-05-22 머지) 이후 폐기됨.**
>
> - **흐름 도식 (§2)**: "메인 fetch → parseMainPage → findNewBoardIds → 후보별 view.do" 구조가 폐기되고, "JSON API fetch → parseListJson → filter + gap → gap에 대해서만 view.do 보강"으로 바뀜.
> - **404 정책 (§3-3)**: 빈 번호 판정이 `HttpError(404)` 캐치에서 HTTP 200 + 본문 마커(`isViewErrorPage`)로 변경. 청년안심주택 사이트는 빈 번호에 633B 에러 페이지를 200으로 반환.
> - **한계 (§5)**: "상세 페이지 검증 미구현"은 epic #19로 해결됨. 나머지 한계(단일 인스턴스 rateLimit, DB 미연동, 스케줄링 미포함)는 여전히 유효.
>
> §1 (왜 별도 레이어), §3-1 (rateLimit OUTSIDE retry), §3-2 (직렬 루프), §3-4 (latestBoardId 의미), §4 (DI 주입 포인트), §6 (테스트 포인트의 핵심 의도)은 현재도 유효합니다.
>
> 재설계 학습은 [step6-data-source-redesign.md](./step6-data-source-redesign.md) 참고. 이 문서는 그 시점의 합성 설계 사고를 박제로 보존합니다.

`fetchHtml` (전송) · `retry` (신뢰성) · `rateLimit` (속도) · `parseMainPage` / `parseDetailPage` (파싱) — 다섯 모듈을 **한 회차 크롤링**으로 묶는 합성 레이어.

## 1. 왜 별도 레이어가 필요한가

각 모듈은 단일 책임을 충실히 지키되, "한 회차 크롤링" 같은 비즈니스 흐름은 어디에도 속하지 않는다. 이 흐름을 호출자(스케줄러, API 라우트)에 직접 넣으면:

- 호출자마다 합성 순서가 달라질 위험
- 테스트할 때 호출자 단위로 mock 다섯 개를 짜야 함
- "404는 빈 번호니까 건너뛴다" 같은 정책이 코드 곳곳에 흩어짐

서비스 레이어는 이 흐름을 한 곳에 고정하고, 호출자에게 `crawlNewAnnouncements({ lastBoardId }) → CrawlAnnouncementsResult` 한 함수만 노출한다.

## 2. 흐름

```
crawlNewAnnouncements(options)
  ├─ 메인 페이지 fetchWithPolicy(MAIN_URL)
  │    └─ rateLimit.acquire() » withRetry(fetcher)
  ├─ parseMainPage(html) → AnnouncementSummary[]
  ├─ findNewBoardIds(ids, lastBoardId) → 후보 boardId[]
  └─ for each candidate:
       ├─ fetchWithPolicy(detailUrl(boardId))
       ├─ try: parseDetailPage(html, boardId) → newAnnouncements push
       └─ catch HttpError(404): skippedBoardIds push (빈 번호)
```

반환:

| 필드               | 의미                                                 |
| ------------------ | ---------------------------------------------------- |
| `newAnnouncements` | 이번 회차에 발견한 공고 상세                         |
| `latestBoardId`    | 메인에서 관측한 최대 boardId — 다음 회차 lastBoardId |
| `skippedBoardIds`  | 후보였으나 404였던 번호 (운영 관찰용)                |

## 3. 핵심 설계 결정

### 3-1. 합성 순서: rateLimit OUTSIDE retry

```ts
await rateLimiter.acquire();
return withRetry(() => fetcher(url));
```

각 의미가 분리된다.

- `acquire()`: 이번 호출의 시작 시점을 정한다 (서버에 정중하게).
- `withRetry`: 일시 장애를 흡수한다 (자체 백오프 슬립).

순서를 뒤집어 retry 안에서 acquire를 부르면, 매 시도마다 또 슬롯을 잡아 시도 사이 간격이 retry 백오프 + rate limit 간격으로 이중 누적된다. 본 모듈은 이미 [step5-rate-limit.md §4-3](./step5-rate-limit.md)에서 정한 규칙을 그대로 따른다.

### 3-2. 직렬 루프 — 병렬 안 쓰는 이유

후보가 N개라도 limiter가 호출 간격을 `intervalMs`로 강제한다. 병렬로 `Promise.all`을 걸어도 limiter 내부 큐잉이 결국 같은 총 소요 시간(`N × intervalMs + 순수 네트워크`)으로 수렴한다. 병렬은 다음을 추가하지만 이득이 없다:

- 에러 집계 로직 (어느 후보에서 실패했는지)
- 부분 성공 처리 (Promise.allSettled 분기)
- 디버깅 시 시점 추적 어려움

직렬은 "한 번에 하나씩, 404면 다음으로" 라는 의도가 코드 모양 그대로 드러난다.

### 3-3. 404 = 빈 번호 (정상 흐름)

`findNewBoardIds`는 메인에 보이지 않는 중간 번호도 후보에 포함한다 (5건 초과 동시 등록 누락 방지, [parseMainPage 학습 정리](./step4-crawling.md) 참조). 이 후보가 실제로는 발행되지 않은 번호일 수 있다 → 상세 fetch 시 404.

```ts
} catch (err) {
  if (err instanceof HttpError && err.status === 404) {
    skippedBoardIds.push(boardId);
    continue;
  }
  throw err;
}
```

retry 모듈의 `isRetryable`은 4xx에 대해 false를 반환하므로 404는 즉시 throw된다 (재시도 낭비 없음). 서비스가 그것을 잡아 흐름을 이어간다.

500/타임아웃 등 다른 에러는 throw해서 호출자(스케줄러)가 회차 단위 재시도/알람을 결정하게 한다 — 한 후보 실패가 전체 크롤링을 망가뜨리지 않게 하는 단순한 분리.

### 3-4. latestBoardId의 의미

```ts
const latestBoardId = Math.max(...observedIds);
```

성공한 상세의 max가 아니라 **메인에서 관측한 max**다. 의도는:

- 다음 회차에서 같은 빈 번호를 또 후보로 올리지 않게 하기 위함.
- 빈 번호가 사후에 "진짜 공고로 채워지는" 경우는 가정하지 않음 (실제로 boardId는 sequential append-only).

대안은 "성공한 상세의 max만 저장 → 다음 회차에 빈 번호 재시도"였지만, 매 시간 같은 404를 또 때리는 낭비라 채택하지 않았다.

## 4. DI 주입 포인트

| 옵션             | 기본값                            | 왜 주입 받게 했나                             |
| ---------------- | --------------------------------- | --------------------------------------------- |
| `fetcher`        | `fetchHtml`                       | MSW/fake 교체로 네트워크 격리 테스트          |
| `rateLimiter`    | `createRateLimiter({intervalMs})` | 여러 service 호출이 한 limiter 공유 가능      |
| `buildDetailUrl` | 소코 youth 도메인 빌더            | 환경별 URL 분리 (스테이징/운영)               |
| `mainPageUrl`    | 운영 URL                          | 테스트 픽스처 또는 환경별 override            |
| `retryOptions`   | retry 모듈 기본값                 | 호출 맥락별 정책 조정 (예: 점검 시간 더 관대) |

기본값을 모두 갖춘 덕에 운영 호출은 `crawlNewAnnouncements({ lastBoardId })` 한 줄, 테스트는 모든 의존성을 명시적으로 주입.

## 5. 한계와 다음 단계

- **단일 인스턴스 전제**: rateLimit은 프로세스 안에서만 유효 ([step5-rate-limit.md §5](./step5-rate-limit.md)). Vercel multi-instance에서는 호출 간격이 인스턴스 수만큼 늘어날 수 있다 → 스케줄러 단계에서 동시성 1로 제한 또는 Upstash Redis로 이주.
- **상세 페이지 검증 미구현**: `findNewBoardIds`가 빈 번호도 후보에 넣지만, "메인에 안 보이는 후보가 실제 존재하는지"의 추가 판정은 현재 404 catch로만 처리. 더 풍부한 검증(예: 페이지 상단 에러 메시지 체크)은 호출자/파서에서 보강.
- **DB 연동 미포함**: 결과를 받아 Supabase에 insert하고 `lastBoardId`를 갱신하는 일은 별도 layer (Sprint 1 잔여 ③).
- **스케줄링 미포함**: 회차 트리거 자체는 Vercel Cron / GitHub Actions에서 (Sprint 1 잔여 ④).

## 6. 테스트 포인트 (다음 단계에서 MSW로)

| 시나리오                              | 기대                                               |
| ------------------------------------- | -------------------------------------------------- |
| 메인 비어있음                         | newAnnouncements [], latestBoardId = lastBoardId   |
| 모든 후보 200                         | newAnnouncements N개, skippedBoardIds []           |
| 일부 후보 404                         | 404분만 skippedBoardIds, 나머지는 newAnnouncements |
| 메인 fetch 5xx 1회 후 200             | retry로 흡수, 정상 결과                            |
| 상세 fetch 5xx 3회 (재시도 한도 초과) | throw, 호출자에게 전파                             |
| 동시에 두 service 호출 (limiter 공유) | 호출들이 intervalMs로 직렬화                       |

다음 단계: [step5-msw-testing.md] 작성하며 위 케이스를 실제로 검증.
