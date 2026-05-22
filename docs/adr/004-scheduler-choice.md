# ADR 004: 크롤링 스케줄러 선택 — GitHub Actions

- **상태**: 수락됨
- **작성일**: 2026-05-22

## 맥락

#13에서 1시간 간격으로 크롤링을 트리거할 스케줄러가 필요하다. 청년안심주택 공고는 영업시간대에 산발적으로 등록되므로, 한 시간 안에 새 공고를 잡는 것이 알림 가치의 하한선이다.

후보는 (1) Vercel Cron, (2) GitHub Actions scheduled workflow, (3) Supabase Edge Functions + pg_cron 정도다. 청안은 호스팅을 Vercel Hobby, DB를 Supabase 무료 티어로 운영할 예정이다.

## 고려한 선택지

### 선택지 A: Vercel Cron

`vercel.json`의 `crons` 필드로 Route Handler를 주기 호출.

- 장점:
  - 같은 Vercel 프로젝트 안에서 트리거가 닫혀 있음(추가 서비스 0).
  - 실행 로그·실패 알림이 Vercel 대시보드에서 일원화.
  - 외부에서 호출하지 않으므로 cron 엔드포인트의 인증 부담이 적음(Vercel 내부 호출 보장).
- 단점:
  - **Hobby 플랜은 daily만 가능**. 1시간 간격은 Pro 플랜(월 $20) 필요.
  - 1인 포트폴리오 프로젝트에 유료 플랜은 과투자.

### 선택지 B: GitHub Actions scheduled workflow

`.github/workflows/crawl.yml`에 `cron: '0 * * * *'`로 1시간 간격 실행. 워크플로우 안에서 `curl`로 Vercel에 배포된 `/api/cron/crawl`을 호출.

- 장점:
  - 무료 + 1시간 간격 자유(public repo 기준 사실상 무제한).
  - 실행 로그·실패 표시가 GitHub Actions UI에 노출.
  - 다른 정기 작업(보강 잡, 헬스체크 등)을 같은 곳에 추가하기 쉬움.
- 단점:
  - GitHub → Vercel HTTP 호출이 외부 경계를 거치므로 cron 엔드포인트에 인증 토큰 필요(`CRON_SECRET`).
  - GitHub 측 Actions 장애 시 트리거 누락(Vercel Cron 대비 의존성 1개 추가).
  - cron 정확도가 ±수 분 수준이라 분 단위 정확성을 요구하면 부적합(이 프로젝트는 1시간 간격이라 무관).

### 선택지 C: Supabase Edge Functions + pg_cron

DB 호스트에서 직접 트리거.

- 장점:
  - DB와 가깝게 동작 → DB-only 작업이면 가장 짧은 경로.
- 단점:
  - 크롤링 본체(`announcementService`, fetch/retry/rateLimit)가 Next.js 서버 코드에 있어 Edge Function에서 재구현하거나 별도 패키지로 분리 필요.
  - pg_cron은 단순 SQL 실행에 적합하고, HTTP 호출은 별도 익스텐션·외부 호출 패턴 추가 필요.
  - 운영 표면적이 한 서비스 늘어남.

## 결정

선택지 B — GitHub Actions scheduled workflow로 1시간 간격 cron을 운영하고, workflow가 `/api/cron/crawl` Route Handler를 `Authorization: Bearer $CRON_SECRET`으로 호출한다.

## 근거

- **비용**: Hobby 플랜을 유지하면서 1시간 간격을 무료로 운영할 수 있는 유일한 선택지.
- **운영 가시성**: GitHub Actions UI에서 실행 이력·실패가 한눈에 보이며, 이미 CI 워크플로우가 같은 곳에 있어 운영 컨텍스트가 일원화됨.
- **포터블함**: 호스팅을 Vercel에서 다른 곳(예: Cloudflare Pages, Railway)으로 옮겨도 workflow는 URL만 바꾸면 됨.
- **외부 호출 단점은 인증 토큰으로 충분히 방어 가능**. CRON_SECRET을 Vercel 환경변수와 GitHub Secrets 양쪽에 두면, 토큰이 없는 호출은 401로 거부된다.

## 결과

- `.github/workflows/crawl.yml` 신규:
  - trigger: `schedule: cron: '0 * * * *'` + `workflow_dispatch`(수동 트리거).
  - step: `curl --fail -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" $DEPLOY_URL/api/cron/crawl`.
  - 실패 시 workflow가 빨갛게 표시되도록 `--fail` 사용.
- `/api/cron/crawl` Route Handler:
  - `Authorization` 헤더의 Bearer 토큰을 `process.env.CRON_SECRET`과 비교.
  - 불일치 시 401, 일치 시 `crawlNewAnnouncements` → DB UPSERT → `last_board_id` 갱신.
  - JSON 응답: `{ newCount, skippedBoardIds, latestBoardId }`.
- 환경변수 등록(수동 단계, README/HANDOFF에 기록):
  - Vercel: `CRON_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
  - GitHub Secrets: `CRON_SECRET`(Vercel과 동일 값), `DEPLOY_URL`.
- 로컬 트리거: `curl -H "Authorization: Bearer dev-secret" http://localhost:3000/api/cron/crawl`로 수동 호출(개발 편의용 .env 분리).
- Sentry는 Phase 3에 도입 예정. 그 전까지는 GHA workflow 실패 상태와 응답 페이로드를 운영 신호로 사용.
