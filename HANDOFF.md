# HANDOFF: 청안 프로젝트 — Claude Code 인계 문서

> 이 문서는 Claude.ai에서 진행한 기획/의사결정 세션의 결과물입니다.
> **2~10장은 Step 1 인계 시점의 스냅샷**이며, 이후 진척은 아래 "0. 최신 상태"에 갱신합니다.

---

## 0. 최신 상태 (2026-06-25 기준)

### 진행 중 — Sprint 2 웹 푸시 알림 (#39)

Sprint 2 1번 작업(웹 푸시 파이프라인, #39)을 4개 Step(9-a~d)으로 쪼개 진행 중. **9-a 완료·머지**(PR #47): VAPID 유틸 + Service Worker 등록 + 구독 훅 + 임시 검증 UI까지 클라이언트 구독 경로 완성, 실제 Chrome에서 구독→endpoint 생성 end-to-end 검증. 다음은 9-b(구독 저장 API + `push_subscriptions` 스키마). 학습 문서(`docs/learning/step9-web-push.md`)는 발송까지 완결되는 9-c 시점에 일괄 작성 예정.

### ✅ 해소됨 — 크롤 파이프라인 동결 (Issue #42, 2026-06-18)

**2026-06-16 10:12(UTC)부터 매시간 HTTP 500으로 동결됐던 크롤 파이프라인을 PR #45 머지·배포로 해소했다.** 프로덕션에서 500 → 200 전환 및 DB 저장까지 검증 완료.

**근본 원인** (ADR 007 `docs/adr/007-crawl-scope.md`에 상세):

- boardId는 청년안심주택(BMSR00015)뿐 아니라 공지사항(BMSR00013) 등 **여러 게시판이 공유하는 전역 시퀀스**다. `view.do`는 경로의 bbsId를 무시하고 boardId만으로 콘텐츠를 반환한다.
- 기존 `announcementService`의 gap-fill(= `lastBoardId+1 ~ latestBoardId` 전 정수를 view.do 호출)이 타 게시판 공고를 끌어왔다. 그중 6563(BMSR00013 "희망두배 청년통장")은 `공고게시일`이 없어 `parseDetailPage`가 `postDate=""`를 반환 → `post_date DATE NOT NULL` 위반 → 배치 upsert 전체 실패 → 500 → `updateLastBoardId` 미도달 → `crawl_state.last_board_id`가 6562에 고정 → 매시간 동일 실패.
- 배포 엔드포인트 실제 500 본문으로 근본 원인 확정: `invalid input syntax for type date: ""` (카나리 실패 아님 — 잔여 불확실성 해소).

**수정 (ADR 007 = 목록 기반 크롤, PR #45 머지)**:

- gap-fill 폐기 → BMSR00015 JSON 목록에 실제 존재하고 `boardId > lastBoardId`인 항목만 크롤.
- 1페이지 초과 신규는 `pagingInfo.totPage` 기준 페이지네이션으로 보전(`parseTotalPages` 추가).
- 저장 전 `checkDetailInvariants` 게이트 + row별 격리(`invalidBoardIds`) → 단일 불량 row가 배치를 동결시키는 것을 구조적으로 차단.

**검증 결과** (2026-06-18):

- 프로덕션 엔드포인트 200 응답 `{newCount, skippedBoardIds, invalidBoardIds, latestBoardId:6564}`.
- `announcements`에 6564(청량리역 퀸즈W, `post_date 2026-06-16`) 저장 확인. 6563(타 게시판)은 목록에 없어 자동 제외 — DB 미존재.
- `crawl_state.last_board_id` 6562 → 6564 전진.

관련: Issue #42, ADR 007(PR #43 설계 머지 + PR #45 코드 수정 머지). PR #44는 절차상 CLOSED(되돌림).

### 완료된 Step

| Step           | 내용                                                                                                                                                                                                                                                                                                                                                                  | 산출물                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Step 2         | Next.js 초기화, Prettier/husky/lint-staged, Vitest/Playwright                                                                                                                                                                                                                                                                                                         | `docs/learning/step2-essentials.md`                                                                                                                                                                                                                                                                                                                                                                   |
| Step 3         | Vercel 연동, GitHub Actions CI (lint + 타입 체크 + 테스트)                                                                                                                                                                                                                                                                                                            | `docs/learning/step3-ci-setup.md`                                                                                                                                                                                                                                                                                                                                                                     |
| Step 4         | 크롤링 파서 레이어 + DB 스키마 + 타입 (`feat/crawling-pipeline` 머지)                                                                                                                                                                                                                                                                                                 | `src/lib/crawler/parseDetailPage.ts` + 테스트, `supabase/migrations/00001_create_announcements.sql`, `src/types/announcement.ts`, `docs/learning/{step4-cheerio.md, step4-vitest-basics.md, step4-db-basics.md}` (※ `parseMainPage.ts`, `checkBoardId.ts`는 Step 6에서 폐기)                                                                                                                          |
| Step 5-a       | HTTP fetch + 재시도 유틸리티                                                                                                                                                                                                                                                                                                                                          | `src/lib/crawler/fetchHtml.ts`, `retry.ts`, `docs/learning/step5-fetch-html.md`, `docs/learning/step5-retry.md`                                                                                                                                                                                                                                                                                       |
| Step 5-b       | rateLimit (요청 간격 제어, 단일 프로세스 큐)                                                                                                                                                                                                                                                                                                                          | `src/lib/crawler/rateLimit.ts`, `docs/learning/step5-rate-limit.md`                                                                                                                                                                                                                                                                                                                                   |
| Step 5-c       | announcementService 합성 레이어 (fetch+retry+rateLimit+파서 조합)                                                                                                                                                                                                                                                                                                     | `src/lib/crawler/announcementService.ts`                                                                                                                                                                                                                                                                                                                                                              |
| Step 5-d       | MSW 기반 announcementService 통합 테스트                                                                                                                                                                                                                                                                                                                              | `src/lib/crawler/announcementService.test.ts`, `docs/learning/step5-msw-testing.md`                                                                                                                                                                                                                                                                                                                   |
| Step 6         | 데이터 소스 재설계: JSON API(주) + view.do(gap 보강) 하이브리드 (epic #19, PR #20~23, #25 머지)                                                                                                                                                                                                                                                                       | `src/lib/crawler/parseListJson.ts`, `fetchJsonText.ts`, `isViewErrorPage.ts`, `announcementService.ts` 재작성, `__fixtures__/{listJson.json,viewErrorPage.html,detailPage.html}` 실 응답 박제. 결정 근거는 ADR 002/003. 기존 `parseMainPage.ts`/`checkBoardId.ts` 폐기 표기 (실제 제거는 PR #27)                                                                                                      |
| Step 6 정리    | epic #19 후속 정리 (PR #27 머지): #12·#13 이슈 본문을 옵션 B / GHA 기준으로 다듬고, 폐기 표기된 `checkBoardId` 모듈 실제 삭제                                                                                                                                                                                                                                         | `src/lib/crawler/checkBoardId.ts`(+`.test.ts`) 삭제, `src/lib/crawler/index.ts` export 정리. 단위·통합 테스트 49개 그린 (checkBoardId.test.ts 9개 제거 영향)                                                                                                                                                                                                                                          |
| Step 7         | Supabase 저장 통합 (#12 완료): admin 클라이언트 + `announcements` UPSERT 리포지터리 + `crawl_state` 리포지터리 + `announcementService` 저장 연결. `crawl_state` 갱신 호출은 #13 스케줄러 통합 시점에 연결 예정                                                                                                                                                        | `src/lib/supabase/{client.ts, announcementsRepository.ts(+.test.ts), crawlStateRepository.ts(+.test.ts)}`, `src/lib/crawler/announcementService.ts` 갱신, `.env.example`, `docs/learning/{step7-supabase-client.md, step7-repository-pattern.md, step7-mocking-supabase.md}`. PR #29 (1차 통합) + PR #30 (cleanup — 테스트 백필 + crawl_state + env 문서화 + 학습 정리). 테스트 61개 그린             |
| Step 8         | 크롤링 스케줄러 (#13, PR #35 머지): `/api/cron/crawl` Route Handler + `.github/workflows/crawl.yml` (1시간 cron + `workflow_dispatch` + `curl --fail`). `CRON_SECRET` Bearer 인증, `crawlStateRepository.updateLastBoardId` 연결까지 완료                                                                                                                             | `src/app/api/cron/crawl/{route.ts, route.test.ts}` (인증 4종 + 정상 흐름 + 실패 케이스, 66개 그린), `.github/workflows/crawl.yml`, `.env.example`(`CRON_SECRET` 추가), `README.md`(운영 섹션 — 시크릿 등록 + 수동/로컬 트리거), `docs/learning/step8-gha-cron-vercel-trigger.md`. 결정 근거는 ADR 004                                                                                                 |
| 학습 정리      | Sprint 1 학습 문서 정책 정리 (PR #31 머지): `docs/learning/`을 "다른 프로젝트에도 가져갈 보편 패턴"만 보존하도록 통합. 청안 고유 판단(특정 사이트 응답 패턴, 매핑 정책, 단일행 트리비얼 필터 등)은 ADR/코드 주석으로 이관. CLAUDE.md에 정책 반영                                                                                                                      | `docs/learning/{step2-project-init, step4-crawling, step5-service-layer, step6-data-source-redesign}.md` 통합·삭제, `step4-{cheerio, vitest-basics, db-basics}.md` 신설, `step5-{fetch-html, msw-testing}.md`·`step7-*.md` 3종에서 청안 고유 절 제거. `step7-supabase-client.md`는 실제 `client.ts`와 정합 정정(싱글톤 캐시, 변수별 throw, autoRefreshToken 등). CLAUDE.md `docs/learning/` 정책 갱신 |
| ADR 001        | 기술 스택 선정 근거 문서화                                                                                                                                                                                                                                                                                                                                            | `docs/adr/001-tech-stack.md`                                                                                                                                                                                                                                                                                                                                                                          |
| ADR 002        | 크롤링 데이터 소스 전략 — 옵션 비교 + C(하이브리드) 채택                                                                                                                                                                                                                                                                                                              | `docs/adr/002-crawling-data-source.md`                                                                                                                                                                                                                                                                                                                                                                |
| ADR 003        | 저장 매핑 전략 — 옵션 B (저장 전 view.do 보강) 채택. ADR 002 옵션 C 하이브리드를 "JSON으로 신규 감지 + 모든 신규는 view.do로 detail 확보" 패턴으로 좁힘                                                                                                                                                                                                               | `docs/adr/003-storage-mapping-strategy.md`                                                                                                                                                                                                                                                                                                                                                            |
| ADR 004        | 크롤링 스케줄러 선택 — GitHub Actions 채택 (1시간 간격, Hobby 플랜 무료)                                                                                                                                                                                                                                                                                              | `docs/adr/004-scheduler-choice.md`                                                                                                                                                                                                                                                                                                                                                                    |
| Step 8 픽스    | 부트스트랩 정책 누락 픽스 (#36): 시드 `last_board_id=0` 상태에서 첫 cron 호출이 boardId 1~latestBoardId(현 6561) 전체 view.do로 catch-up하려다 109분 루프에 빠지던 문제. `crawlNewAnnouncements`에 `lastBoardId === 0` 부트스트랩 분기 추가 → latestBoardId만 저장하고 종료. 첫 호출 1초 안에 200 응답. 결정 근거는 ADR 005, 진단 과정·교훈은 트러블슈팅 노트 참조    | `docs/adr/005-crawl-bootstrap-policy.md`, `docs/troubleshooting/2026-06-09-cron-bootstrap-catch-up.md`, `src/lib/crawler/announcementService.ts`(분기 추가), `src/lib/crawler/announcementService.test.ts`(부트스트랩 케이스 1건, 67개 그린). 로컬 검증: 1차 호출 1020ms `{newCount:0, latestBoardId:6561}`, 2차 호출 172ms 정상 흐름                                                                 |
| ADR 005        | crawl_state 부트스트랩 정책 — 옵션 B(시드 0이면 catch-up 건너뛰고 latestBoardId만 저장) 채택. A(시드값 수동 갱신)/C(catch-up 상한)/D(최근 N건 점프) 대비                                                                                                                                                                                                              | `docs/adr/005-crawl-bootstrap-policy.md`                                                                                                                                                                                                                                                                                                                                                              |
| 운영 검증      | Vercel(`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`CRON_SECRET`) + GitHub Secrets(`CRON_SECRET`/`DEPLOY_URL`) 등록 후 GHA `workflow_dispatch` 2회 트리거. 1차(부트스트랩, 4.7s)·2차(정상 흐름, 3.3s) 모두 success, 응답 `{"newCount":0,"skippedBoardIds":[],"latestBoardId":6561}` 확인. DB의 `crawl_state.last_board_id`도 6561로 갱신 확인                          | Run #27188003052(1차) / #27188081204(2차). PR 없음(외부 시크릿 설정 + 운영 트리거)                                                                                                                                                                                                                                                                                                                    |
| Sprint 1 회고  | Phase 1 Sprint 1 (#11/#12/#13/#36) 종료 시점 회고 작성. 첫 회고 사례                                                                                                                                                                                                                                                                                                  | `docs/retrospectives/sprint-1.md`                                                                                                                                                                                                                                                                                                                                                                     |
| 크롤 동결 픽스 | 크롤 파이프라인 동결 해소 (#42, PR #45 머지·배포·검증). gap-fill 폐기 → 목록 기반 크롤 전환, `parseTotalPages` 페이지네이션 보전, `checkDetailInvariants` 게이트 + `invalidBoardIds` row별 격리. 프로덕션 500 → 200, 6564 저장·6563 자동 제외·`last_board_id` 6564 전진 확인. 결정 근거는 ADR 007                                                                     | `src/lib/crawler/{parseListJson.ts, announcementService.ts(+.test.ts)}`, `src/app/api/cron/crawl/{route.ts, route.test.ts}`, `docs/adr/007-crawl-scope.md`. 86 tests·tsc·eslint 그린                                                                                                                                                                                                                  |
| Step 9-a       | 웹 푸시 구독 클라이언트 경로 (#39, PR #47 머지): VAPID 공개키→Uint8Array 유틸 + Service Worker 등록(`public/sw.js`) + `usePushSubscription` 훅(SW 등록→권한→`PushManager.subscribe`, 기존 구독 복원·SSR 가드) + 임시 검증 UI(`/subscribe`). 실제 Chrome에서 구독→endpoint 생성 end-to-end 검증. 서버 저장은 9-b, 발송은 9-c 범위. 디자인은 Sprint 2 화면 확정 후 일괄 | `src/lib/push/urlBase64ToUint8Array.ts(+.test.ts)`, `public/sw.js`, `src/hooks/usePushSubscription.ts`, `src/components/push/PushSubscribeButton.tsx`, `src/app/subscribe/page.tsx`, `.env.example`(`NEXT_PUBLIC_VAPID_PUBLIC_KEY`), `.gitignore`(`.playwright-mcp/`). 91 tests·tsc·eslint·format 그린                                                                                                |

### Sprint 1 완료 — 다음 Sprint 2 시작 준비

크롤링 파이프라인 본체 + Supabase 저장 + 스케줄러 + 부트스트랩 픽스 + 운영 검증 + 회고까지 Sprint 1 종료. 다음은 PROJECT_PLAN의 **Sprint 2 — 알림 시스템 + 기본 UI**(Week 4-5).

### 다음 할 일 — Sprint 2 (PROJECT_PLAN 4-1 참조)

웹 푸시 파이프라인 (#39) 남은 Step:

- **9-b (다음)**: 구독 저장 API + DB 스키마 (`push_subscriptions`) — 9-a 훅이 반환한 구독을 저장
- 9-c: 발송 트리거(크롤 신규 감지와 연결) + `web-push` 통합 + `410 Gone` 만료 정리
- 9-d: Playwright E2E (구독 → 신규 공고 → 알림 수신)

이후 Sprint 2 나머지:

- 이메일 알림 구현 (Resend / SendGrid, 보조)
- 공고 목록 페이지 (Next.js SSG + ISR)
- 공고 상세 페이지 (동적 라우트 `[boardId]`)
- 위 화면 확정 후 UI 디자인 일괄 작업 (v0/Lovable 등)

마일스톤 = MVP 완성: 새 공고 → 크롤링 감지 → 구독자 알림 → 웹에서 확인.

#### 미해결 부수 의문 (운영에 영향 없음, 추후 확인)

- Next.js dev/turbopack이 109분짜리 핸들러를 약 3분(180초) 시점에 정상 200으로 logged한 메커니즘 — request body timeout, keepalive, 또는 다른 내부 타이머일 가능성. 부트스트랩 픽스로 더는 재현 안 됨

### 용어 매핑

HANDOFF의 "Step"은 `docs/PROJECT_PLAN.md`의 Phase 구조와 대응한다:

- Step 2–3 = Phase 0 (프로젝트 셋업)
- Step 4–5 = Phase 1 Sprint 1 (크롤링 파이프라인)

### 행동 지침

작업 중 자동 실행하지 말고 **권유만** 해야 하는 항목들은 `CLAUDE.md`의 "Claude 행동 지침" 섹션 참조 (커밋 전 브랜치 확인, ADR / Issue 생성 / 학습 문서 / 스프린트 회고 작성 권유 등).

---

## 1. 프로젝트 개요

- **프로젝트명**: 청안 (cheong-an)
- **한 줄 설명**: 청년안심주택 새 공고 알림 서비스 — 모집공고 모니터링 + 웹 푸시 알림
- **GitHub**: `ofekim0/cheong-an` (Public, MIT License)
- **목적**: 자기계발용 포트폴리오 (1순위) + 본인 실사용 서비스

---

## 2. 사용자 프로필

- 1년차 프론트엔드 개발자 (얼마니/Finelab, B2B 부동산 플랫폼)
- 현재 스택: React, TypeScript, Next.js (Pages Router), React Query, Zustand, Emotion
- 통계학 전공 (3년 이상 미사용)
- 서울 거주, 청년안심주택 실제 수요자

---

## 3. 완료된 작업 (Step 1 완료)

### 의사결정 완료 항목

| 항목            | 결정                             | 근거                                        |
| --------------- | -------------------------------- | ------------------------------------------- |
| 주제            | 청년안심주택 새 공고 알림 서비스 | 본인 실수요자, 기존에 전용 알림 서비스 없음 |
| 프로젝트명      | 청안 (cheong-an)                 | 청년안심주택 + 알림 줄임말                  |
| 알림 채널 (MVP) | 웹 푸시 + 이메일(보조)           | 카카오톡은 사업자등록 필요 → Phase 4로 연기 |
| 프로세스 방법론 | 스크럼 기반 경량 프로세스        | 1인 프로젝트에 맞게 경량화                  |
| 디자인 패턴     | 사전 확정 안 함                  | 필요 시 ADR로 기록                          |
| 패키지 매니저   | pnpm                             | 디스크 효율, 엄격한 의존성 관리, 설치 속도  |

### 크롤링 가능성 조사 (완료)

**데이터 소스**: https://soco.seoul.go.kr/youth/main/main.do

| 페이지                             | 렌더링 방식               | 크롤링 가능               |
| ---------------------------------- | ------------------------- | ------------------------- |
| 메인 페이지 (main.do)              | SSR — 최신 5건 HTML 포함  | ✅ HTTP GET               |
| 모집공고 리스트 (list.do)          | CSR — JS 동적 로딩        | ⚠️ AJAX 엔드포인트 미확인 |
| 개별 공고 상세 (view.do?boardId=N) | SSR — 전체 내용 HTML 포함 | ✅ boardId로 접근         |

**채택 전략**: 메인 페이지 모니터링 + boardId 연속성 보완

- 메인 페이지에서 최신 5건의 boardId 추출
- 마지막 확인 boardId와 비교하여 새 공고 감지
- boardId 범위 내 빈 번호는 상세 페이지 직접 fetch로 누락 방지

### 기존 서비스 조사 (완료 — 차별화 확인됨)

- 마이홈 앱: 청년안심주택이 별도 카테고리 없음, 지역 필터 시/도 단위까지만
- SH 청약알리미: 장기전세/국민임대/장기안심만 대상
- 청약홈: APT 분양 위주
- 결론: **청년안심주택 전용 알림 서비스는 현재 존재하지 않음**

### 레포 세팅 (완료)

GitHub 레포에 아래 파일들이 커밋되어 있음:

```
cheong-an/
├── README.md
├── .github/
│   ├── pull_request_template.md
│   └── ISSUE_TEMPLATE/
│       ├── feature.md
│       └── bug.md
└── docs/
    ├── PROJECT_PLAN.md          ← 전체 기획안 (WBS, 타임라인 포함)
    ├── PROCESS.md               ← 프로세스 + 방법론 + 컨벤션
    ├── CODING_CONVENTION.md     ← 코딩 컨벤션
    └── adr/
        └── ADR_TEMPLATE.md      ← ADR 작성 양식
```

---

## 4. 확정된 기술 스택

### 프론트엔드

| 기술                 | 선택 근거                                                                          |
| -------------------- | ---------------------------------------------------------------------------------- |
| Next.js (App Router) | 회사에서 Pages Router 사용 → App Router 전환. RSC, 병렬 라우트 학습. SSG/ISR 활용. |
| TypeScript           | 크롤링 데이터 타입 안전성                                                          |
| Tailwind CSS         | Emotion → Tailwind 전환. 번들 사이즈 최적화 (런타임 → 빌드타임)                    |
| Zustand              | persist middleware, selector 최적화 심화                                           |
| TanStack Query       | 공고 데이터 캐싱, 백그라운드 리프레시                                              |

### 백엔드 / 인프라

| 기술                         | 선택 근거                               |
| ---------------------------- | --------------------------------------- |
| Next.js Route Handlers       | 별도 백엔드 없이 크롤링/알림 API 구현   |
| Supabase                     | DB — 공고 데이터, 사용자 알림 설정 저장 |
| Vercel                       | 배포 + CI/CD                            |
| Vercel Cron / GitHub Actions | 주기적 크롤링 스케줄링                  |

### 테스트

| 도구       | 용도        |
| ---------- | ----------- |
| Vitest     | 단위 테스트 |
| Playwright | E2E 테스트  |
| MSW        | API 모킹    |

### 기타

| 도구           | 용도                                    |
| -------------- | --------------------------------------- |
| pnpm           | 패키지 매니저                           |
| GitHub Actions | CI 파이프라인 (lint, 타입 체크, 테스트) |
| Lighthouse CI  | 성능 측정 (Phase 3~)                    |
| Sentry         | 에러 모니터링 (Phase 3~)                |

---

## 5. 다음 단계 (Claude Code가 해야 할 것)

### Step 2: 프로젝트 초기화 (대부분 완료)

1. ~~**Next.js App Router 프로젝트 생성**~~ ✅
2. ~~**Prettier 설정**~~ ✅
3. ~~**husky + lint-staged 설정**~~ ✅
4. ~~**Vitest + Playwright 초기 설정**~~ ✅
5. **ADR 001 작성** ← 미완료
   - `docs/adr/001-tech-stack.md` — 기술 스택 선정 근거
   - ADR_TEMPLATE.md를 복사해서 작성

### Step 3: Vercel 연동 + CI ← 지금 여기부터

- Vercel에 레포 연결, 프리뷰 배포 확인
- GitHub Actions: lint + 타입 체크 + 테스트 파이프라인

### Step 4: DB 스키마 설계 + Supabase 연동

### Step 5: 크롤링 파이프라인 구현

### Step 6: 알림 시스템 + 기본 UI → MVP 완성

---

## 6. 주의사항

- **얼마니(회사)와 기술적 차별화 필수**: Pages Router → App Router, Emotion → Tailwind, 폼/테이블 → 크롤링+알림+시각화
- **모든 주요 기술 선택에 ADR 작성**: "왜?"를 문서화
- **테스트 코드 반드시 포함**: 바이브코딩과 차별화의 핵심
- **커밋 컨벤션 준수**: `<type>: <description>` (feat, fix, test, docs, chore, style, refactor, perf)
- **main 직접 push 금지**: 항상 브랜치 → PR → 머지
- **스코프 관리**: Phase 1 MVP 최우선 완성, 기능 욕심 자제
- **docs/CODING_CONVENTION.md 참고**: 폴더 구조, 네이밍, TypeScript 규칙 등 확정된 컨벤션 있음
- **docs/PROCESS.md 참고**: 브랜치 전략, 커밋 컨벤션, PR 규칙 등 확정된 프로세스 있음
