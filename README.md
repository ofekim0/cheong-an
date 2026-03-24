# 청안 (cheong-an)

> 청년안심주택 새 공고 알림 서비스 — 모집공고 모니터링 + 웹 푸시 알림

## 프로젝트 소개

[청년안심주택 홈페이지](https://soco.seoul.go.kr/youth/main/main.do)에는 새 모집공고 알림 기능이 없습니다.
수요자는 공고가 언제 올라올지 알 수 없어 수시로 직접 확인해야 하고, 이를 놓치면 청약 기회를 잃게 됩니다.

**청안**은 모집공고 페이지를 주기적으로 모니터링하여 새 공고(최초 모집 / 추가 모집)를 감지하고,
사용자에게 즉시 알림을 보내는 서비스입니다.

## 주요 기능

🚧 현재 개발 중입니다.

- [ ] 새 모집공고 자동 감지 (크롤링 기반)
- [ ] 웹 푸시 알림
- [ ] 지역구 / 공고 유형 필터 알림
- [ ] 공고 타임라인 시각화
- [ ] 지도 기반 단지 위치 표시

## 기술 스택

| 영역       | 기술                                                                    |
| ---------- | ----------------------------------------------------------------------- |
| Frontend   | Next.js (App Router), TypeScript, Tailwind CSS, Zustand, TanStack Query |
| Backend    | Next.js Route Handlers, Supabase                                        |
| Testing    | Vitest, Playwright, MSW                                                 |
| CI/CD      | GitHub Actions, Vercel, Lighthouse CI                                   |
| Monitoring | Sentry                                                                  |

## 문서

- [기획안](./docs/PROJECT_PLAN.md)
- [프로젝트 프로세스](./docs/PROCESS.md)
- [코딩 컨벤션](./docs/CODING_CONVENTION.md)
- [ADR (Architecture Decision Records)](./docs/adr/)

## 시작하기

```bash
# 의존성 설치
pnpm install

# 개발 서버 실행
pnpm dev

# 테스트 실행
pnpm test

# 빌드
pnpm build
```

## 라이선스

[MIT](./LICENSE)
