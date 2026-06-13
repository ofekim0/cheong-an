# Sprint 1 회고

- **기간**: 2026-04-02 ~ 2026-06-09 (Phase 1 Sprint 1, PROJECT_PLAN 기준 "크롤링 파이프라인"). 주요 묶음은 #11(크롤링 파이프라인 — Step 4~5) / #12(Supabase 저장 통합 — Step 7) / #13(스케줄러 — Step 8) / #36(부트스트랩 픽스). 진행 중 epic #19(데이터 소스 재설계, Step 6) 우회로가 발생해 `parseMainPage`/`checkBoardId` 전 라인을 폐기하고 JSON+view.do 하이브리드로 갈아엎었다.
- **배운 것**: 실제로 테스트 코드를 작성해본 건 이번이 처음. Vitest를 활용한 테스트 작성 및 문법 적용 방법을 Step 4 `parseDetailPage` 단위 테스트부터 Step 5-d MSW 통합 테스트까지 누적 67개 케이스를 쌓으면서 체득했다. 의존성 주입은 `announcementService`의 `fetcher`/`viewFetcher`/`rateLimiter` override, Supabase 리포지터리의 클라이언트 인자 분리 같은 자리에서 테스트하기 좋은 코드의 모양을 직접 만져보며 그 유용성을 알게 됐다.
- **막힌 것**: 부트스트랩 상태에서의 fetch → rate-limit → retry 로직 구상 및 적용이 Step 5에서 가장 무거웠고, 결국 5-a(fetch+retry)/5-b(rateLimit)/5-c(announcementService 합성)/5-d(MSW 통합 테스트)로 쪼개서 진행했다. catch-up 진단(#36)은 시드값 `last_board_id=0`이 109분짜리 view.do 루프를 만든다는 사실을 잡기 전에 가설 A/B/C가 모두 빗나간 채로 시간을 썼고, 결과는 ADR 005 + 트러블슈팅 노트로 정리.
- **다음에 바꿀 것**: —
