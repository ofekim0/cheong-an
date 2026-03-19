# CLAUDE.md

## 프로젝트 개요

청안(cheong-an) — 청년안심주택 새 공고 알림 서비스. 모집공고 모니터링 + 웹 푸시 알림.
GitHub: `ofekim0/cheong-an` (Public, MIT)

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

## 참고 문서

- `docs/PROJECT_PLAN.md` — WBS, 타임라인, 기능 정의
- `docs/PROCESS.md` — 브랜치 전략, 커밋 컨벤션, 스프린트 사이클
- `docs/CODING_CONVENTION.md` — 네이밍, TS 규칙, 테스트 규칙
- `docs/adr/` — Architecture Decision Records
