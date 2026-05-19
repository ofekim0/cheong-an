# Step 3: GitHub Actions CI 설정 — 학습 정리

> Step 3에서 수행한 작업과, 각 작업이 의미하는 것을 정리한 문서.

---

## 목차

1. [수행한 작업 요약](#1-수행한-작업-요약)
2. [CI/CD란](#2-cicd란)
3. [GitHub Actions 워크플로우 해부](#3-github-actions-워크플로우-해부)
4. [Node 버전 고정이 필요한 이유](#4-node-버전-고정이-필요한-이유)
5. [packageManager 필드](#5-packagemanager-필드)
6. [Vercel 배포와 CI의 역할 분리](#6-vercel-배포와-ci의-역할-분리)
7. [이 프로젝트에서 내린 판단들](#7-이-프로젝트에서-내린-판단들)

---

## 1. 수행한 작업 요약

| 파일                       | 작업 | 목적                                  |
| -------------------------- | ---- | ------------------------------------- |
| `.nvmrc`                   | 생성 | Node.js 버전을 20으로 고정            |
| `package.json`             | 수정 | `engines`, `packageManager` 필드 추가 |
| `.github/workflows/ci.yml` | 생성 | PR 품질 게이트 자동화 워크플로우      |

**결과**: PR을 올리면 lint → format:check → typecheck → test → build가 자동 실행되어, 품질 기준을 통과하지 못한 코드는 머지할 수 없게 됨.

---

## 2. CI/CD란

### CI (Continuous Integration) — 지속적 통합

코드를 변경할 때마다 **자동으로 검증**하는 것.

"내가 작성한 코드가 기존 코드를 망가뜨리지 않는가?"를 사람이 아니라 기계가 매번 확인해준다.

```
코드 push → 자동으로 lint, 타입체크, 테스트, 빌드 실행 → 실패하면 머지 차단
```

### CD (Continuous Deployment) — 지속적 배포

CI를 통과한 코드를 **자동으로 서버에 배포**하는 것.

이 프로젝트에서는 Vercel이 CD를 담당한다. main에 머지되면 자동으로 프로덕션 배포.

### 왜 필요한가

- 1인 프로젝트라도 "어제의 나"가 만든 코드를 "오늘의 나"가 깨뜨릴 수 있음
- 수동 검증은 잊거나 빠뜨리기 쉬움 — 자동화하면 실수를 구조적으로 방지
- 포트폴리오 관점: CI/CD가 있다는 것 자체가 엔지니어링 성숙도를 보여줌

---

## 3. GitHub Actions 워크플로우 해부

`.github/workflows/ci.yml` 파일의 각 부분이 하는 일:

### 트리거

```yaml
on:
  pull_request:
    branches: [main]
```

main 브랜치로 향하는 PR이 생성/업데이트될 때 실행된다. main에 직접 push할 때는 실행되지 않는다 (어차피 직접 push를 금지하고 있으므로).

### Concurrency

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

같은 PR 브랜치에서 연속으로 push하면, **이전 실행을 취소**하고 새 실행만 진행한다. GitHub Actions 무료 사용량을 아끼기 위함.

### Job 구성

```yaml
jobs:
  ci:
    runs-on: ubuntu-latest
    steps: [...]
```

**단일 Job**으로 구성했다. 여러 Job으로 나누면 (예: lint Job, test Job, build Job 따로) 병렬 실행이 가능하지만, 각 Job마다 러너를 새로 띄우고 의존성을 다시 설치해야 한다. 이 프로젝트 규모에서는 단일 Job이 더 빠르고 단순하다.

### Steps 순서와 이유

```yaml
steps:
  - uses: actions/checkout@v4 # 1. 코드 체크아웃
  - uses: pnpm/action-setup@v4 # 2. pnpm 설치
  - uses: actions/setup-node@v4 # 3. Node 설치 + pnpm 캐시
    with:
      node-version-file: '.nvmrc'
      cache: 'pnpm'
  - run: pnpm install --frozen-lockfile # 4. 의존성 설치
  - run: pnpm lint # 5. ESLint
  - run: pnpm format:check # 6. Prettier 포맷 검사
  - run: pnpm typecheck # 7. TypeScript 타입 체크
  - run: pnpm test # 8. Vitest 단위 테스트
  - run: pnpm build # 9. Next.js 빌드
```

**순서가 중요하다:**

- pnpm 설치 → Node 설치 순서여야 `cache: 'pnpm'`이 동작함 (setup-node가 pnpm store 경로를 알아야 캐시 가능)
- `--frozen-lockfile`: lockfile과 package.json이 불일치하면 설치를 거부한다. CI에서 lockfile이 몰래 변경되는 것을 방지
- lint/format → typecheck → test → build 순서: 빠른 검사를 먼저, 느린 검사를 나중에

### `uses` vs `run`

- `uses`: GitHub Marketplace에 공개된 **Action**(재사용 가능한 작업 단위)을 사용
- `run`: 쉘 명령어를 직접 실행

---

## 4. Node 버전 고정이 필요한 이유

### 문제

"내 컴퓨터에서는 되는데 CI에서 안 돼요" — 대부분 런타임 버전 차이가 원인.

Node.js 버전이 다르면:

- 사용 가능한 API가 다름 (예: `Array.findLast()`는 Node 18+)
- 네이티브 모듈 빌드가 달라짐
- 미묘한 동작 차이

### `.nvmrc` 파일

```
20
```

한 줄짜리 파일이지만 두 가지 역할을 한다:

1. **로컬**: `nvm use` 명령 시 이 버전을 사용
2. **CI**: `actions/setup-node`의 `node-version-file` 옵션이 이 파일을 읽음

버전을 한 곳에서만 관리하므로 로컬과 CI의 버전이 항상 일치한다.

---

## 5. packageManager 필드

```json
{
  "packageManager": "pnpm@10.33.0"
}
```

### 하는 일

- **CI에서**: `pnpm/action-setup@v4`가 이 필드를 읽어서 정확히 같은 pnpm 버전을 설치
- **로컬에서**: Node.js의 Corepack이 활성화되어 있으면, 이 버전과 다른 pnpm을 사용하려 할 때 경고

### engines 필드

```json
{
  "engines": {
    "node": ">=20"
  }
}
```

Node 20 미만에서 `pnpm install`을 실행하면 경고(또는 에러)를 준다. 실수 방지용 안전장치.

---

## 6. Vercel 배포와 CI의 역할 분리

이 프로젝트에서 CI(GitHub Actions)와 CD(Vercel)는 **각자 다른 일**을 한다:

```
PR 생성/업데이트
  ├── GitHub Actions: 코드 품질 검증 (lint, test, build)
  └── Vercel: 프리뷰 배포 (PR별 임시 URL 생성)

main에 머지
  └── Vercel: 프로덕션 배포 (실제 서비스 URL에 반영)
```

### 왜 Vercel에 CI를 맡기지 않는가

Vercel도 빌드 시 에러가 나면 배포를 중단하지만, lint나 테스트는 실행하지 않는다. "빌드는 되지만 린트 에러가 있는" 코드가 머지될 수 있다. GitHub Actions에서 모든 품질 검사를 명시적으로 실행해야 하는 이유.

### vercel.json이 필요 없는 이유

표준 Next.js 프로젝트는 Vercel이 자동으로 감지하고 최적 설정을 적용한다. 빌드 커맨드, 출력 디렉토리, Node 버전 등을 커스텀할 때만 `vercel.json`이 필요.

---

## 7. 이 프로젝트에서 내린 판단들

### 단일 Job vs 병렬 Job

**선택: 단일 Job**

병렬 Job(lint, test, build를 각각 별도 Job)으로 구성하면 전체 시간은 줄지만, 각 Job마다 러너 준비 + 의존성 설치를 반복한다. 전체 CI가 29초에 끝나는 규모에서는 병렬화의 이점이 없다.

### E2E 테스트 미포함

`docs/PROCESS.md`에서 Phase 0~2의 품질 게이트는 lint + typecheck + unit test로 정의했다. Playwright E2E는 Phase 3+ 게이트이므로 지금 추가하지 않았다. 나중에 워크플로우에 `pnpm test:e2e` 한 줄만 추가하면 된다.

### format:check를 CI에 넣은 이유

husky pre-commit hook이 로컬에서 포맷을 강제하지만, hook을 우회(`--no-verify`)하거나 다른 환경에서 커밋할 수 있다. CI에서 한 번 더 검사하는 것은 **이중 안전장치**.
