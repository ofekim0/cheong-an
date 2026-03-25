# Step 2: 프로젝트 초기화 — 작업 기록 및 학습 노트

> **브랜치**: `chore/project-init`
> **작업일**: 2026-03-24
> **목적**: Next.js App Router 프로젝트 생성, 코드 품질 도구 설정, 테스트 환경 구축

---

## 목차

1. [실행한 명령어 전체 흐름](#1-실행한-명령어-전체-흐름)
2. [설치된 라이브러리 해설](#2-설치된-라이브러리-해설)
3. [생성/수정된 파일 해설](#3-생성수정된-파일-해설)
4. [생성된 폴더 구조 해설](#4-생성된-폴더-구조-해설)
5. [package.json scripts 해설](#5-packagejson-scripts-해설)
6. [설정 파일 간의 관계도](#6-설정-파일-간의-관계도)
7. [자주 나오는 개념 정리](#7-자주-나오는-개념-정리)

---

## 1. 실행한 명령어 전체 흐름

### 1-1. 브랜치 생성

```bash
git checkout -b chore/project-init
```

- main에 직접 push하지 않는 규칙에 따라 작업 브랜치를 먼저 생성한다.
- `chore/*`는 기능이 아닌 설정/환경 작업에 사용하는 브랜치 접두사다.

### 1-2. Next.js 프로젝트 생성

```bash
pnpm create next-app . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --no-git
```

| 플래그                 | 의미                                            |
| ---------------------- | ----------------------------------------------- |
| `--typescript`         | TypeScript 템플릿 사용                          |
| `--tailwind`           | Tailwind CSS 포함                               |
| `--eslint`             | ESLint 기본 설정 포함                           |
| `--app`                | App Router 사용 (Pages Router 대신)             |
| `--src-dir`            | 소스 코드를 `src/` 하위에 배치                  |
| `--import-alias "@/*"` | `@/components/...` 같은 절대 경로 임포트 활성화 |
| `--use-pnpm`           | pnpm을 패키지 매니저로 사용                     |
| `--no-git`             | git init 생략 (이미 git 레포이므로)             |

> **참고**: 이미 파일이 있는 디렉토리에서는 `create-next-app`이 충돌 에러를 낸다.
> 그래서 임시 디렉토리에 생성한 뒤 필요한 파일만 복사하는 우회 방법을 사용했다.

### 1-3. 개발 도구 일괄 설치

```bash
pnpm add -D prettier prettier-plugin-tailwindcss eslint-config-prettier husky lint-staged vitest @vitejs/plugin-react playwright @playwright/test msw
```

- `pnpm add -D`는 `devDependencies`에 추가한다. 개발 시에만 필요하고 프로덕션 빌드에는 포함되지 않는 도구들이다.
- 한 번에 설치하면 의존성 해석(resolution)을 한 번만 수행하므로 개별 설치보다 빠르다.

### 1-4. 추가 의존성 설치

```bash
pnpm add -D jsdom @vitest/runner   # Vitest의 브라우저 DOM 시뮬레이션 환경
pnpm add clsx tailwind-merge        # cn() 유틸리티에 필요한 런타임 의존성
```

- `pnpm add` (플래그 없음)는 `dependencies`에 추가한다. 프로덕션 번들에 포함되는 라이브러리다.
- `clsx`와 `tailwind-merge`는 실제 앱 코드에서 사용하므로 `dependencies`에 넣는다.

### 1-5. husky 초기화

```bash
pnpm exec husky init
```

- `.husky/` 디렉토리와 기본 훅 파일을 생성한다.
- `pnpm exec`는 `node_modules/.bin/`에 설치된 CLI를 실행하는 명령어다.
- `package.json`에 `"prepare": "husky"` 스크립트가 있으면, `pnpm install` 시 자동으로 husky가 초기화된다.

### 1-6. 검증 명령어

```bash
pnpm typecheck    # TypeScript 타입 체크
pnpm lint         # ESLint 정적 분석
pnpm test         # Vitest 단위 테스트
pnpm build        # Next.js 프로덕션 빌드
pnpm format       # Prettier 코드 포맷팅
```

---

## 2. 설치된 라이브러리 해설

### dependencies (프로덕션에 포함)

| 라이브러리         | 버전   | 역할                                                                          |
| ------------------ | ------ | ----------------------------------------------------------------------------- |
| **next**           | 16.2.1 | React 기반 풀스택 프레임워크. App Router, SSR/SSG/ISR, Route Handlers 등 제공 |
| **react**          | 19.2.4 | UI 라이브러리. 컴포넌트 기반 선언적 UI 구축                                   |
| **react-dom**      | 19.2.4 | React를 브라우저 DOM에 렌더링하는 바인딩                                      |
| **clsx**           | 2.1.1  | 조건부 className 문자열 결합 유틸리티. `clsx('a', false && 'b')` → `'a'`      |
| **tailwind-merge** | 3.5.0  | 충돌하는 Tailwind 클래스를 지능적으로 병합. `twMerge('px-2 px-4')` → `'px-4'` |

### devDependencies (개발 시에만 사용)

#### 코드 품질 도구

| 라이브러리                      | 역할                                                                                                                    |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **typescript**                  | JavaScript에 정적 타입을 추가하는 언어. 컴파일러(`tsc`)를 통해 타입 체크                                                |
| **eslint**                      | JavaScript/TypeScript 정적 분석 도구. 코드에서 잠재적 버그, 안티패턴을 탐지                                             |
| **eslint-config-next**          | Next.js 전용 ESLint 규칙 모음. Core Web Vitals 관련 규칙 포함                                                           |
| **eslint-config-prettier**      | ESLint와 Prettier가 충돌하는 규칙을 비활성화. 포맷팅은 Prettier에 위임하고, ESLint는 로직 분석에만 집중하게 만드는 역할 |
| **prettier**                    | 코드 포맷터. 들여쓰기, 따옴표, 세미콜론 등 스타일을 자동 통일                                                           |
| **prettier-plugin-tailwindcss** | Tailwind 클래스 순서를 공식 권장 순서대로 자동 정렬                                                                     |

#### Git 훅

| 라이브러리      | 역할                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| **husky**       | Git 훅을 쉽게 관리하는 도구. `.husky/pre-commit` 파일에 정의한 스크립트를 `git commit` 직전에 자동 실행     |
| **lint-staged** | Git에 staged된 파일(= `git add`한 파일)에만 lint/format을 실행. 전체 프로젝트 대신 변경분만 검사하므로 빠름 |

#### 테스트

| 라이브러리               | 역할                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **vitest**               | Vite 기반 단위 테스트 러너. Jest 호환 API(`describe`, `it`, `expect`)를 제공하면서 ESM 네이티브 지원             |
| **@vitejs/plugin-react** | Vitest에서 JSX/TSX를 변환하기 위한 플러그인. React 컴포넌트 테스트에 필요                                        |
| **@vitest/runner**       | Vitest의 테스트 실행 엔진. vitest의 피어 디펜던시                                                                |
| **jsdom**                | 브라우저 없이 DOM API를 시뮬레이션하는 라이브러리. Vitest가 `document`, `window` 등을 사용할 수 있게 해줌        |
| **@playwright/test**     | E2E(End-to-End) 테스트 프레임워크. 실제 브라우저(Chromium/Firefox/WebKit)를 자동 조작하여 사용자 시나리오를 검증 |
| **playwright**           | Playwright 브라우저 엔진 바이너리. `@playwright/test`가 내부적으로 사용                                          |
| **msw**                  | Mock Service Worker. 네트워크 레벨에서 API 요청을 가로채서 모킹. 실제 서버 없이 API 응답을 시뮬레이션            |

#### 빌드 도구

| 라이브러리               | 역할                                                                          |
| ------------------------ | ----------------------------------------------------------------------------- |
| **tailwindcss**          | 유틸리티 퍼스트 CSS 프레임워크. `class="flex items-center"` 방식으로 스타일링 |
| **@tailwindcss/postcss** | Tailwind CSS v4의 PostCSS 플러그인. 빌드 시 CSS를 처리                        |

#### 타입 정의

| 라이브러리           | 역할                                                           |
| -------------------- | -------------------------------------------------------------- |
| **@types/node**      | Node.js API(`path`, `fs`, `process` 등)의 TypeScript 타입 정의 |
| **@types/react**     | React API(`useState`, `useEffect`, `JSX` 등)의 타입 정의       |
| **@types/react-dom** | ReactDOM API(`createRoot`, `hydrateRoot` 등)의 타입 정의       |

> **`@types/*` 패키지란?**
> JavaScript로 작성된 라이브러리에 TypeScript 타입 정보를 추가하는 패키지다.
> DefinitelyTyped 커뮤니티에서 관리한다.
> React, Node.js처럼 JS로 작성되었지만 TS 프로젝트에서 쓸 때 필요하다.

---

## 3. 생성/수정된 파일 해설

### 3-1. Next.js가 생성한 파일

#### `package.json`

프로젝트의 메타데이터, 의존성 목록, 실행 스크립트를 정의하는 파일.

```jsonc
{
  "name": "cheong-an",       // 프로젝트 이름
  "version": "0.1.0",        // 시맨틱 버전
  "private": true,           // npm에 공개 배포 방지
  "scripts": { ... },        // `pnpm <script-name>`으로 실행할 명령어들
  "dependencies": { ... },   // 프로덕션에 필요한 패키지
  "devDependencies": { ... } // 개발 시에만 필요한 패키지
}
```

#### `tsconfig.json` — TypeScript 컴파일러 설정

```jsonc
{
  "compilerOptions": {
    "target": "ES2017", // 컴파일 결과물의 JS 버전
    "lib": ["dom", "dom.iterable", "esnext"], // 사용할 수 있는 내장 API 타입
    "strict": true, // 엄격한 타입 체크 모드 (nullcheck, noImplicitAny 등)
    "noEmit": true, // JS 파일을 실제로 생성하지 않음 (Next.js가 빌드를 담당)
    "module": "esnext", // ES Module 사용
    "moduleResolution": "bundler", // 번들러(Next.js/Vite) 방식으로 모듈 해석
    "jsx": "react-jsx", // JSX를 React 17+ 방식으로 변환 (import React 불필요)
    "incremental": true, // 이전 빌드 결과를 캐시하여 재빌드 속도 향상
    "paths": {
      "@/*": ["./src/*"], // @/로 시작하는 경로를 src/로 매핑
    },
  },
}
```

> **`noEmit: true`인데 왜 tsconfig가 필요한가?**
> Next.js는 자체 컴파일러(SWC/Turbopack)로 TS → JS 변환을 처리한다.
> tsconfig는 "어떤 규칙으로 타입을 체크할 것인가"의 설정이지, "JS를 생성하라"는 설정이 아니다.
> `pnpm typecheck` (= `tsc --noEmit`) 실행 시 이 설정을 읽어 타입 체크만 수행한다.

#### `next.config.ts` — Next.js 앱 설정

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* 필요 시 여기에 Next.js 설정 추가 */
};

export default nextConfig;
```

현재는 비어 있다. 향후 `images.domains`, `redirects`, `headers` 등을 추가하게 된다.

#### `postcss.config.mjs` — PostCSS 설정

```javascript
const config = {
  plugins: {
    '@tailwindcss/postcss': {}, // Tailwind CSS v4를 PostCSS 플러그인으로 등록
  },
};
export default config;
```

- **PostCSS**는 CSS를 변환하는 도구 체인이다. CSS 파일을 읽고 → 플러그인이 가공하고 → 결과를 출력한다.
- Tailwind CSS는 PostCSS 플러그인으로 동작한다. `@import 'tailwindcss'`를 만나면 유틸리티 클래스를 생성한다.
- Next.js는 빌드 시 자동으로 이 파일을 읽어 PostCSS를 적용한다.

#### `src/app/globals.css` — 전역 스타일

```css
@import 'tailwindcss'; /* Tailwind CSS v4 진입점. 모든 유틸리티 클래스를 사용 가능하게 함 */

:root {
  --background: #ffffff; /* CSS 커스텀 속성(변수) 정의 */
  --foreground: #171717;
}

@theme inline {
  /* Tailwind v4 문법: CSS 변수를 Tailwind 테마로 등록 */
  --color-background: var(--background); /* bg-background 클래스로 사용 가능 */
  --color-foreground: var(
    --foreground
  ); /* text-foreground 클래스로 사용 가능 */
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

@media (prefers-color-scheme: dark) {
  /* 시스템 다크모드일 때 변수 오버라이드 */
  :root {
    --background: #0a0a0a;
    --foreground: #ededed;
  }
}
```

> **Tailwind CSS v4의 변화**:
> v3까지는 `tailwind.config.js`에서 테마를 설정했지만, v4부터는 CSS 파일 안에서
> `@theme` 지시자로 직접 정의한다. 설정 파일이 CSS 안으로 통합된 것이 핵심 변화.

#### `src/app/layout.tsx` — 루트 레이아웃 (수정됨)

```tsx
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google'; // Next.js 폰트 최적화
import './globals.css';

// next/font는 빌드 타임에 폰트를 다운로드하고 셀프 호스팅한다.
// 런타임에 Google Fonts CDN 요청이 발생하지 않으므로 성능 + 프라이버시에 유리.
const geistSans = Geist({
  variable: '--font-geist-sans', // CSS 변수로 주입
  subsets: ['latin'],
});

// metadata 객체를 export하면 Next.js가 <head>에 메타 태그를 자동 생성한다.
export const metadata: Metadata = {
  title: '청안 — 청년안심주택 새 공고 알림',
  description: '청년안심주택 모집공고를 모니터링하고 새 공고를 알려드립니다.',
};

// App Router에서 layout.tsx는 모든 페이지를 감싸는 공통 껍데기다.
// 이 파일의 <html>, <body>는 앱 전체에서 단 한 번만 렌더링된다.
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
```

변경 사항:

- `lang="en"` → `lang="ko"` (한국어 서비스)
- metadata를 프로젝트에 맞게 수정
- Next.js 기본 템플릿 마크업을 단순화

#### `src/app/page.tsx` — 홈 페이지 (수정됨)

```tsx
// 'use client'가 없으므로 이 컴포넌트는 서버 컴포넌트다.
// 서버에서 HTML로 렌더링되어 클라이언트에 전달된다.
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center">
      <h1 className="text-4xl font-bold">청안</h1>
      <p className="mt-4 text-lg text-zinc-600">
        청년안심주택 새 공고 알림 서비스
      </p>
    </main>
  );
}
```

Next.js 기본 템플릿(Vercel 로고, Deploy 버튼 등)을 제거하고 프로젝트 제목만 표시.

#### `.gitignore` (수정됨)

Git이 추적하지 않을 파일/폴더 목록. 추가한 항목:

```gitignore
# playwright
/test-results/       # Playwright 테스트 실행 결과 데이터
/playwright-report/  # Playwright HTML 리포트
/blob-report/        # CI에서 생성되는 blob 형태 리포트
```

기존에 포함되어 있던 주요 항목:

- `/node_modules` — 설치된 패키지 (용량이 크고 lock 파일로 재현 가능)
- `/.next/` — Next.js 빌드 캐시
- `.env*` — 환경 변수 (비밀키 유출 방지)
- `*.tsbuildinfo` — TypeScript 증분 빌드 캐시
- `next-env.d.ts` — Next.js가 자동 생성하는 타입 선언

### 3-2. 직접 생성한 설정 파일

#### `.prettierrc` — Prettier 설정

```json
{
  "semi": true, // 문장 끝에 세미콜론 붙임
  "singleQuote": true, // 문자열에 작은따옴표 사용 ('hello')
  "tabWidth": 2, // 들여쓰기 2칸
  "trailingComma": "all", // 배열/객체 마지막 요소 뒤에 쉼표 (diff 깔끔)
  "printWidth": 80, // 한 줄 최대 80자
  "plugins": ["prettier-plugin-tailwindcss"] // Tailwind 클래스 정렬 플러그인
}
```

> **trailingComma: "all"은 왜 쓰는가?**
> 마지막 쉼표가 있으면 새 항목 추가 시 git diff가 한 줄만 변경된다.
> 없으면 기존 줄에 쉼표 추가 + 새 줄 추가로 2줄이 변경되어 diff가 지저분해진다.

#### `.prettierignore` — Prettier가 건드리지 않을 파일 목록

```
node_modules    # 외부 패키지
.next           # Next.js 빌드 결과
out             # 정적 빌드 출력
build           # 빌드 산출물
coverage        # 테스트 커버리지 리포트
pnpm-lock.yaml  # 자동 생성 파일, 포맷팅하면 diff만 늘어남
```

#### `.lintstagedrc` — lint-staged 설정

```json
{
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md,css,mjs}": ["prettier --write"]
}
```

- staged된 `.ts/.tsx` 파일 → ESLint 자동 수정 → Prettier 포맷팅
- staged된 `.json/.md/.css/.mjs` 파일 → Prettier 포맷팅만
- 이 설정은 husky의 pre-commit 훅에서 lint-staged를 호출할 때 읽힌다.

#### `.husky/pre-commit` — Git pre-commit 훅

```bash
pnpm exec lint-staged
```

`git commit` 실행 시 자동으로 이 스크립트가 먼저 실행된다.
lint-staged가 `.lintstagedrc`를 읽고, staged된 파일에 대해 lint + format을 수행한다.
실패하면 커밋이 중단된다.

> **동작 흐름**:
> `git commit` → husky가 `.husky/pre-commit` 실행 → lint-staged 호출
> → staged된 .ts 파일에 eslint --fix + prettier --write 적용
> → 모두 통과하면 커밋 진행 / 실패하면 커밋 중단

#### `eslint.config.mjs` — ESLint 설정 (수정됨)

```javascript
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals'; // CWV 관련 규칙
import nextTs from 'eslint-config-next/typescript'; // TS 규칙
import eslintConfigPrettier from 'eslint-config-prettier'; // Prettier 충돌 제거

const eslintConfig = defineConfig([
  ...nextVitals, // Next.js Core Web Vitals 규칙 (Image, Link 최적화 등)
  ...nextTs, // TypeScript 관련 규칙
  eslintConfigPrettier, // Prettier와 충돌하는 포맷팅 규칙을 비활성화
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);
```

> **ESLint flat config (v9+)**:
> 이전의 `.eslintrc.json`이 아닌 `eslint.config.mjs` 형식을 사용한다.
> ESLint v9부터 flat config가 기본이며, 배열 기반으로 규칙 세트를 합성한다.
> `defineConfig()`는 타입 추론을 위한 헬퍼이며 실제 동작에는 영향 없다.

> **eslint-config-prettier는 왜 마지막에 놓는가?**
> ESLint 규칙 중 "따옴표는 double"처럼 포맷팅 관련 규칙이 있다.
> Prettier는 자체 설정(singleQuote: true)으로 포맷팅한다.
> 둘이 충돌하면 ESLint가 에러를 내므로, eslint-config-prettier를 마지막에 두어
> 포맷팅 관련 ESLint 규칙을 전부 꺼버리고 "포맷팅은 Prettier가 담당"하게 한다.

#### `vitest.config.ts` — Vitest 설정

```typescript
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()], // JSX/TSX 변환 + React Fast Refresh
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'), // tsconfig의 paths와 동일하게 맞춤
    },
  },
  test: {
    environment: 'jsdom', // 브라우저 DOM API 시뮬레이션
    include: ['src/**/*.test.{ts,tsx}'], // 테스트 파일 패턴
  },
});
```

> **왜 tsconfig의 paths와 vitest의 alias를 따로 설정하는가?**
> tsconfig의 `paths`는 TypeScript 컴파일러(타입 체크)용이고,
> Vitest의 `alias`는 Vite 번들러(모듈 해석)용이다.
> 둘은 별개의 시스템이므로 각각 동일한 매핑을 설정해야 `@/` 경로가 양쪽에서 동작한다.

#### `playwright.config.ts` — Playwright E2E 테스트 설정

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', // E2E 테스트 파일 위치
  fullyParallel: true, // 테스트를 병렬 실행
  forbidOnly: !!process.env.CI, // CI에서 .only() 사용 시 실패 (실수로 테스트 스킵 방지)
  retries: process.env.CI ? 2 : 0, // CI에서만 재시도 (flaky 테스트 대응)
  workers: process.env.CI ? 1 : undefined, // CI에서는 단일 워커 (안정성)
  reporter: 'html', // HTML 리포트 생성
  use: {
    baseURL: 'http://localhost:3000', // page.goto('/')가 이 URL 기준
    trace: 'on-first-retry', // 실패 후 재시도 시 트레이스 기록
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev', // 테스트 전에 개발 서버 자동 시작
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI, // 로컬에서는 이미 실행 중인 서버 재사용
  },
});
```

> **단위 테스트(Vitest) vs E2E 테스트(Playwright)의 차이**:
>
> - Vitest: 함수/컴포넌트를 격리하여 테스트. 빠르다. DOM은 jsdom이 시뮬레이션.
> - Playwright: 실제 브라우저를 열고 사용자처럼 클릭/입력. 느리지만 실제 환경에 가깝다.

### 3-3. 직접 작성한 소스 코드

#### `src/lib/utils/cn.ts` — 클래스명 결합 유틸리티

```typescript
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

두 라이브러리를 조합한 유틸리티:

1. **clsx**: 조건부 클래스 결합. `clsx('a', false && 'b', 'c')` → `'a c'`
2. **tailwind-merge**: Tailwind 충돌 해소. `twMerge('px-2 px-4')` → `'px-4'`

사용 예시:

```tsx
<div
  className={cn(
    'flex items-center', // 항상 적용
    isActive && 'bg-blue-500', // 조건부 적용
    'px-2', // 이후에 px-4로 오버라이드 가능
  )}
/>
```

> **왜 clsx만 쓰면 안 되는가?**
> `clsx('px-2', 'px-4')`는 `'px-2 px-4'`를 반환한다. 두 클래스가 모두 적용되어
> CSS 선언 순서에 따라 어느 쪽이 이길지 예측하기 어렵다.
> `twMerge`는 Tailwind 클래스의 의미를 이해하여 뒤의 `px-4`만 남긴다.

#### `src/lib/utils/cn.test.ts` — cn() 테스트

```typescript
import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('여러 클래스를 하나로 합친다', () => { ... });
  it('조건부 클래스를 처리한다', () => { ... });
  it('충돌하는 Tailwind 클래스를 머지한다', () => { ... });
});
```

- 테스트 파일은 원본과 같은 디렉토리에 `*.test.ts` 이름으로 배치 (코딩 컨벤션 준수)
- `describe`로 테스트 그룹을 만들고 `it`으로 개별 케이스를 작성

#### `e2e/home.spec.ts` — E2E 테스트

```typescript
import { expect, test } from '@playwright/test';

test('홈페이지가 정상적으로 로드된다', async ({ page }) => {
  await page.goto('/'); // http://localhost:3000/ 접속
  await expect(page).toHaveTitle(/청안/); // <title>에 "청안"이 포함되는지 검증
});
```

- Playwright 테스트는 `e2e/` 디렉토리에 별도 배치 (단위 테스트와 분리)
- 실제 브라우저에서 페이지 로딩과 HTML 구조를 검증

---

## 4. 생성된 폴더 구조 해설

```
cheong-an/
├── .github/                  # GitHub 관련 설정 (기존)
├── .husky/                   # ✨ Git 훅 스크립트
│   └── pre-commit            # 커밋 전 lint-staged 실행
├── docs/                     # 프로젝트 문서 (기존)
├── e2e/                      # ✨ Playwright E2E 테스트
│   └── home.spec.ts
├── public/                   # ✨ 정적 파일 (favicon, 이미지 등. 빌드 없이 그대로 서빙)
├── src/                      # ✨ 소스 코드 루트
│   ├── app/                  # Next.js App Router — 라우팅과 페이지
│   │   ├── globals.css       # 전역 CSS (Tailwind 진입점)
│   │   ├── layout.tsx        # 루트 레이아웃 (<html>, <body>)
│   │   ├── page.tsx          # / 경로의 페이지 컴포넌트
│   │   └── favicon.ico
│   ├── components/           # ✨ React 컴포넌트
│   │   └── ui/               # 범용 UI 컴포넌트 (Button, Input 등)
│   ├── constants/            # ✨ 상수 (DISTRICTS, API_URL 등)
│   ├── hooks/                # ✨ 커스텀 훅 (useAnnouncementFilter 등)
│   ├── lib/                  # ✨ 유틸리티, 외부 라이브러리 래퍼
│   │   ├── crawler/          # 크롤링 로직 (향후)
│   │   ├── supabase/         # DB 클라이언트 (향후)
│   │   └── utils/            # 범용 유틸리티
│   │       ├── cn.ts         # 클래스명 결합 함수
│   │       └── cn.test.ts    # cn() 테스트
│   ├── stores/               # ✨ Zustand 스토어 (향후)
│   └── types/                # ✨ 공유 TypeScript 타입 정의
├── .gitignore                # ✨ Git 무시 파일 목록
├── .lintstagedrc             # ✨ lint-staged 설정
├── .prettierrc               # ✨ Prettier 설정
├── .prettierignore           # ✨ Prettier 무시 파일 목록
├── eslint.config.mjs         # ✨ ESLint 설정
├── next.config.ts            # ✨ Next.js 설정
├── package.json              # ✨ 프로젝트 메타/의존성/스크립트
├── playwright.config.ts      # ✨ Playwright 설정
├── pnpm-lock.yaml            # ✨ 의존성 잠금 파일 (정확한 버전 고정)
├── postcss.config.mjs        # ✨ PostCSS 설정 (Tailwind 플러그인)
├── tsconfig.json             # ✨ TypeScript 설정
└── vitest.config.ts          # ✨ Vitest 설정
```

> **`src/app/`의 특별한 규칙 (App Router)**:
>
> - `page.tsx` → 해당 경로의 페이지 컴포넌트. 파일이 있어야 URL로 접근 가능
> - `layout.tsx` → 해당 경로와 하위 경로의 공통 레이아웃
> - `loading.tsx` → 로딩 UI (향후)
> - `error.tsx` → 에러 UI (향후)
> - 이 파일명들은 Next.js가 정한 컨벤션이며, 자동으로 인식된다.

> **`pnpm-lock.yaml`은 왜 커밋하는가?**
> `package.json`의 `"next": "16.2.1"`은 정확한 버전이지만,
> `"vitest": "^4.1.1"`은 "4.1.1 이상 5.0.0 미만"이라는 범위다.
> lock 파일은 실제로 설치된 정확한 버전을 기록하여,
> 다른 환경에서 `pnpm install`해도 동일한 버전이 설치되도록 보장한다.

---

## 5. package.json scripts 해설

```json
{
  "dev": "next dev --turbopack",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test",
  "prepare": "husky"
}
```

| 스크립트            | 실행 명령어            | 용도                                                             |
| ------------------- | ---------------------- | ---------------------------------------------------------------- |
| `pnpm dev`          | `next dev --turbopack` | 개발 서버 시작. `--turbopack`은 Rust 기반 번들러로 HMR 속도 향상 |
| `pnpm build`        | `next build`           | 프로덕션 빌드. 정적 페이지 생성 + 최적화                         |
| `pnpm start`        | `next start`           | 빌드된 앱을 프로덕션 모드로 실행                                 |
| `pnpm lint`         | `eslint`               | 코드 정적 분석. 잠재적 버그/안티패턴 탐지                        |
| `pnpm format`       | `prettier --write .`   | 모든 파일 포맷팅 (파일 수정)                                     |
| `pnpm format:check` | `prettier --check .`   | 포맷팅 위반 여부만 확인 (CI에서 사용)                            |
| `pnpm typecheck`    | `tsc --noEmit`         | TypeScript 타입 체크만 수행 (JS 파일 생성 안 함)                 |
| `pnpm test`         | `vitest run`           | 단위 테스트 1회 실행 후 종료                                     |
| `pnpm test:watch`   | `vitest`               | 파일 변경 감시하며 관련 테스트 자동 재실행 (개발 중 사용)        |
| `pnpm test:e2e`     | `playwright test`      | E2E 테스트 실행 (실제 브라우저)                                  |
| `pnpm prepare`      | `husky`                | `pnpm install` 후 자동 실행. husky Git 훅 설치                   |

> **`prepare` 스크립트의 동작 원리**:
> npm/pnpm은 `install` 완료 후 `prepare` 스크립트를 자동 실행한다.
> 이를 통해 레포를 클론한 누구든 `pnpm install`만 하면 Git 훅이 자동으로 설정된다.
> 별도의 "husky 세팅 해주세요" 안내가 필요 없다.

---

## 6. 설정 파일 간의 관계도

```
git commit 실행
  │
  ▼
.husky/pre-commit ─── "pnpm exec lint-staged" 실행
  │
  ▼
.lintstagedrc ─── staged된 파일 유형별로 명령어 매핑
  │
  ├── *.ts, *.tsx → eslint --fix → prettier --write
  │                    │                │
  │                    ▼                ▼
  │            eslint.config.mjs   .prettierrc
  │            (ESLint 규칙)        (포맷팅 규칙)
  │
  └── *.json, *.md, *.css → prettier --write
                                    │
                                    ▼
                               .prettierrc
                            .prettierignore (제외 파일)
```

```
pnpm dev
  │
  ▼
next.config.ts (Next.js 설정)
  │
  ├── tsconfig.json (TypeScript 규칙 참조)
  ├── postcss.config.mjs → @tailwindcss/postcss (CSS 처리)
  └── src/app/globals.css → @import 'tailwindcss' (Tailwind 진입점)
```

```
pnpm test
  │
  ▼
vitest.config.ts
  │
  ├── @vitejs/plugin-react (JSX 변환)
  ├── jsdom (DOM 시뮬레이션)
  └── src/**/*.test.{ts,tsx} (테스트 파일 탐색)

pnpm test:e2e
  │
  ▼
playwright.config.ts
  │
  ├── webServer: pnpm dev (개발 서버 자동 시작)
  └── e2e/*.spec.ts (E2E 테스트 파일 탐색)
```

---

## 7. 자주 나오는 개념 정리

### dependencies vs devDependencies

|               | dependencies      | devDependencies          |
| ------------- | ----------------- | ------------------------ |
| 용도          | 앱 실행에 필요    | 개발/빌드에만 필요       |
| 프로덕션 포함 | Yes               | No                       |
| 예시          | react, next, clsx | eslint, vitest, prettier |
| 설치 명령     | `pnpm add <pkg>`  | `pnpm add -D <pkg>`      |

### ESLint vs Prettier — 역할 분담

|           | ESLint                                               | Prettier               |
| --------- | ---------------------------------------------------- | ---------------------- |
| 관심사    | 코드 품질 (잠재적 버그)                              | 코드 스타일 (외형)     |
| 예시      | "사용하지 않는 변수가 있음"                          | "따옴표를 싱글로 통일" |
| 자동 수정 | 일부 가능 (`--fix`)                                  | 항상 가능 (`--write`)  |
| 충돌 해결 | `eslint-config-prettier`로 ESLint의 포맷팅 규칙을 끔 |

### Vitest vs Playwright — 테스트 전략

|             | Vitest (단위)         | Playwright (E2E)      |
| ----------- | --------------------- | --------------------- |
| 테스트 대상 | 함수, 컴포넌트        | 전체 사용자 플로우    |
| 실행 환경   | jsdom (가짜 브라우저) | 실제 Chromium/Firefox |
| 속도        | 매우 빠름 (ms~초)     | 느림 (초~분)          |
| 파일 위치   | `src/**/*.test.ts`    | `e2e/*.spec.ts`       |
| 사용 시점   | 개발 중 수시로        | PR 제출 전, CI에서    |

### App Router의 서버 컴포넌트 vs 클라이언트 컴포넌트

|              | 서버 컴포넌트 (기본)             | 클라이언트 컴포넌트                 |
| ------------ | -------------------------------- | ----------------------------------- |
| 선언         | 아무것도 안 쓰면 서버            | 파일 최상단에 `'use client'`        |
| 실행 위치    | 서버에서만                       | 서버 + 브라우저                     |
| JS 번들 포함 | No (HTML만 전달)                 | Yes                                 |
| 사용 가능    | DB 직접 접근, 파일 읽기          | useState, useEffect, onClick        |
| 원칙         | 가능한 모든 것을 서버 컴포넌트로 | 인터랙션이 필요한 부분만 클라이언트 |
