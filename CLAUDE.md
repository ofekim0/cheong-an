# CLAUDE.md

## 프로젝트 개요

청안(cheong-an) — 청년안심주택 새 공고 알림 서비스. 모집공고 모니터링 + 웹 푸시 알림.
GitHub: `ofekim0/cheong-an` (Public, MIT)

### 목적

- 자기계발용 포트폴리오 (1순위) + 본인 실사용 서비스
- 기존에 청년안심주택 전용 알림 서비스가 없어서 직접 만드는 프로젝트
- 상세: `docs/PROJECT_PLAN.md`

### 현재 진행 상황

휘발성 진척 추적은 `HANDOFF.md` § 0 (단일 출처). 전체 Phase·Sprint 계획은 `docs/PROJECT_PLAN.md`.

## 기술 스택

- **프론트엔드**: Next.js (App Router), TypeScript, Tailwind CSS, Zustand, TanStack Query
- **백엔드**: Next.js Route Handlers, Supabase
- **테스트**: Vitest, Playwright, MSW
- **CI/CD**: GitHub Actions, Vercel
- **패키지 매니저**: pnpm

## 컨벤션 (상세: docs/CODING_CONVENTION.md)

### 폴더 구조

```
src/
├── app/                    # Next.js App Router 페이지
│   ├── (routes)/           # 라우트 그룹
│   ├── api/                # Route Handlers
│   └── layout.tsx
├── components/
│   ├── ui/                 # 범용 UI 컴포넌트
│   └── [feature]/          # 기능별 컴포넌트
├── hooks/                  # 커스텀 훅
├── lib/                    # 유틸리티, 외부 라이브러리 래퍼
│   ├── crawler/            # 크롤링 관련 로직
│   ├── supabase/           # DB 클라이언트
│   └── utils/              # 범용 유틸리티
├── stores/                 # Zustand 스토어
├── types/                  # 공유 타입 정의
└── constants/              # 상수
```

### 네이밍

- 컴포넌트 파일: `PascalCase.tsx` (예: `AnnouncementCard.tsx`)
- 훅 파일: `camelCase.ts`, use 접두사 (예: `useAnnouncementFilter.ts`)
- 유틸리티/타입/상수 파일: `camelCase.ts`
- 테스트 파일: `원본파일명.test.ts(x)` — 원본과 같은 디렉토리에 배치
- 변수/함수: camelCase, 상수: UPPER_SNAKE_CASE, 컴포넌트/타입: PascalCase

### TypeScript

- 객체 형태 → `interface`, 유니온/유틸리티 → `type`
- 의도적 "값 없음" → `null`, 미초기화 → `undefined`
- Non-null assertion (`!`) 사용 금지

### React / Next.js

- 기본은 서버 컴포넌트. 클라이언트 필요 시에만 `'use client'`
- 클라이언트 경계를 최대한 말단으로 내림

### 스타일링

- Tailwind CSS + `cn()` 유틸리티 (clsx + twMerge)
- 반복 스타일은 컴포넌트로 추출

## Git 워크플로우 (상세: docs/PROCESS.md)

### 브랜치 전략

```
main              ← 배포 브랜치 (main 직접 push 금지)
  └── feat/*      ← 기능 개발
  └── fix/*       ← 버그 수정
  └── docs/*      ← 문서 작업
  └── chore/*     ← 설정, 의존성
```

### 커밋 컨벤션

```
<type>: <description>
```

type: feat, fix, test, docs, chore, style, refactor, perf

### 작업 플로우

Issue 생성 → 브랜치 생성 → 구현 → 테스트 작성 → PR → 리뷰 → CI 통과 → 머지

## 테스트 원칙

- 반드시 테스트: 크롤링 파서, boardId 감지 로직, 알림 필터 매칭, API Route 핸들러
- 테스트 안 해도 됨: UI 스타일링, 외부 라이브러리 동작, 단순 데이터 패스스루

## 주요 결정 사항

- ADR은 기술 스택 선택, 아키텍처 결정, 성능 최적화, 트레이드오프 판단 시 작성 (docs/adr/)
- 디자인 패턴은 사전 확정 안 함 — 필요 시 ADR로 기록
- 백엔드: 파서 / 서비스 / 핸들러 레이어 분리

## Claude 행동 지침

작업 중 아래 상황을 감지하면, 해당 문서 작성을 사용자에게 권유할 것. 자동으로 작성하지 말고 권유만 한다.

### 커밋 전 브랜치 확인 (필수)

`git commit` 실행 직전 반드시 `git branch --show-current`로 현재 브랜치를 확인한다. `main`이면 즉시 중단하고 사용자에게 알린 뒤, 적절한 작업 브랜치(`feat/*`, `fix/*`, `docs/*`, `chore/*`)로 전환한 후 진행한다. PR이 머지되면 로컬이 자동으로 main으로 전환되는 경우가 있어 특히 주의한다.

### ADR 작성 권유

다음 상황에서 권유: "이 결정은 ADR로 기록해두면 좋겠습니다. 작성할까요?"

- 새 라이브러리나 프레임워크 도입을 논의하거나 결정할 때
- 아키텍처 구조(폴더 구조, 상태 관리 방식 등)를 변경할 때
- 두 가지 이상 선택지를 비교하고 트레이드오프를 판단할 때
- 성능 최적화 방향을 결정할 때
- 양식: `docs/adr/ADR_TEMPLATE.md`

### Step 세분화 권유

Sprint 내 한 작업 단위(예: "Supabase 연동", "스케줄러 구현")가 PR 1건으로 처리하기에 크다고 판단되면 권유: "이 작업을 Step N-a/b/c로 쪼개서 진행할까요?"

판단 기준 (둘 이상 충족 시 권유):

- 변경 파일 수 ~10개 이상 예상
- 독립적으로 머지 가능한 하위 단위가 2개 이상 식별됨 (예: 유틸리티 / 합성 레이어 / 통합 테스트)
- 본 구현과 테스트 백필·학습 문서·후속 정리가 분리 가능
- 한 PR로 묶으면 리뷰 부담이 크거나 롤백 단위가 커짐

운영 방식:

- 쪼갠 단위는 HANDOFF.md의 "완료된 Step" 표에 `Step N-a`, `Step N-b` 형태로 기록
- 각 하위 Step은 별도 브랜치·별도 PR로 처리하는 것을 기본으로 함
- 선례: `Step 5-a` (fetchHtml + retry) → `5-b` (rateLimit) → `5-c` (announcementService 합성) → `5-d` (MSW 통합 테스트)

### GitHub Issue 생성 권유

다음 상황에서 권유: "이 작업에 대한 GitHub Issue가 있나요? 없다면 먼저 생성할까요?"

- 새 기능 구현을 시작하려 할 때 (관련 Issue 없이 바로 구현 요청이 들어온 경우)
- 코드 수정 중 버그를 발견했거나, 버그로 판명된 문제를 수정할 때
- 기능 이슈 양식: `.github/ISSUE_TEMPLATE/feature.md`
- 버그 이슈 양식: `.github/ISSUE_TEMPLATE/bug.md`

### PR 작성 시

PR 생성을 요청받으면 `.github/pull_request_template.md` 양식에 맞춰 작성한다.

### HANDOFF.md 갱신 권유

`HANDOFF.md`는 "현재 어디까지 왔나"를 담당하는 휘발성 스냅샷이다.
다음 상황에서 권유: "HANDOFF.md의 '0. 최신 상태' 섹션이 뒤처졌습니다. 갱신할까요?"

- PR을 머지한 직후 (이 세션에서 머지를 수행했을 때)
- 새 작업을 시작하려 할 때, HANDOFF의 "0. 최신 상태"가 최근 머지된 PR을 반영하지 않은 것을 감지한 경우
- HANDOFF의 "다음 할 일" 항목 중 하나가 완료됐을 때
- 새 Step 또는 Phase로 진입하는 시점
- 갱신 대상: "0. 최신 상태" 섹션의 완료 Step 표, 진행 중, 다음 할 일

### 학습 정리 문서 권유

새 기술 개념(라이브러리, 외부 API, 아키텍처 패턴, 인프라/CI 설정 등)을 처음 사용·적용·변경했을 때 권유한다.
단순 버그 수정, 문서 수정, 스타일 변경에는 권유하지 않는다.

다음 상황에서 권유: "이번 작업에서 새로 사용한 기술 개념이 있습니다. 학습 정리 문서를 작성할까요?"

- **작업 중**: 새 라이브러리·외부 API를 처음 연동했을 때, 또는 새로운 아키텍처 패턴/설계 방식을 적용했을 때, 또는 인프라·배포·CI 설정을 변경했을 때
- **PR 생성 시**: 해당 브랜치에서 새 기술 개념이 도입됐지만 아직 학습 문서가 없는 경우
- **백필**: 최근 머지된 PR(또는 git log)에서 새 기술 개념이 식별되는데 해당 학습 정리가 누락된 것을 감지했을 때
- 파일명 형식: `docs/learning/stepN-*.md` (예: `docs/learning/step5-retry.md`)
- **범위**: 학습 문서는 "다른 프로젝트에도 가져갈 보편 패턴"만 담는다. 청안 고유 판단(특정 사이트 응답 패턴, 매핑 정책, 단일행 트리비얼 필터 같은 코드-국지적 의사결정)은 ADR 또는 코드 주석으로 이관한다
- 참고: 기존 학습 정리 문서는 `docs/learning/` 디렉토리에 정리되어 있음

### 스프린트 회고 권유

다음 상황에서 권유: "스프린트 회고를 작성할 타이밍입니다. 작성할까요?"

- HANDOFF의 "0. 최신 상태"에 명시된 현재 Sprint의 "다음 할 일" 항목이 모두 완료됐을 때
- 새 Sprint 또는 새 Phase로 진입하는 직전 시점
- 사용자가 "Sprint 마무리", "회고", "스프린트 종료" 같은 표현을 사용할 때
- 양식: `docs/retrospectives/TEMPLATE.md`

## 참고 문서

- `docs/PROJECT_PLAN.md` — WBS, 타임라인, 기능 정의
- `docs/PROCESS.md` — 브랜치 전략, 커밋 컨벤션, 스프린트 사이클
- `docs/CODING_CONVENTION.md` — 네이밍, TS 규칙, 테스트 규칙
- `docs/adr/` — Architecture Decision Records
- `docs/retrospectives/` — 스프린트 회고
