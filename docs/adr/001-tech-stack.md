# ADR 001: 기술 스택 선정

- **상태**: 수락됨
- **작성일**: 2026-03-19

## 맥락

이직용 포트폴리오 프로젝트로, 현 직장(얼마니/Finelab)의 기술 스택과 명확히 차별화되면서도 프론트엔드 엔지니어링 역량을 증명할 수 있는 스택이 필요했다.

현 직장 스택: Next.js (Pages Router), Emotion, React Query, Zustand, 테스트 없음, Vercel 배포

## 고려한 선택지

### 프레임워크: Next.js App Router vs Pages Router vs Remix vs Astro

#### Next.js App Router

- 장점: RSC(React Server Components) 활용, 병렬 라우트, Pages Router와의 차이를 직접 비교 가능, 업계 채택률 높음
- 단점: 비교적 새로운 패러다임, 학습 곡선

#### Pages Router (현 직장과 동일)

- 장점: 익숙함, 빠른 개발
- 단점: 포트폴리오 차별화 불가

#### Remix

- 장점: 웹 표준 기반, 좋은 DX
- 단점: 채택률 낮음, Next.js 대비 면접 어필 약함

#### Astro

- 장점: 콘텐츠 사이트에 최적
- 단점: 이 프로젝트는 동적 기능(알림, 크롤링)이 핵심이라 부적합

### 스타일링: Tailwind CSS vs Emotion (현 직장) vs vanilla-extract vs CSS Modules

#### Tailwind CSS

- 장점: 빌드타임 CSS로 런타임 오버헤드 제거, 번들 사이즈 감소 측정 가능, 업계 채택률 높음
- 단점: 클래스 길어짐 (cn 유틸리티로 해결)

#### Emotion (현 직장과 동일)

- 장점: 익숙함, 동적 스타일링 편리
- 단점: 런타임 CSS-in-JS, 번들 사이즈 증가, RSC 미지원, 차별화 불가

#### vanilla-extract

- 장점: 타입 안전 CSS, 빌드타임 처리
- 단점: 채택률 낮음, 학습 비용 대비 어필 약함

### 상태 관리: Zustand 유지

현 직장에서도 사용 중이나, persist middleware·selector 최적화 등 심화 패턴을 적용하여 깊이를 보여주는 방향으로 결정. 별도 라이브러리 전환보다 동일 도구의 깊이 있는 활용이 더 실용적.

### 데이터 페칭: TanStack Query 유지

공고 데이터 캐싱, 백그라운드 리프레시, stale-while-revalidate 패턴이 이 프로젝트의 핵심 요구사항과 정확히 맞음. 현 직장에서 React Query로 사용 중이며, 심화 활용으로 차별화.

### 백엔드: Next.js Route Handlers vs 별도 서버 (Express/Fastify)

#### Next.js Route Handlers

- 장점: 프론트엔드와 동일 코드베이스, 배포 단순화, Vercel과 자연스러운 통합
- 단점: 복잡한 백엔드 로직에는 한계

#### 별도 서버

- 장점: 백엔드 아키텍처 자유도
- 단점: 인프라 관리 부담, 프론트엔드 포트폴리오 목적에 과도

이 프로젝트의 백엔드 요구사항(크롤링 트리거, 알림 발송)은 Route Handlers로 충분.

### DB: Supabase vs PlanetScale vs 직접 PostgreSQL

#### Supabase

- 장점: 무료 티어 충분, PostgreSQL 기반, 실시간 구독, Auth 내장, 빠른 셋업
- 단점: 벤더 종속

#### PlanetScale

- 장점: MySQL 기반, 브랜칭
- 단점: 무료 티어 제한적 (2024년 이후 변경)

#### 직접 PostgreSQL

- 장점: 완전한 제어
- 단점: 인프라 관리 부담, 1인 사이드 프로젝트에 과도

### 테스트: Vitest + Playwright + MSW vs Jest + Cypress

#### Vitest + Playwright + MSW

- 장점: Vite 기반 빠른 실행, Playwright의 안정적 크로스 브라우저 테스트, MSW로 네트워크 레벨 모킹
- 단점: Vitest는 Jest 대비 생태계 약간 작음

#### Jest + Cypress

- 장점: 성숙한 생태계
- 단점: Jest는 ESM 설정 번거로움, Cypress는 크로스 브라우저 지원 약함

### 패키지 매니저: pnpm vs npm vs yarn

#### pnpm

- 장점: 디스크 효율(하드링크), 엄격한 의존성 관리(phantom dependency 방지), 설치 속도
- 단점: 일부 레거시 패키지 호환 이슈 가능

### 배포: Vercel vs Netlify vs AWS

#### Vercel

- 장점: Next.js 공식 지원, Cron Jobs 내장, 프리뷰 배포, 무료 티어 충분
- 단점: 벤더 종속

## 결정

Next.js App Router + TypeScript + Tailwind CSS + Zustand + TanStack Query + Supabase + Vercel + Vitest + Playwright + MSW + pnpm

## 근거

**차별화 우선**: 현 직장 스택과 겹치는 부분(Zustand, TanStack Query)은 심화 활용으로, 나머지는 명확한 전환(Pages→App Router, Emotion→Tailwind)으로 차별화한다.

**실용성**: 1인 사이드 프로젝트에서 관리 가능한 복잡도를 유지하면서, 면접에서 "왜?"를 설명할 수 있는 선택을 했다. 별도 백엔드 서버나 직접 인프라 관리는 프론트엔드 포트폴리오 목적에 과도하다고 판단했다.

**측정 가능한 개선**: Emotion→Tailwind 전환에서 번들 사이즈 변화를 측정하여 정량적 근거를 확보할 수 있다. Lighthouse CI로 성능 추이를 추적한다.

## 결과

- App Router의 RSC, 병렬 라우트 등 새 패러다임 학습이 필요하다
- Tailwind CSS의 유틸리티 퍼스트 접근법에 적응해야 한다
- Supabase/Vercel 벤더 종속이 생기나, 이 프로젝트 규모에서는 수용 가능하다
- 테스트 코드 작성 습관을 처음부터 잡아야 한다
