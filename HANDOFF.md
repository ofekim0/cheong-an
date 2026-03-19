# HANDOFF: 청안 프로젝트 — Claude Code 인계 문서

> 이 문서는 Claude.ai에서 진행한 기획/의사결정 세션의 결과물입니다.
> Claude Code는 이 문서를 기반으로 **Step 2: 프로젝트 초기화**부터 시작하면 됩니다.

---

## 1. 프로젝트 개요

- **프로젝트명**: 청안 (cheong-an)
- **한 줄 설명**: 청년안심주택 새 공고 알림 서비스 — 모집공고 모니터링 + 웹 푸시 알림
- **GitHub**: `ofekim0/cheong-an` (Public, MIT License)
- **목적**: 네카라쿠배 이직용 포트폴리오 (1순위) + 본인 실사용 서비스

---

## 2. 사용자 프로필

- 1년차 프론트엔드 개발자 (얼마니/Finelab, B2B 부동산 플랫폼)
- 현재 스택: React, TypeScript, Next.js (Pages Router), React Query, Zustand, Emotion
- 통계학 전공 (3년 이상 미사용)
- 서울 거주, 청년안심주택 실제 수요자

---

## 3. 완료된 작업 (Step 1 완료)

### 의사결정 완료 항목

| 항목 | 결정 | 근거 |
|---|---|---|
| 주제 | 청년안심주택 새 공고 알림 서비스 | 본인 실수요자, 기존에 전용 알림 서비스 없음 |
| 프로젝트명 | 청안 (cheong-an) | 청년안심주택 + 알림 줄임말 |
| 알림 채널 (MVP) | 웹 푸시 + 이메일(보조) | 카카오톡은 사업자등록 필요 → Phase 4로 연기 |
| 프로세스 방법론 | 스크럼 기반 경량 프로세스 | 1인 프로젝트에 맞게 경량화 |
| 디자인 패턴 | 사전 확정 안 함 | 필요 시 ADR로 기록 |
| 패키지 매니저 | pnpm | 디스크 효율, 엄격한 의존성 관리, 설치 속도 |

### 크롤링 가능성 조사 (완료)

**데이터 소스**: https://soco.seoul.go.kr/youth/main/main.do

| 페이지 | 렌더링 방식 | 크롤링 가능 |
|---|---|---|
| 메인 페이지 (main.do) | SSR — 최신 5건 HTML 포함 | ✅ HTTP GET |
| 모집공고 리스트 (list.do) | CSR — JS 동적 로딩 | ⚠️ AJAX 엔드포인트 미확인 |
| 개별 공고 상세 (view.do?boardId=N) | SSR — 전체 내용 HTML 포함 | ✅ boardId로 접근 |

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

| 기술 | 선택 근거 |
|---|---|
| Next.js (App Router) | 회사에서 Pages Router 사용 → App Router 전환. RSC, 병렬 라우트 학습. SSG/ISR 활용. |
| TypeScript | 크롤링 데이터 타입 안전성 |
| Tailwind CSS | Emotion → Tailwind 전환. 번들 사이즈 최적화 (런타임 → 빌드타임) |
| Zustand | persist middleware, selector 최적화 심화 |
| TanStack Query | 공고 데이터 캐싱, 백그라운드 리프레시 |

### 백엔드 / 인프라

| 기술 | 선택 근거 |
|---|---|
| Next.js Route Handlers | 별도 백엔드 없이 크롤링/알림 API 구현 |
| Supabase | DB — 공고 데이터, 사용자 알림 설정 저장 |
| Vercel | 배포 + CI/CD |
| Vercel Cron / GitHub Actions | 주기적 크롤링 스케줄링 |

### 테스트

| 도구 | 용도 |
|---|---|
| Vitest | 단위 테스트 |
| Playwright | E2E 테스트 |
| MSW | API 모킹 |

### 기타

| 도구 | 용도 |
|---|---|
| pnpm | 패키지 매니저 |
| GitHub Actions | CI 파이프라인 (lint, 타입 체크, 테스트) |
| Lighthouse CI | 성능 측정 (Phase 3~) |
| Sentry | 에러 모니터링 (Phase 3~) |

---

## 5. 다음 단계 (Claude Code가 해야 할 것)

### Step 2: 프로젝트 초기화 ← 지금 여기부터

1. **Next.js App Router 프로젝트 생성**
   - `pnpm create next-app` (App Router, TypeScript, Tailwind CSS, ESLint 선택)
   - src/ 디렉토리 사용
   - import alias `@/` 설정

2. **Prettier 설정**
   - prettier + prettier-plugin-tailwindcss 설치
   - ESLint와 Prettier 충돌 방지 설정 (eslint-config-prettier)

3. **husky + lint-staged 설정**
   - 커밋 전 lint + format 자동 실행

4. **Vitest + Playwright 초기 설정**
   - Vitest: 빈 테스트라도 실행 가능한 상태
   - Playwright: 설치 + 기본 설정

5. **ADR 001 작성**
   - `docs/adr/001-tech-stack.md` — 기술 스택 선정 근거
   - ADR_TEMPLATE.md를 복사해서 작성

### Step 3: Vercel 연동 + CI

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
