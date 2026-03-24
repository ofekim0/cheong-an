# 코딩 컨벤션

> 프로젝트 초기화 후 ESLint/Prettier 설정으로 자동 강제되는 부분은 여기서 다루지 않는다.
> 이 문서는 도구가 잡아주지 못하는, 팀(1인이지만) 합의가 필요한 컨벤션만 정리한다.

---

## 1. 프로젝트 구조

```
src/
├── app/                    # Next.js App Router 페이지
│   ├── (routes)/           # 라우트 그룹
│   ├── api/                # Route Handlers
│   └── layout.tsx
├── components/
│   ├── ui/                 # 범용 UI 컴포넌트 (Button, Input 등)
│   └── [feature]/          # 기능별 컴포넌트 (announcement/, notification/ 등)
├── hooks/                  # 커스텀 훅
├── lib/                    # 유틸리티, 외부 라이브러리 래퍼
│   ├── crawler/            # 크롤링 관련 로직
│   ├── supabase/           # DB 클라이언트
│   └── utils/              # 범용 유틸리티
├── stores/                 # Zustand 스토어
├── types/                  # 공유 타입 정의
└── constants/              # 상수
```

### 원칙

- **기능 기반 분류를 우선**한다. `components/announcement/`, `components/notification/` 처럼.
- **재사용 가능한 범용 컴포넌트만** `components/ui/`에 둔다.
- **서버/클라이언트 경계를 명확히** 한다. 클라이언트 컴포넌트에는 `'use client'`를 반드시 명시.

---

## 2. 네이밍

### 파일/폴더

| 대상          | 규칙                  | 예시                       |
| ------------- | --------------------- | -------------------------- |
| 컴포넌트 파일 | PascalCase            | `AnnouncementCard.tsx`     |
| 훅 파일       | camelCase, use 접두사 | `useAnnouncementFilter.ts` |
| 유틸리티 파일 | camelCase             | `parseMainPage.ts`         |
| 타입 파일     | camelCase             | `announcement.ts`          |
| 상수 파일     | camelCase             | `districts.ts`             |
| 테스트 파일   | 원본파일명.test.ts(x) | `parseMainPage.test.ts`    |

### 변수/함수

| 대상                 | 규칙                        | 예시                                   |
| -------------------- | --------------------------- | -------------------------------------- |
| 변수, 함수           | camelCase                   | `boardId`, `fetchAnnouncement()`       |
| 상수                 | UPPER_SNAKE_CASE            | `MAX_RETRY_COUNT`, `CRAWL_INTERVAL_MS` |
| 컴포넌트             | PascalCase                  | `AnnouncementCard`                     |
| 타입, 인터페이스     | PascalCase                  | `Announcement`, `CrawlResult`          |
| 제네릭 타입 파라미터 | T 접두사 또는 의미있는 이름 | `TData`, `TError`                      |

### 이벤트 핸들러

```typescript
// props: on + 동사
(onSubmit, onClick, onChange);

// handler 함수: handle + 동사
(handleSubmit, handleClick, handleFilterChange);
```

---

## 3. TypeScript

### 타입 vs 인터페이스

- **객체 형태**는 `interface` 사용 (확장 가능성)
- **유니온, 유틸리티 타입**은 `type` 사용
- API 응답, DB 스키마 등 **외부 데이터 타입**은 별도 파일에 정의

```typescript
// ✅ 인터페이스 — 객체 형태
interface Announcement {
  boardId: number;
  title: string;
  district: District;
  publishedAt: string;
}

// ✅ 타입 — 유니온
type AnnouncementType = '최초' | '추가';
type District = '강남구' | '강동구' | /* ... */;
```

### null / undefined

- **의도적 "값 없음"** 은 `null`
- **아직 초기화되지 않음**은 `undefined`
- 함수 반환값에서 값이 없을 수 있으면 `T | null` 사용

### Non-null assertion (`!`) 사용 금지

```typescript
// ❌
const value = map.get(key)!;

// ✅
const value = map.get(key);
if (value === undefined) throw new Error(`Key not found: ${key}`);
```

---

## 4. React / Next.js

### 컴포넌트 작성 순서

```typescript
'use client'; // 1. 지시자 (필요 시)

import { ... } from 'react'; // 2. 외부 라이브러리
import { ... } from '@/components/ui'; // 3. 내부 모듈
import { ... } from './ChildComponent'; // 4. 상대 경로

interface Props { // 5. Props 타입 (컴포넌트 바로 위에)
  title: string;
}

export default function ComponentName({ title }: Props) { // 6. 컴포넌트
  // 6-1. 훅
  // 6-2. 파생 상태 (useMemo 등)
  // 6-3. 이벤트 핸들러
  // 6-4. 이펙트
  // 6-5. 렌더링

  return ( ... );
}
```

### 서버 컴포넌트 vs 클라이언트 컴포넌트

- **기본은 서버 컴포넌트**. 클라이언트가 필요한 경우에만 `'use client'`.
- 클라이언트가 필요한 경우: useState, useEffect, 이벤트 핸들러, 브라우저 API
- **경계를 최대한 말단으로** 내린다. 페이지 전체를 클라이언트로 만들지 않는다.

---

## 5. 스타일링 (Tailwind CSS)

### 클래스 순서

Tailwind 공식 Prettier 플러그인(`prettier-plugin-tailwindcss`)으로 자동 정렬.

### 긴 클래스 처리

```typescript
// ✅ cn() 유틸리티 사용 (clsx + twMerge)
import { cn } from '@/lib/utils';

<div className={cn(
  'flex items-center gap-2',
  'rounded-lg border p-4',
  isActive && 'border-blue-500 bg-blue-50'
)} />
```

### 반복되는 스타일

```typescript
// ❌ 인라인 반복
<button className="rounded-lg bg-blue-500 px-4 py-2 text-white" />
<button className="rounded-lg bg-blue-500 px-4 py-2 text-white" />

// ✅ 컴포넌트로 추출
<Button variant="primary">확인</Button>
```

---

## 6. 테스트

### 파일 위치

- 테스트 파일은 원본 파일과 같은 디렉토리에 둔다.
- `__tests__/` 폴더를 별도로 만들지 않는다.

```
lib/crawler/
├── parseMainPage.ts
├── parseMainPage.test.ts
├── parseDetailPage.ts
└── parseDetailPage.test.ts
```

### 테스트 네이밍

```typescript
describe('parseMainPage', () => {
  it('최신 공고 5건의 boardId를 추출한다', () => { ... });
  it('공고가 없으면 빈 배열을 반환한다', () => { ... });
  it('HTML 구조가 변경되면 에러를 던진다', () => { ... });
});
```

### 무엇을 테스트하는가

| 반드시 테스트                    | 테스트 안 해도 됨    |
| -------------------------------- | -------------------- |
| 크롤링 파서 (핵심 비즈니스 로직) | UI 스타일링          |
| boardId 감지 / 누락 방지 로직    | 외부 라이브러리 동작 |
| 알림 필터 매칭 로직              | 단순 데이터 패스스루 |
| API Route 핸들러                 |                      |

---

## 7. 임포트 순서

ESLint `import/order` 규칙으로 자동 강제. 기본 순서:

```typescript
// 1. React / Next.js
import { useState } from 'react';
import Link from 'next/link';

// 2. 외부 라이브러리
import { useQuery } from '@tanstack/react-query';

// 3. 내부 절대 경로 (@/)
import { Button } from '@/components/ui/Button';
import { useAnnouncementStore } from '@/stores/announcement';

// 4. 상대 경로
import { AnnouncementCard } from './AnnouncementCard';

// 5. 타입 (type import)
import type { Announcement } from '@/types/announcement';
```
