# HANDOFF: 청안 프로젝트 — Claude Code 인계 문서

> 이 문서는 Claude.ai에서 진행한 기획/의사결정 세션의 결과물입니다.
> **2~10장은 Step 1 인계 시점의 스냅샷**이며, 이후 진척은 아래 "0. 최신 상태"에 갱신합니다.

---

## 0. 최신 상태 (2026-06-25 기준)

### 진행 중 — Sprint 2 웹 푸시 알림 (#39) + 소셜 로그인 신규 편입

Sprint 2 1번 작업(웹 푸시 파이프라인, #39)을 Step(9-a~d)으로 쪼개 진행 중. **9-a 완료·머지**(PR #47): VAPID 유틸 + Service Worker 등록 + 구독 훅 + 임시 검증 UI까지 클라이언트 구독 경로 완성, 실제 Chrome에서 구독→endpoint 생성 end-to-end 검증.

**방향 전환(2026-06-25)**: 9-b 설계 중 서비스를 **로그인 사용자 기준**으로 운영하기로 결정 — 구독·발송·필터를 처음부터 `user_id`로 묶는다. 익명으로 먼저 만들면 나중에 user 연결 마이그레이션 + 고아 구독 정리로 두 번 일하므로, 순서를 바꿔 **소셜 로그인을 9-b 앞에 신규 편입**한다(근거: **ADR 009**). 이에 따라 ADR 008은 익명 → user 연결 모델로 **재작성**했고(`user_id` FK + RLS, endpoint UNIQUE·`410 Gone`은 유지), PROJECT_PLAN Sprint 2에 로그인을 편입했다(#50). 소셜 로그인은 50-a(SSR 기반)·50-b(로그인 UI + 게이팅)로 분할했고 **50-a 완료**(PR #52). 학습 문서(`docs/learning/step9-web-push.md`)는 발송까지 완결되는 9-c 시점에, `@supabase/ssr` SSR 패턴 학습 문서는 50 마무리 시점에 작성 예정.

### ✅ 해소됨 — 크롤 파이프라인 동결 (Issue #42, 2026-06-18)

매시간 HTTP 500으로 동결됐던 크롤 파이프라인을 PR #45로 해소(프로덕션 500→200, DB 저장 검증). 근본 원인(boardId가 여러 게시판이 공유하는 전역 시퀀스 → gap-fill이 타 게시판 불량 row를 끌어와 배치 upsert 전체 실패)과 수정(gap-fill 폐기 → 목록 기반 크롤 전환)은 **ADR 007** 및 `docs/troubleshooting/2026-06-09-cron-bootstrap-catch-up.md`에 상세.

### 완료된 Step

| Step           | 내용                                                                                                                                     | 근거·산출물                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Step 2         | Next.js 초기화, Prettier/husky/lint-staged, Vitest/Playwright                                                                            | `learning/step2-essentials`                                                                         |
| Step 3         | Vercel 연동 + GitHub Actions CI (lint·tsc·test)                                                                                          | `learning/step3-ci-setup`                                                                           |
| Step 4         | 크롤 파서 + DB 스키마 + 타입                                                                                                             | `learning/step4-{cheerio,vitest-basics,db-basics}` (※ `parseMainPage`·`checkBoardId`는 Step 6 폐기) |
| Step 5-a~d     | fetch+retry / rateLimit / `announcementService` 합성 / MSW 통합테스트                                                                    | `learning/step5-{fetch-html,retry,rate-limit,msw-testing}`                                          |
| Step 6         | 데이터 소스 재설계: JSON 목록(주) + view.do 하이브리드 (epic #19)                                                                        | ADR 002/003; PR #20~23·#25                                                                          |
| Step 6 정리    | `checkBoardId` 모듈 실제 삭제 + 이슈 본문 정리                                                                                           | PR #27                                                                                              |
| Step 7         | Supabase 저장 통합: admin 클라 + `announcements` UPSERT + `crawl_state` 리포                                                             | `learning/step7-*`; PR #29·#30                                                                      |
| Step 8         | 크롤 스케줄러: `/api/cron/crawl` + `crawl.yml` (1h cron + dispatch), `CRON_SECRET` 인증                                                  | ADR 004; `learning/step8-gha-cron-vercel-trigger`; PR #35                                           |
| Step 8 픽스    | 부트스트랩 catch-up 루프 픽스 — 시드 0이면 latestBoardId만 저장 (#36)                                                                    | ADR 005; `troubleshooting/2026-06-09-cron-bootstrap-catch-up`                                       |
| 크롤 동결 픽스 | 동결 해소 (#42): gap-fill 폐기 → 목록 기반 크롤, 페이지네이션 보전, row별 격리. 프로덕션 500→200 검증                                    | ADR 007; PR #43·#45                                                                                 |
| Step 9-a       | 웹 푸시 구독 클라 경로 (#39): VAPID 유틸 + SW 등록 + `usePushSubscription` 훅 + 임시 `/subscribe` UI. Chrome E2E 검증                    | PR #47 (서버 저장 9-b·발송 9-c)                                                                     |
| Step 50-a      | 소셜 로그인 SSR 기반 (#50): `@supabase/ssr` browser/server 클라 + 세션 미들웨어 + OAuth 콜백 라우트. typecheck/lint/96 tests (정적·단위) | ADR 009; PR #52 (로그인 UI·게이팅 50-b)                                                             |
| 운영·회고      | Sprint 1 운영 검증 (GHA dispatch 2회 success, `last_board_id` 6561 갱신) + Sprint 1 회고                                                 | `retrospectives/sprint-1`                                                                           |

> ADR 전체: `docs/adr/` — 001 기술스택, 002/003 데이터소스·매핑, 004 스케줄러, 005 부트스트랩, 006 크롤 출력 검증, 007 크롤 범위, 008 구독 저장 모델(user 연결), 009 소셜 로그인.

### Sprint 1 완료 — 다음 Sprint 2 시작 준비

크롤링 파이프라인 본체 + Supabase 저장 + 스케줄러 + 부트스트랩 픽스 + 운영 검증 + 회고까지 Sprint 1 종료. 다음은 PROJECT_PLAN의 **Sprint 2 — 알림 시스템 + 기본 UI**(Week 4-5).

### 다음 할 일 — Sprint 2 (PROJECT_PLAN 4-1 참조)

웹 푸시 파이프라인 (#39) 남은 Step (로그인 편입으로 재배열):

- **소셜 로그인 50-b (다음 · #50)**: 구글·카카오 로그인/로그아웃 UI(`signInWithOAuth({ provider })`) + `/subscribe`·`PushSubscribeButton` 비로그인 게이팅. 50-a(SSR 기반: 클라·미들웨어·콜백)는 **PR #52**로 완료 — 그 위에 얹는다. 범위·근거 **ADR 009**.
  - **외부 선결(50-b E2E 전제, 사용자 작업)**: Supabase 대시보드 Google·Kakao provider 활성화 + client_id/secret + redirect allow-list / 구글·카카오 콘솔 OAuth 앱 등록 / env `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY` 주입(로컬 + Vercel). 미설정이어도 코드·단위 테스트는 진행 가능.
- 9-b: 구독 저장 API + DB 스키마 (`push_subscriptions`) — `user_id` FK(NOT NULL) + endpoint UNIQUE + RLS. `POST /api/push/subscribe`는 세션에서 `user_id` 도출(비로그인 401). 모델·근거 **ADR 008**.
- 9-c: 발송 트리거(크롤 신규 감지와 연결) + `web-push` 통합 + `WHERE user_id`로 사용자 구독 조회 + `410 Gone` 만료 정리
- 9-d: Playwright E2E (로그인 → 구독 → 신규 공고 → 알림 수신)

**9-a 머지 코드 부채(로그인 편입에 따른 재작업)**: `usePushSubscription` 훅·`urlBase64ToUint8Array`·`sw.js`는 인증과 분리돼 무변경 재사용. `/subscribe` 페이지·`PushSubscribeButton`만 비로그인 시 로그인 유도로 게이팅 필요(표현 계층 한정).

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
