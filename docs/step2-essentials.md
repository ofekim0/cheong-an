# Step 2: 프로젝트 초기화 — 핵심 정리

> 상세 작업 기록은 [step2-project-init.md](./step2-project-init.md) 참고

---

## 목차

1. [핵심 개념](#1-핵심-개념)
2. [프로젝트 구조](#2-프로젝트-구조)
3. [설정 파일 역할](#3-설정-파일-역할)
4. [설정 파일 간의 관계도](#4-설정-파일-간의-관계도)
5. [실행 스크립트](#5-실행-스크립트)
6. [실행한 명령어 기록](#6-실행한-명령어-기록)

---

## 1. 핵심 개념

### dependencies vs devDependencies

|               | dependencies      | devDependencies          |
| ------------- | ----------------- | ------------------------ |
| 용도          | 앱 실행에 필요    | 개발/빌드에만 필요       |
| 프로덕션 포함 | Yes               | No                       |
| 예시          | react, next, clsx | eslint, vitest, prettier |
| 설치 명령     | `pnpm add <pkg>`  | `pnpm add -D <pkg>`      |

잘못 분류하면 프로덕션 번들이 불필요하게 커지거나, 빌드 시 패키지를 못 찾을 수 있다.

### ESLint vs Prettier — 역할 분담

|           | ESLint                      | Prettier               |
| --------- | --------------------------- | ---------------------- |
| 관심사    | **코드 품질** (잠재적 버그) | **코드 스타일** (외형) |
| 예시      | "사용하지 않는 변수가 있음" | "따옴표를 싱글로 통일" |
| 자동 수정 | 일부 가능 (`--fix`)         | 항상 가능 (`--write`)  |

둘의 규칙이 충돌할 수 있다 (예: ESLint "double quote 써라" vs Prettier "single quote 써라").
`eslint-config-prettier`가 ESLint의 포맷팅 규칙을 꺼서 **포맷팅은 Prettier, 로직 분석은 ESLint**로 역할을 분리한다.

### Vitest vs Playwright — 테스트 전략

|             | Vitest (단위 테스트)  | Playwright (E2E 테스트) |
| ----------- | --------------------- | ----------------------- |
| 테스트 대상 | 함수, 컴포넌트        | 전체 사용자 플로우      |
| 실행 환경   | jsdom (가짜 브라우저) | 실제 Chromium/Firefox   |
| 속도        | 매우 빠름 (ms~초)     | 느림 (초~분)            |
| 파일 위치   | `src/**/*.test.ts`    | `e2e/*.spec.ts`         |
| 사용 시점   | 개발 중 수시로        | PR 제출 전, CI에서      |

### 서버 컴포넌트 vs 클라이언트 컴포넌트 (App Router)

|              | 서버 컴포넌트 (기본)    | 클라이언트 컴포넌트          |
| ------------ | ----------------------- | ---------------------------- |
| 선언         | 아무것도 안 쓰면 서버   | 파일 최상단에 `'use client'` |
| 실행 위치    | 서버에서만              | 서버 + 브라우저              |
| JS 번들 포함 | No (HTML만 전달)        | Yes                          |
| 사용 가능    | DB 직접 접근, 파일 읽기 | useState, useEffect, onClick |

**원칙**: 가능한 모든 것을 서버 컴포넌트로 만들고, 인터랙션이 필요한 부분만 `'use client'`를 쓴다.
클라이언트 경계를 최대한 말단(leaf)으로 내린다.

### Git 훅 (husky + lint-staged)

`git commit` 실행 시 자동으로 코드 품질 검사가 돌아가는 구조:

```
git commit
  → husky가 .husky/pre-commit 실행
    → lint-staged가 staged된 파일만 대상으로:
      → .ts/.tsx → eslint --fix + prettier --write
      → .json/.md/.css → prettier --write
    → 모두 통과하면 커밋 진행 / 실패하면 커밋 중단
```

커밋이 갑자기 실패할 때 이 흐름을 모르면 원인을 찾기 어렵다.

### cn() 유틸리티 — clsx + tailwind-merge

```typescript
// src/lib/utils/cn.ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

1. **clsx**: 조건부 클래스 결합. `clsx('a', false && 'b')` → `'a'`
2. **tailwind-merge**: Tailwind 충돌 해소. `twMerge('px-2 px-4')` → `'px-4'`

clsx만 쓰면 `'px-2 px-4'`가 둘 다 남아서 CSS 선언 순서에 따라 결과가 달라진다.
twMerge는 Tailwind 클래스의 의미를 이해하여 나중 것만 남긴다.

```tsx
<div
  className={cn(
    'flex items-center', // 항상 적용
    isActive && 'bg-blue-500', // 조건부 적용
  )}
/>
```

---

## 2. 프로젝트 구조

```
cheong-an/
├── .github/                  # GitHub 설정 (이슈 템플릿 등)
├── .husky/                   # Git 훅 스크립트
│   └── pre-commit            # 커밋 전 lint-staged 실행
├── docs/                     # 프로젝트 문서
├── e2e/                      # Playwright E2E 테스트
│   └── home.spec.ts
├── public/                   # 정적 파일 (빌드 없이 그대로 서빙)
├── src/                      # 소스 코드 루트
│   ├── app/                  # Next.js App Router
│   │   ├── globals.css       # 전역 CSS (Tailwind 진입점)
│   │   ├── layout.tsx        # 루트 레이아웃 (<html>, <body>)
│   │   └── page.tsx          # / 경로의 페이지
│   ├── components/           # React 컴포넌트
│   │   └── ui/               # 범용 UI 컴포넌트
│   ├── constants/            # 상수
│   ├── hooks/                # 커스텀 훅
│   ├── lib/                  # 유틸리티, 외부 라이브러리 래퍼
│   │   ├── crawler/          # 크롤링 로직 (향후)
│   │   ├── supabase/         # DB 클라이언트 (향후)
│   │   └── utils/            # 범용 유틸리티 (cn.ts 등)
│   ├── stores/               # Zustand 스토어 (향후)
│   └── types/                # 공유 TypeScript 타입 정의
├── .lintstagedrc             # lint-staged 설정
├── .prettierrc               # Prettier 설정
├── eslint.config.mjs         # ESLint 설정
├── next.config.ts            # Next.js 설정
├── package.json              # 의존성/스크립트 정의
├── playwright.config.ts      # Playwright 설정
├── pnpm-lock.yaml            # 의존성 잠금 파일
├── postcss.config.mjs        # PostCSS 설정 (Tailwind 플러그인)
├── tsconfig.json             # TypeScript 설정
└── vitest.config.ts          # Vitest 설정
```

### App Router 특수 파일명

`src/app/` 안에서 Next.js가 자동 인식하는 파일명 컨벤션:

| 파일          | 역할                                                 |
| ------------- | ---------------------------------------------------- |
| `page.tsx`    | 해당 경로의 페이지. 이 파일이 있어야 URL로 접근 가능 |
| `layout.tsx`  | 해당 경로와 하위 경로의 공통 레이아웃                |
| `loading.tsx` | 로딩 UI (향후)                                       |
| `error.tsx`   | 에러 UI (향후)                                       |

### pnpm-lock.yaml을 커밋하는 이유

`package.json`의 `"vitest": "^4.1.1"`은 "4.1.1 이상 5.0.0 미만"이라는 **범위**다.
lock 파일은 실제 설치된 정확한 버전을 기록하여, 다른 환경에서도 동일한 버전이 설치되도록 보장한다.

---

## 3. 설정 파일 역할

### `tsconfig.json` — TypeScript 설정

핵심 옵션:

| 옵션                            | 의미                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `strict: true`                  | 엄격한 타입 체크 (nullcheck, noImplicitAny 등)                                  |
| `noEmit: true`                  | JS 파일을 생성하지 않음. Next.js(SWC)가 빌드를 담당하고, tsc는 타입 체크만 수행 |
| `paths: { "@/*": ["./src/*"] }` | `@/components/...` 같은 절대 경로를 `src/`로 매핑                               |

### `vitest.config.ts` — 단위 테스트 설정

```typescript
export default defineConfig({
  plugins: [react()], // JSX/TSX 변환
  resolve: {
    alias: { '@': resolve(__dirname, './src') }, // tsconfig paths와 동일하게 맞춤
  },
  test: {
    environment: 'jsdom', // 브라우저 DOM 시뮬레이션
    include: ['src/**/*.test.{ts,tsx}'], // 테스트 파일 패턴
  },
});
```

> **tsconfig `paths`와 vitest `alias`를 왜 따로 설정하는가?**
> tsconfig는 TypeScript 컴파일러(타입 체크)용이고, vitest의 alias는 Vite 번들러(모듈 해석)용이다.
> 별개의 시스템이므로 각각 동일한 매핑을 설정해야 `@/` 경로가 양쪽에서 동작한다.

### `playwright.config.ts` — E2E 테스트 설정

핵심 옵션:

| 옵션                            | 의미                                      |
| ------------------------------- | ----------------------------------------- |
| `testDir: './e2e'`              | E2E 테스트 파일 위치                      |
| `forbidOnly: !!process.env.CI`  | CI에서 `.only()` 사용 시 실패 (실수 방지) |
| `webServer.command: 'pnpm dev'` | 테스트 전에 개발 서버 자동 시작           |

### `eslint.config.mjs` — ESLint 설정

```javascript
const eslintConfig = defineConfig([
  ...nextVitals, // Next.js Core Web Vitals 규칙
  ...nextTs, // TypeScript 규칙
  eslintConfigPrettier, // Prettier 충돌 규칙 비활성화 — 반드시 마지막에 배치
]);
```

`eslint-config-prettier`를 **마지막에 두는 이유**: 앞의 규칙 중 Prettier와 충돌하는 포맷팅 규칙을 전부 꺼야 하므로.

### `postcss.config.mjs` — PostCSS 설정

Tailwind CSS는 PostCSS 플러그인으로 동작한다. Next.js가 빌드 시 이 파일을 읽어 CSS를 처리한다.

### `.prettierrc` — Prettier 설정

| 옵션            | 값                                | 이유                                                         |
| --------------- | --------------------------------- | ------------------------------------------------------------ |
| `trailingComma` | `"all"`                           | 마지막 쉼표가 있으면 새 항목 추가 시 git diff가 1줄만 변경됨 |
| `singleQuote`   | `true`                            | 작은따옴표로 통일                                            |
| `plugins`       | `["prettier-plugin-tailwindcss"]` | Tailwind 클래스 순서 자동 정렬                               |

### `.lintstagedrc` — lint-staged 설정

```json
{
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md,css,mjs}": ["prettier --write"]
}
```

staged된 파일 유형에 따라 실행할 명령어를 매핑한다.
husky의 pre-commit 훅에서 lint-staged를 호출할 때 이 설정을 읽는다.

---

## 4. 설정 파일 간의 관계도

### 커밋 시 (코드 품질 자동 검사)

```
git commit
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
  │
  └── *.json, *.md, *.css → prettier --write
                                    │
                                    ▼
                               .prettierrc
```

### 개발 서버 실행 시

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

### 테스트 실행 시

```
pnpm test                          pnpm test:e2e
  │                                   │
  ▼                                   ▼
vitest.config.ts                   playwright.config.ts
  │                                   │
  ├── jsdom (DOM 시뮬레이션)          ├── webServer: pnpm dev (서버 자동 시작)
  └── src/**/*.test.{ts,tsx}          └── e2e/*.spec.ts
```

---

## 5. 실행 스크립트

| 명령어              | 실행 내용              | 용도                                         |
| ------------------- | ---------------------- | -------------------------------------------- |
| `pnpm dev`          | `next dev --turbopack` | 개발 서버 시작 (Rust 기반 번들러로 HMR 빠름) |
| `pnpm build`        | `next build`           | 프로덕션 빌드                                |
| `pnpm start`        | `next start`           | 빌드된 앱을 프로덕션 모드로 실행             |
| `pnpm lint`         | `eslint`               | 코드 정적 분석                               |
| `pnpm format`       | `prettier --write .`   | 모든 파일 포맷팅                             |
| `pnpm format:check` | `prettier --check .`   | 포맷팅 위반 확인만 (CI용)                    |
| `pnpm typecheck`    | `tsc --noEmit`         | TypeScript 타입 체크만                       |
| `pnpm test`         | `vitest run`           | 단위 테스트 1회 실행                         |
| `pnpm test:watch`   | `vitest`               | 파일 변경 감시 + 자동 재실행 (개발 중)       |
| `pnpm test:e2e`     | `playwright test`      | E2E 테스트 (실제 브라우저)                   |
| `pnpm prepare`      | `husky`                | `pnpm install` 후 자동 실행. Git 훅 설치     |

> **`prepare` 스크립트**: npm/pnpm은 `install` 완료 후 `prepare`를 자동 실행한다.
> 레포를 클론한 누구든 `pnpm install`만 하면 Git 훅이 자동 설정된다.

---

## 6. 실행한 명령어 기록

실제 프로젝트 초기화 시 실행한 명령어의 순서 기록. 재현이 필요할 때 참고.

```bash
# 1. 브랜치 생성
git checkout -b chore/project-init

# 2. Next.js 프로젝트 생성
pnpm create next-app . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --no-git

# 3. 개발 도구 일괄 설치 (-D: devDependencies)
pnpm add -D prettier prettier-plugin-tailwindcss eslint-config-prettier husky lint-staged vitest @vitejs/plugin-react playwright @playwright/test msw

# 4. 추가 의존성
pnpm add -D jsdom @vitest/runner   # Vitest DOM 시뮬레이션
pnpm add clsx tailwind-merge        # cn() 유틸리티 (런타임 의존성이므로 -D 없음)

# 5. husky 초기화
pnpm exec husky init

# 6. 검증
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format
```
