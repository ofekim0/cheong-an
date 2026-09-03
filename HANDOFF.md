# HANDOFF: 청안 프로젝트 — Claude Code 인계 문서

> 이 문서는 Claude.ai에서 진행한 기획/의사결정 세션의 결과물입니다.
> **2~10장은 Step 1 인계 시점의 스냅샷**이며, 이후 진척은 아래 "0. 최신 상태"에 갱신합니다.

---

## 0. 최신 상태 (2026-09-02 기준)

### ✅ 완료 — 공고 목록 페이지 (#83, 2026-09-02 이슈 닫음)

**MVP 경로가 연결됐다: 새 공고 → 크롤링 감지 → 구독자 알림 → 웹에서 확인.** Step a(조회 리포지토리, PR #84)·b(목록 페이지 셸, PR #87)·c-1(리포지토리 필터, PR #89)·c-2(렌더링 모델 + 페이지네이션, PR #90)·c-3(필터 UI, PR #91) 전부 머지. 유닛 243 → **294**.

**단, Sprint 2 항목은 3개 남았다** — #86(파서 날짜 매핑, 잠복) / 공고 상세 페이지 / UI 디자인 일괄 작업. 마일스톤(MVP 경로)은 달성했지만 Sprint 종료는 아니므로 **회고는 잔여 3건 완료 후**에 쓴다(지금 쓰면 미완 항목이 그대로 남아 종료 시점에 또 써야 한다).

**다음 작업 순서**(의존 관계상): ~~① `'use cache: remote'` 캐시 적중 확인~~(2026-09-02 완료 — 위 c-2 문단) → **① #86** → ② 상세 페이지 → ③ UI 디자인 → ④ 회고. **#86이 상세 페이지보다 앞인 이유**: #86의 결론(매핑만 정정 / 필드명까지 / 없는 필드 `applicationEndDate`·`resultDate` 제거)이 **상세 페이지가 렌더할 필드 목록을 결정**한다. 순서를 뒤집으면 Step b에서 카드가 전부 `~ 미정`으로 나왔던 판단을 상세 페이지에서 한 번 더 반복하게 된다. 상세 페이지를 먼저 하고 싶다면 그 두 필드를 **아예 렌더하지 않는 것**으로 시작하면 충돌하지 않는다(`parseDetailPage`가 항상 null을 반환하므로 사실에 부합).

**Step c-3 완료·머지**(PR #91, 2026-09-02) **— 필터 UI**. 공고 유형·모집 구분을 URL 쿼리(`?type=`·`?recruitment=`)로 걸고, `AnnouncementFilterBar`(서버 컴포넌트 + 링크, JS 0)로 노출한다. 파싱은 `src/lib/announcements/parseListParams.ts`로 분리해 테스트를 붙였다(`parsePageParam`도 c-2의 페이지 파일에서 여기로 이동) — 공개 쿼리스트링은 누구나 바꿀 수 있어 "잘못된 입력을 어떻게 다루는가"가 곧 방어선이고, 원칙은 **모르는 값은 무시**(제약 없음으로 취급, 400·500 아님)다. enum이라 화이트리스트로 닫아 검증하고 배열로 온 값은 첫 값만 쓴다. **필터 변경 시 `page`를 버리고, 페이지 이동 시 필터는 유지한다**(`baseParams`) — 전자를 유지하면 4페이지에서 필터를 걸었을 때 빈 화면이 뜬다. 빈 목록 문구는 셋으로 갈랐다(조건 불일치 / 페이지 범위 초과 / 진짜 0건 — 사용자가 취할 행동이 각각 다르다). 유닛 261 → 294. 학습 문서·ADR 없음 — c-2 패턴의 적용이고 ADR 013이 이미 "c-3은 인자 추가로 끝난다"까지 적어뒀다. 프로덕션 스모크로 집계 정합 확인(공공 1 + 민간 68 = 69, 최초 13 + 추가 56 = 69).

**Step c-1 완료·머지**(PR #89, 2026-09-02): `listAnnouncements`에 `filters?: { announcementType?, recruitmentType? }` 추가. 두 차원을 고른 이유는 둘 다 NOT NULL + 닫힌 enum이라 필터 옵션을 코드 상수로 고정할 수 있고 "미기재" 정책이 필요 없기 때문이다. `district`는 nullable이고 `extractDistrict`가 사이트 원문(`view_data`의 마지막 option 텍스트)을 정규화 없이 담아 제외했다. **필터 적용을 `applyFilters` 한 곳으로 모은 것이 핵심** — 목록 조회와 범위 초과 시 fallback count가 같은 조건을 받아야 하고, 한쪽에만 걸리면 에러 없이 `total`만 어긋나 총 페이지 수가 틀린다. 함정: `applyFilters`에 구조적 제약(`T extends { eq(...): T }`)을 걸면 Supabase 빌더의 재귀 제네릭을 물고 들어가 **TS2589**가 난다 — 제약 없는 `T`로 받고 좁히기를 함수 내부에 가뒀다. 유닛 254 → 261.

**Step c-2 완료·머지**(PR #90, 2026-09-02) **— 렌더링 모델을 Cache Components로 전환**. `searchParams`는 request-time API라 읽는 순간 라우트 전체가 동적이 되어 **Step b의 ISR과 양립하지 않는다**(조회가 `fetch`가 아니라 Data Cache 폴백도 없음). `cacheComponents: true`로 켜고, 페이지는 async가 아니게 두어 `searchParams` promise를 Suspense 하위로 내려보내며, 조회는 `'use cache: remote'` + `cacheLife('hours')` + `cacheTag(ANNOUNCEMENTS_CACHE_TAG)`로 감쌌다. cron은 `revalidatePath` → **`revalidateTag(tag, { expire: 0 })`**. 근거·선택지·배제한 접근은 **ADR 013**이 단일 출처, 보편 패턴은 `docs/learning/step83-cache-components.md`(선행 `step83-isr.md`는 §2·§5가 무효가 되어 상단에 포인터만 붙이고 내용은 박제). 페이지네이션 UI는 `AnnouncementPagination`(서버 컴포넌트, 1페이지는 `?page=1`을 붙이지 않음). 브라우저 검증: 69건 → 4페이지, `?page=999` → 빈 페이지 안내, `?page=abc` → 1페이지.

**c-2에서 코드 읽기로 세운 추정 2건이 빌드로 뒤집혔다**(같은 실수 반복 방지): ① `force-dynamic`이 붙은 API 라우트 3개는 "opt-out이라 영향 없음"이 아니라 **`cacheComponents`와 비호환이라 제거 대상**이었다(cron은 `request.headers` 접근으로 동적 실행이 보장되므로 제거해도 안전). ② **Step b의 자격 증명 가드는 근거가 소멸해 제거했다** — PPR에서 목록 조회는 `searchParams` 뒤에 있어 빌드 시점 프리렌더가 아예 호출하지 않는다(env 없는 빌드에서 경고 로그 미출력으로 확인). 근거 없는 가드를 남기면 자격 증명이 빠진 배포가 에러 대신 "공고 없음"으로 위장된다. **미검증이던 remote 캐시 적중은 2026-09-02 프로덕션에서 확인됐다** — 웜 0.33~0.37s vs 콜드 최대 1.0s, 콜드 키의 두 번째 요청이 웜 수준으로 하락. 웜/콜드 교차 요청으로 람다 웜업을, 1페이지 고정으로 fallback count를 각각 상쇄했다. 측정 절차와 한계(헤더 노출이 없어 타이밍 추론)는 ADR 013 "캐시 적중 검증".

**c-2에서 CI가 한 번 빨개졌다 — 로컬에서 재현되지 않는 종류였다.** `PageProps<'/announcements'>` 전역 헬퍼는 `next dev`·`next build`·`next typegen`이 `.next/types`에 **생성**하는 타입인데, CI는 typecheck를 build보다 먼저 돌린다(lint → format → typecheck → test → build). 로컬은 이미 빌드해서 `.next/types`가 남아 있어 통과했다. `searchParams` 타입을 파일 안에 직접 정의해 생성 타입 의존을 제거했고(PR #90의 `2bc6dfa`), **검증도 CI 조건으로 한다: `rm -rf .next && npx tsc --noEmit`.** 생성 타입(`PageProps`·`LayoutProps`·`RouteContext`)을 새로 쓸 때 같은 함정을 밟으므로 주의.

**Step b 완료·머지**(PR #87, 2026-09-01): `/announcements`가 비로그인으로 최신순 20건을 렌더한다. `formatAnnouncement`(표시용 순수 함수 — 라벨 맵·날짜, 날짜는 `Date` 파싱 없이 문자열로 다룸: DB가 DATE라 UTC 자정 해석으로 렌더 환경 타임존에 따라 하루가 밀린다) + `AnnouncementCard`(표시 전용 서버 컴포넌트, 링크는 알림과 동일한 soco `view.do` — 상세 라우트 생기면 URL 빌더만 교체) + 페이지 라우트 + 홈 링크. 유닛 243 → 254. 학습 문서 **작성 완료**(`docs/learning/step83-isr.md`).

**⚠️ 아래 두 문단은 c-2가 대체했다 — 되살리지 말 것** (경위는 ADR 013 "배제한 접근"):

- ~~**ISR은 시간 기반 + 온디맨드 병행**(페이지 `revalidate = 3600` 상한 + cron의 `revalidatePath(ANNOUNCEMENTS_PATH)`)~~ → **세그먼트 설정은 `cacheComponents`와 비호환이라 제거**했고, 무효화는 태그 기반(`revalidateTag`)으로 옮겼다. 다만 **호출 시점 규칙은 그대로 유효**하다: `upsert`·`lastBoardId` 갱신 완료 후 발송 전(저장 전이면 낡은 상태를 캐시에 굳히고, 발송 뒤면 발송 지연만큼 웹 반영이 밀린다), **신규 0건이면 미호출**(평시 크롤 대부분이 이 경로). 태그 문자열도 경로와 같은 이유로 `src/constants/announcements.ts`에서 공유한다 — 어긋나면 조용히 실패한다.
- ~~**ISR 페이지는 빌드 중에 DB를 부르므로 자격 증명 가드가 필요하다**~~ → PPR에서는 조회가 `searchParams` 뒤에 있어 **빌드가 호출하지 않는다.** 가드는 제거했다. 다만 배제 사유는 유효하다: **CI에 테스트 Supabase 시크릿을 주입하지 말 것** — 빌드가 테스트 DB 가동 상태에 묶여, e2e에서 두 번 겪은 pause → `ENOTFOUND` 적색이 빌드 단계로 번진다.

**브라우저 검증에서 데이터 표기 오류를 발견해 함께 고쳤다.** 초안의 `모집 {시작} ~ {마감}`이 전 카드에서 `~ 미정`으로 나왔고, 추적 결과 DB 68건 전부 `application_end_date`·`result_date`가 null이었다. 원인은 파서 버그가 아니라 **소스에 그 데이터가 없기 때문** — view.do(boardId 6644) 메타 영역의 날짜 항목은 '공고게시일'·'청약신청일' 둘뿐이고 마감일·발표일이 존재하지 않는다. 카드를 **`청약신청 {날짜}` 단일 날짜 표기**로 바꿨다(`applicationEndDate`는 `parseDetailPage`가 항상 null을 반환해 값이 들어올 경로가 없어 렌더하지 않는다). 파생 결함은 **#86으로 분리** — `parseListJson`이 `optn1`(공고게시일)을 `applicationStartDate`로, `optn4`(청약신청일)를 `applicationEndDate`로 매핑한다. 저장 경로가 `parseDetailPage` 출력만 쓰므로(ADR 003 옵션 B) 현재 잠복 상태이며, 필드명 정정·없는 필드 제거는 스키마 변경이라 별도 판단이 필요하다.

**조회 경로는 서버 전용(service role)으로 확정** — 착수 전 확인 결과 `announcements`(마이그레이션 00001)는 GRANT도 RLS도 없어 **anon 키 직접 조회가 401(`42501`)로 막혀 있다**(Supabase 신규 테이블 자동 GRANT 폐기 2026-05-30~, 00002가 갖춘 "GRANT로 열고 RLS로 잠근다" 패턴에서 `announcements`만 누락). 다만 목록 페이지는 조회가 서버에서만 일어나고(c-2 전환 후에도 동일 — `'use cache: remote'` 함수가 서버에서 실행) `announcementsRepository`는 이미 `getSupabaseAdminClient()`(RLS 우회)를 쓰므로 **마이그레이션 없이 진행 가능**하다. 공개 읽기 개방(`GRANT SELECT TO anon` + RLS + 전체 허용 SELECT 정책)은 **클라이언트 사이드 필터가 실제로 필요해지는 Sprint 3**으로 미뤘다 — 근거·배제 사유는 #83 본문. ADR은 쓰지 않았다(마이그레이션 추가는 가역적이라 회귀 위험이 없고, 실제로 여는 Sprint 3 시점에 쓰는 게 근거가 명확).

**Step a 리포지토리 계약 2가지**(Step b가 이어받았고 Step c도 그대로 쓴다): ① `listAnnouncements(client, { page, pageSize }) → { items, total }`, ② **범위를 벗어난 page는 throw가 아니라 빈 페이지 + 실제 total**이므로 404·리다이렉트 판단은 호출자 몫이다(PostgREST가 offset 초과에 빈 배열이 아닌 `PGRST103`/HTTP 416을 반환하는 것을 리포지토리가 흡수). 정렬은 `post_date DESC, board_id DESC` — `post_date`가 DATE(일 단위)라 실 데이터 68건 중 최소 10개 날짜가 중복이고, 동률을 남기면 페이지 경계 row가 누락·중복된다.

**이슈 정리**(2026-08-31): 완료됐는데 열려 있던 #6(Vercel 연동)·#39(웹 푸시)·#42(크롤 동결)·#50(소셜 로그인)을 근거 코멘트와 함께 닫았다. #50은 카카오 실 브라우저 로그인 스모크만 미검증이며(코드 경로는 provider 무관 동일) 이슈 코멘트에 남겼다. #83도 2026-09-02에 닫았으므로(위 "✅ 완료 — 공고 목록 페이지") **현재 열린 이슈는 #86**(파서 날짜 매핑, 잠복) 하나다.

### ✅ 완료 — 크롤 파서 row 격리 (#72, 2026-08-31 이슈 닫음)

#68·#42로 두 번 밟은 크롤 동결의 **구조 원인**을 제거했다(PR #81). `parseListJson`이 항목 하나의 매핑 실패에서 목록 전체를 throw로 중단하던 것을 **row 단위 격리**로 전환 — 출력 계약을 `AnnouncementListItem[]` → `{ items, isolated }`로 바꾸고, row 매핑을 try/catch로 감싸 항목 단위 실패는 전부 격리한다(사유·boardId 동반, 명시 shape 가드로 `boardId`·`nttSj`·`regDate` 이상도 읽을 수 있는 사유로 표면화). 이로써 상세 크롤 경로에만 있던 row 격리(ADR 007)와 목록 경로가 대칭이 됐다.

**격리 vs 중단 경계는 ADR 012**가 단일 출처 — ADR 006(카나리로 구조 변경 감지)과의 긴장을 세 줄 규칙으로 해소했다: ① JSON 자체 invalid → 기존대로 throw(500), ② 항목 단위 실패 → 해당 row만 격리 + 응답·로그 표면화, ③ **전 항목 격리(유효 0건) → 기존 `LIST_EMPTY` 불변식이 500으로 차단**. ③ 덕분에 불변식 코드는 무변경으로 경계가 성립한다. `latestBoardId`는 격리 row의 boardId도 포함해 전진(최신 항목이 격리되면 매 회차 재관측되는 영구 노이즈 차단)하되, 유효 0건이면 전진시키지 않아 카나리가 잡게 둔다.

**배제한 접근 2건도 ADR 012에 기록**(회귀 방지): 격리율 임계값 경보는 ADR 006이 드리프트 추적을 보류한 것과 같은 이유(운영 이력 없는 임계값은 검증 불가능한 추측)로 배제. **격리 row를 view.do로 살리는 접근**도 배제 — 저장 데이터는 전부 `parseDetailPage` 출력이라 기술적으로 가능하지만(ADR 003 옵션 B), 상세 파서의 분류도 제목 휴리스틱이므로 사이트가 진짜 새 카테고리를 도입하면 그것을 추측해 저장하게 된다. 알림 매칭·필터가 그 분류에 의존하므로 오분류 저장이 알림 1건 유실보다 비싸다. #69·#71의 제목 폴백은 유지(복원 가능한 미기재는 데이터로 살리고, 복원 불가능한 이상만 격리).

소비자 정합: `announcementService`(결과에 `isolatedListRows`, 전 페이지 누적 / 후보·페이지네이션 경계는 유효 items 기준), `canary`(불변식을 유효 items에 적용), cron route(응답 `isolatedListRows` + `console.warn`). 유닛 213 → **225**. 학습 문서는 작성하지 않았다 — 새 기술 도입이 아니라 가용성 vs 데이터 정합성 트레이드오프 판단이고 ADR 012가 온전히 담는다.

### ✅ 완료 — Sprint 2 이메일 알림 채널 (#65, 2026-08-28 이슈 닫음)

**웹 푸시 파이프라인(#39, 9-a~d)·소셜 로그인(#50)은 완료·머지**됨(경과는 아래 기록). Sprint 2 두 번째 작업 **이메일 알림 채널(#65)**을 완결 — 역량 기반 opt-in(이메일 주소 있는 계정만 이메일 채널 노출, provider 하드코딩 없음) + 채널 플러그형 발송으로 설계하며 궁극 목표 알림톡(Phase 4)의 사전 리팩터링을 겸했다. 근거: **ADR 011**. Step a / b-1 / b-2 / c로 분할, 전부 머지(PR #66·#75·#77·#79). 잔여는 실발송 수동 스모크뿐 — Resend 도메인 미검증 제약(계정 이메일로만 발송 가능, `learning/step65-resend` §4)으로 **도메인 검증 시점으로 연기**. env(`RESEND_API_KEY`·`EMAIL_FROM`)는 주입돼 있고, 조건 미비 상태에서도 이메일 채널만 `notifications.email.error`로 실패하고 크롤·웹푸시는 정상.

**Step a 완료·머지**(PR #66, 2026-08-03): 웹 푸시 전용 L1(`push_preferences`)을 계정 단위 멀티채널 `notification_preferences`로 일반화 — `enabled`→`web_push_enabled`, `email_enabled` 추가(마이그레이션 00003, RENAME으로 정책·트리거·GRANT 승계). `notificationPreferencesRepository`(채널별 `setChannelPreference`/`getChannelPreference` — 해당 채널 컬럼만 UPSERT해 상대 채널 미클로버) + 이메일 opt-in 경로(`POST/DELETE /api/notifications/email`, POST는 이메일 없는 계정 400 게이팅) + `EmailSubscribeButton` + `/subscribe`에 `user.email` 있을 때만 이메일 토글 노출(역량 게이팅). 웹 푸시 코드(`getEnabledChannels`·subscribe route·e2e 스펙)는 새 컬럼명으로 이관(동작 동일). **프로덕션·테스트 Supabase에 00003 적용 완료**. 유닛 176 + e2e 8/8. 발송 연결은 Step b, 학습 문서(Resend)는 발송 완결되는 Step c 시점.

**Step b는 b-1/b-2로 분할**(규모 기준 — 순수 리팩터와 신규 채널을 분리). **Step b-1 완료·머지**(PR #75, 2026-08-27): `notificationService`를 채널 어댑터 순회로 일반화(ADR 011 축2) — `ChannelAdapter` 계약(`{sent, failed, expired}` 집계, 웹푸시/이메일의 만료 정리 비대칭은 `expired`로 흡수) 신설, 9-c 발송 로직을 `webPushAdapter`(`createWebPushAdapter`)로 이동(동작 무변경), 서비스를 `src/lib/notifications/`로 이동 + `dispatchNotifications(adapters)` 격리 순회(채널 throw는 해당 채널만 `{error}`, 격리를 cron try/catch에서 서비스로 승격). cron 응답 `push` → `notifications: {web_push}` 일반화(GHA는 status만 봐 운영 무영향). 유닛 189. Step b 관련 의사결정: 이메일 주소 조회는 `auth.admin.getUserById` 계정별(opt-in 수만큼만 호출), Resend는 공식 SDK 사용. 참고: e2e CI 실패 시 테스트 Supabase(cheong-an-test) pause 여부 먼저 확인(`ENOTFOUND` → 대시보드 Resume — 이번에도 재발).

**Step b-2 완료·머지**(PR #77, 2026-08-28): 이메일 발송 어댑터 — `buildEmailPayload`(1건=제목 subject+`view.do` 링크, N건=개별 나열[이메일은 본문 공간이 있어 웹푸시처럼 안 뭉침], 크롤 1회당 1통, 제목 HTML 이스케이프) + `emailClient`(Resend SDK 얇은 어댑터 — `RESEND_API_KEY`·`EMAIL_FROM` 미설정 throw, 실패를 `{ok, statusCode, message}`로 정규화) + `emailRecipientsRepository`(`email_enabled` 계정 → `auth.admin.getUserById`로 주소 확보, 주소는 미저장·발송 시점 조회[ADR 011 축3], 주소 없는 계정·개별 조회 실패는 스킵) + `emailAdapter`(ChannelAdapter 둘째 구현, 수신자별 격리, `expired`는 항상 0, 실패 로그에 주소 대신 userId) + cron `adapters: [webPushAdapter, emailAdapter]` → 응답 `notifications.email`. env 미설정이면 이메일 채널만 `error`로 표면화되고 크롤·웹푸시 정상(env 주입 전 머지 안전). `resend 6.24.0` 추가. 유닛 213. **이로써 Step b 완결.**

**Step c 완료·머지 — #65 마무리**(PR #79, 2026-08-28): `getEmailRecipients` 실 DB e2e — 2단 조회(`email_enabled` 필터[실 PostgREST] + `auth.admin.getUserById` 주소 확보[실 Auth admin API])는 유닛이 mock으로만 덮어 실 관통을 e2e로 검증(9-d-c `getEnabledChannels` e2e와 같은 논리, ADR 010). 전용 계정 2개 + serial 모드, `setEmailPreferenceRow` 헬퍼 추가. GHA e2e job은 전체 스펙을 돌려 자동 편입(workflow·secrets 무변경 — Resend 미사용). 실 Resend 발송·주소 없는 계정 스킵은 자동화 경계 밖(각각 수동 스모크·유닛). e2e 10/10. 학습 문서 **작성 완료**(`docs/learning/step65-resend.md` — 에러-as-value 어댑터 정규화, 도메인 검증 모델과 미검증 제약, SDK 생성자 모킹 함정).

**아래는 완료된 웹 푸시(#39)·로그인(#50) 경과 기록:**

Sprint 2 1번 작업(웹 푸시 파이프라인, #39)을 Step(9-a~d)으로 쪼개 진행. **9-a 완료·머지**(PR #47): VAPID 유틸 + Service Worker 등록 + 구독 훅 + 임시 검증 UI까지 클라이언트 구독 경로 완성, 실제 Chrome에서 구독→endpoint 생성 end-to-end 검증.

**방향 전환(2026-06-25)**: 9-b 설계 중 서비스를 **로그인 사용자 기준**으로 운영하기로 결정 — 구독·발송·필터를 처음부터 `user_id`로 묶는다. 익명으로 먼저 만들면 나중에 user 연결 마이그레이션 + 고아 구독 정리로 두 번 일하므로, 순서를 바꿔 **소셜 로그인을 9-b 앞에 신규 편입**한다(근거: **ADR 009**). 이에 따라 ADR 008은 익명 → user 연결 모델로 **재작성**했고(`user_id` FK + RLS, endpoint UNIQUE·`410 Gone`은 유지), PROJECT_PLAN Sprint 2에 로그인을 편입했다(#50). 소셜 로그인은 50-a(SSR 기반)·50-b(로그인 UI + 게이팅)로 분할했고 **둘 다 머지 완료**(50-a PR #52, 50-b PR #53). #50은 코드 기준 완결이며 실제 OAuth 로그인 E2E만 외부 설정(대시보드·콘솔·env) 후 남는다. 학습 문서: `@supabase/ssr` SSR 패턴은 **작성 완료**(`docs/learning/step50-supabase-ssr-auth.md`), 웹 푸시(`step9-web-push.md`)는 발송까지 완결되는 9-c 시점에 작성 예정.

**9-b 완료·머지**(PR #55, 2026-07-13): 구독 상태를 **계정의 속성**으로 재설계 — 구독 의사(L1 `push_preferences`, 계정당 1 row + `enabled`)와 배달 채널(L2 `push_subscriptions`, `UNIQUE(user_id, endpoint)`)을 분리해 같은 기기의 계정 간 독립 + 같은 계정의 기기 간 공유를 동시에 충족. `POST /api/push/subscribe`(L2 UPSERT + L1 ON)·`DELETE`(L1 OFF만) + 구독 토글 UI + 마운트 재동기화(공유 브라우저에서 타 계정 채널 오판 갭 차단)까지 연결. 이 과정에서 ADR 008을 **2차 재작성** — 직전의 "endpoint 단독 UNIQUE + 409 소유권" 모델은 폐기(위 문단의 "endpoint UNIQUE 유지" 서술은 이 시점부로 무효). 학습 문서: Supabase RLS 정리 **작성 완료**(`docs/learning/step9b-supabase-rls.md`).

**9-c 완료·머지**(PR #58, 2026-07-20): 크롤 신규 감지 → 웹 푸시 발송 연결. `pushChannelsRepository`(L1 `enabled` 계정의 L2 채널 조회 + 만료 endpoint 삭제) + `buildNotificationPayload`(1건은 공고 제목 + soco `view.do` URL, N건은 집계 알림 — 내부 상세 페이지가 생기면 이 모듈의 URL 빌더만 교체) + `webPushClient`(`web-push` 어댑터, 실패를 statusCode 포함 결과 값으로 정규화) + `notificationService`(채널별 격리 발송 + `410`/`404` endpoint 정리 + `{sent, expired, failed}` 집계). `/api/cron/crawl`은 저장·`lastBoardId` 갱신 **완료 후** 발송하고, 발송 실패는 500이 아닌 응답 `push.error`로만 표면화(500이면 호출자 재시도 → 같은 공고 중복 발송이므로 유실을 수용 — ADR 008). 학습 문서: 웹 푸시 정리 **작성 완료**(`docs/learning/step9-web-push.md`).

**외부 선결 완료 + 실환경 수동 검증 성공**(2026-07-20): 외부 선결 3종(OAuth 콘솔·provider 설정 / 00002 마이그레이션 적용 / VAPID env 로컬·Vercel 주입) 모두 완료. 카카오 이메일(account_email)은 **비즈 앱 전용 권한**이라 동의항목에서 제외하고 Supabase Kakao provider의 **"Allow users without an email"** 로 대응 — 파이프라인은 email이 아닌 `user_id` 기준이라 영향 없음(이메일 알림 도입 시 카카오 사용자는 수신 주소 부재 유의). 검증: 로컬에서 구글 로그인 → 구독 토글 ON(L1·L2 row 생성 확인) → `last_board_id` 하향 후 크롤 트리거 → `push: {sent: 1}` + Chrome 알림 수신까지 **MVP 핵심 경로 관통 확인**. 이 과정에서 두 이슈를 밟고 해소: ① Supabase Redirect URLs를 경로 고정형에서 **globstar(`/**`)로 교체**(쿼리 파라미터 붙는 redirectTo가 매칭 실패 → Site URL 루트로 낙하하던 문제), ② **Supabase의 새 테이블 자동 GRANT 폐기**(2026-05-30~)로 `permission denied for table` — GRANT 명시로 해소, 마이그레이션 파일 백필 + RLS 학습 문서 §2 보강(이 커밋).

**9-d 완료·머지 — #39 웹 푸시 파이프라인 마무리**(2026-07-31, PR #61·#62·#63): E2E 자동화 범위를 **"소유 표면"으로 한정**하는 전략을 ADR 010으로 확정하고 9-d-a/b/c로 분할. 9-d-a(PR #61)는 실 OAuth를 우회하는 Playwright **세션 주입 하네스**(admin 유저 생성 + `signInWithPassword` → `@supabase/ssr` 쿠키 캡처 → storageState) + **전용 테스트 Supabase 프로젝트**(마이그레이션 00001·00002 적용, OAuth provider 불필요) + 구독 **게이팅 스펙**. 9-d-b(PR #62)는 **합성 구독**(PushManager 스텁)으로 구독 생성만 결정론화하고 클릭→POST→RLS→**실 DB 쓰기**를 검증 + 구독/해제(L1 enabled 토글, L2 보존) + **RLS 남의 row 거부**. 9-d-c(PR #63)는 `getEnabledChannels`의 2쿼리 조인을 **실 DB e2e**로 검증(Vitest+MSW 발송 통합은 기존 162 유닛과 중복이라 폐기 — ADR 010 개정) + **GHA e2e job 편입**(repo secrets 4종 + `.nvmrc` 24로 CI Node 20 WebSocket 오류 해소). 실 OAuth·실 `pushManager.subscribe` FCM 구독·실 FCM 배달/팝업은 자동화 경계 밖(수동 스모크 유지, ADR 010). **이로써 #39 웹 푸시 파이프라인(9-a~d) 완료.**

### ✅ 해소됨 — 크롤 동결 2차: optn5 미기재 (Issue #68, 2026-08-04)

2026-08-03 08:31 UTC부터 매시간 500으로 동결됐던 크롤을 PR #69로 해소(프로덕션 200 + 6624 저장 + `push: {sent: 1}` dispatch 검증). 원인: 신규 공고 6624(공공임대)가 `optn5`(모집유형) 미기재로 게시 → `toRecruitmentType` throw가 목록 전체 파싱을 중단. 수정: null/빈 값이면 `parseDetailPage`와 동일한 제목 휴리스틱('추가모집' → additional, 아니면 initial)으로 폴백, 미지의 코드는 기존대로 throw 유지(카나리 감지 경계 보존). 후속 방어: 쌍둥이 케이스인 `optn2`(공공/민간) 미기재도 동일한 제목 폴백('공공임대' → public, 아니면 private)으로 예방 완료(#71, PR #73 머지). 잔여 구조 이슈(한 항목의 매핑 실패가 목록 전체를 죽임 — ADR 007 row 격리와 상충)는 **#72로 분리**했고 **2026-08-31 완결**(PR #81, ADR 012 — 위 "✅ 완료 — 크롤 파서 row 격리" 섹션).

### ✅ 해소됨 — 크롤 파이프라인 동결 (Issue #42, 2026-06-18)

매시간 HTTP 500으로 동결됐던 크롤 파이프라인을 PR #45로 해소(프로덕션 500→200, DB 저장 검증). 근본 원인(boardId가 여러 게시판이 공유하는 전역 시퀀스 → gap-fill이 타 게시판 불량 row를 끌어와 배치 upsert 전체 실패)과 수정(gap-fill 폐기 → 목록 기반 크롤 전환)은 **ADR 007** 및 `docs/troubleshooting/2026-06-09-cron-bootstrap-catch-up.md`에 상세.

### 완료된 Step

| Step            | 내용                                                                                                                                                                                                                                                                                                                                                                                                             | 근거·산출물                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Step 2          | Next.js 초기화, Prettier/husky/lint-staged, Vitest/Playwright                                                                                                                                                                                                                                                                                                                                                    | `learning/step2-essentials`                                                                         |
| Step 3          | Vercel 연동 + GitHub Actions CI (lint·tsc·test)                                                                                                                                                                                                                                                                                                                                                                  | `learning/step3-ci-setup`                                                                           |
| Step 4          | 크롤 파서 + DB 스키마 + 타입                                                                                                                                                                                                                                                                                                                                                                                     | `learning/step4-{cheerio,vitest-basics,db-basics}` (※ `parseMainPage`·`checkBoardId`는 Step 6 폐기) |
| Step 5-a~d      | fetch+retry / rateLimit / `announcementService` 합성 / MSW 통합테스트                                                                                                                                                                                                                                                                                                                                            | `learning/step5-{fetch-html,retry,rate-limit,msw-testing}`                                          |
| Step 6          | 데이터 소스 재설계: JSON 목록(주) + view.do 하이브리드 (epic #19)                                                                                                                                                                                                                                                                                                                                                | ADR 002/003; PR #20~23·#25                                                                          |
| Step 6 정리     | `checkBoardId` 모듈 실제 삭제 + 이슈 본문 정리                                                                                                                                                                                                                                                                                                                                                                   | PR #27                                                                                              |
| Step 7          | Supabase 저장 통합: admin 클라 + `announcements` UPSERT + `crawl_state` 리포                                                                                                                                                                                                                                                                                                                                     | `learning/step7-*`; PR #29·#30                                                                      |
| Step 8          | 크롤 스케줄러: `/api/cron/crawl` + `crawl.yml` (1h cron + dispatch), `CRON_SECRET` 인증                                                                                                                                                                                                                                                                                                                          | ADR 004; `learning/step8-gha-cron-vercel-trigger`; PR #35                                           |
| Step 8 픽스     | 부트스트랩 catch-up 루프 픽스 — 시드 0이면 latestBoardId만 저장 (#36)                                                                                                                                                                                                                                                                                                                                            | ADR 005; `troubleshooting/2026-06-09-cron-bootstrap-catch-up`                                       |
| 크롤 동결 픽스  | 동결 해소 (#42): gap-fill 폐기 → 목록 기반 크롤, 페이지네이션 보전, row별 격리. 프로덕션 500→200 검증                                                                                                                                                                                                                                                                                                            | ADR 007; PR #43·#45                                                                                 |
| Step 9-a        | 웹 푸시 구독 클라 경로 (#39): VAPID 유틸 + SW 등록 + `usePushSubscription` 훅 + 임시 `/subscribe` UI. Chrome E2E 검증                                                                                                                                                                                                                                                                                            | PR #47 (서버 저장 9-b·발송 9-c)                                                                     |
| Step 50-a       | 소셜 로그인 SSR 기반 (#50): `@supabase/ssr` browser/server 클라 + 세션 미들웨어 + OAuth 콜백 라우트. typecheck/lint/96 tests (정적·단위)                                                                                                                                                                                                                                                                         | ADR 009; PR #52 (로그인 UI·게이팅 50-b)                                                             |
| Step 50-b       | 소셜 로그인 UI + 구독 게이팅 (#50): 구글·카카오 로그인/로그아웃 + `/subscribe` 게이팅 + `signInWithProvider`·`getSessionUser`. 103 tests (정적·단위, E2E는 외부 OAuth 설정 후)                                                                                                                                                                                                                                   | ADR 009; PR #53; `learning/step50-supabase-ssr-auth`                                                |
| Step 9-b        | 웹 푸시 구독 저장 (#39): L1/L2 분리 스키마(`push_preferences`/`push_subscriptions`, `UNIQUE(user_id, endpoint)`, RLS) + `POST/DELETE /api/push/subscribe` + 구독 토글 UI·마운트 재동기화. 132 tests                                                                                                                                                                                                              | ADR 008(2차 재작성); PR #55; `learning/step9b-supabase-rls`                                         |
| Step 9-c        | 웹 푸시 발송 (#39): 크롤 신규 감지 → L1 `enabled` 계정의 L2 채널 발송(`web-push`) + `410`/`404` 만료 채널 정리 + 크롤 응답에 `push` 집계(발송 실패에도 200 유지). 162 tests                                                                                                                                                                                                                                      | ADR 008; PR #58; `learning/step9-web-push`                                                          |
| Step 9-d-a      | 웹 푸시 E2E 인증 하네스 (#39): Playwright 세션 주입(admin 유저 + `signInWithPassword` → `@supabase/ssr` 쿠키 → storageState, 실 OAuth 우회) + 전용 테스트 Supabase 프로젝트 + `.env.test` 주입 + 구독 게이팅 스펙. e2e 4/4                                                                                                                                                                                       | ADR 010; PR #61                                                                                     |
| Step 9-d-b      | 구독/해제 E2E + RLS 소유권 거부 (#39): 합성 구독(PushManager 스텁)→클릭→POST→RLS→실 DB 쓰기 검증, 해제 시 L1 enabled=false·L2 보존, userA 세션이 userB row 조회 시 빈 결과. e2e 6/6                                                                                                                                                                                                                              | ADR 008/010; PR #62                                                                                 |
| Step 9-d-c      | 발송 채널 조회 실 DB E2E + CI 편입 (#39): `getEnabledChannels` 2쿼리 조인 실 DB 검증(enabled 계정 채널 포함/disabled 제외) + GHA e2e job(secrets 4종·Node 24) + 학습 문서. e2e 8/8. **#39 마무리**                                                                                                                                                                                                               | ADR 010(개정); PR #63                                                                               |
| 이메일 Step a   | 이메일 채널 스키마 일반화 + opt-in (#65): `push_preferences`→`notification_preferences`(`web_push_enabled`/`email_enabled`, 00003 리네임) + 채널별 리포 + `POST/DELETE /api/notifications/email`(이메일 없는 계정 400 게이팅) + `EmailSubscribeButton`·`/subscribe` 노출 게이팅. 웹 푸시 코드·e2e 새 컬럼 이관. 프로덕션·테스트 DB 적용 완료. 유닛 176 + e2e 8/8                                                 | ADR 011; PR #66 (발송 b·E2E/학습 c)                                                                 |
| 크롤 동결 2차   | optn5 미기재 공고(6624)로 목록 파서 전면 실패 → 제목 폴백으로 해소 (#68). 프로덕션 200·6624 저장·발송 검증. 쌍둥이 optn2 폴백 예방(#71) 완료, row 격리는 #72로 분리                                                                                                                                                                                                                                              | PR #69·#73                                                                                          |
| 이메일 Step b-1 | 채널 어댑터 리팩터 (#65): `ChannelAdapter` 계약 + 9-c 발송 로직을 `webPushAdapter`로 이동(동작 무변경) + `notificationService`를 `lib/notifications/`로 이동·어댑터 격리 순회로 일반화 + cron 응답 `push`→`notifications.web_push`. 유닛 189                                                                                                                                                                     | ADR 011 축2; PR #75 (이메일 어댑터 b-2)                                                             |
| 이메일 Step b-2 | 이메일 발송 어댑터 (#65): `buildEmailPayload`(N건 개별 나열·HTML 이스케이프) + `emailClient`(Resend SDK, 실패 정규화) + `emailRecipientsRepository`(`email_enabled` → `getUserById` 주소 확보, 미저장) + `emailAdapter`(수신자별 격리) + cron 배선 → 응답 `notifications.email`. `resend 6.24.0`. 유닛 213. **Step b 완결**                                                                                      | ADR 011; PR #77 (E2E·학습 문서 c)                                                                   |
| 이메일 Step c   | 수신자 조회 실 DB e2e + 학습 문서 (#65): `getEmailRecipients` 2단 조회(실 PostgREST + 실 Auth admin API) e2e 2종 + `setEmailPreferenceRow` 헬퍼 + GHA 자동 편입(무변경). 실발송은 자동화 경계 밖. e2e 10/10. **#65 완결·이슈 닫음**                                                                                                                                                                              | ADR 010/011; PR #79; `learning/step65-resend`                                                       |
| 파서 row 격리   | 목록 파서 row 단위 격리 (#72): `parseListJson` 출력 계약 `{ items, isolated }`로 변경 + 항목 단위 실패 전부 격리(shape 가드 포함) + 소비자 3곳 정합(`announcementService.isolatedListRows`·canary·cron 응답). 전 항목 격리는 기존 `LIST_EMPTY`가 500으로 차단(불변식 무변경). 유닛 225                                                                                                                           | ADR 012; PR #81                                                                                     |
| 목록 Step a     | 공고 목록 조회 리포지토리 (#83): `AnnouncementSummary`(`raw_content`·`address`·`attachment*` 제외) + `rowToSummary` 순수 매퍼 + `listAnnouncements` (`post_date DESC, board_id DESC` 전순서, `count: 'exact'`로 total 반환, 범위 초과 page는 `PGRST103`을 빈 페이지로 흡수 + head count로 total 확보, 잘못된 page/pageSize는 `RangeError`). 유닛 243                                                             | PR #84 (페이지 셸 b·필터 c)                                                                         |
| 목록 Step b     | 목록 페이지 셸 + ISR (#83): `/announcements` 첫 페이지 20건(service role 전용 조회) + `formatAnnouncement` 순수 함수 + `AnnouncementCard` + 홈 링크. 청약 날짜는 단일 날짜 표기(마감일이 소스에 없음 — 파생 결함 #86). 유닛 254. **※ 이 Step의 ISR 장치(`revalidate = 3600`·`revalidatePath`·자격 증명 가드)는 c-2가 전부 폐기** — 되살리기 전 ADR 013 필독                                                      | PR #87; `learning/step83-isr` (박제 — 후속은 `learning/step83-cache-components`)                    |
| 목록 Step c-1   | 조회 필터 지원 (#83): `listAnnouncements`에 `filters`(`announcementType`·`recruitmentType`) + **`applyFilters` 단일 지점**(목록 조회와 범위 초과 fallback count가 같은 조건을 받아야 함 — 한쪽만 걸리면 에러 없이 `total`만 어긋나 총 페이지 수가 틀린다). `district`는 nullable·비정규화로 제외(Sprint 3 재검토). 구조적 제약 제네릭은 Supabase 빌더 재귀 타입에서 TS2589 → 좁히기를 함수 내부에 가둠. 유닛 261 | PR #89                                                                                              |
| 목록 Step c-2   | 페이지네이션 + **렌더링 모델 전환** (#83): `searchParams`가 request-time API라 ISR과 양립 불가 → `cacheComponents`(PPR)로 전환. static shell + `'use cache: remote'` + `cacheTag`, cron은 `revalidateTag(tag, { expire: 0 })`(경로 무효화는 쿼리 조합을 지목 못 함). `dynamic`·`revalidate` 세그먼트 설정은 비호환이라 전면 제거(API 3곳), `/subscribe`도 Suspense 분리. 1페이지는 `?page=1` 미부착. 유닛 261    | **ADR 013**; PR #90; `learning/step83-cache-components`                                             |
| 목록 Step c-3   | 필터 UI (#83): `AnnouncementFilterBar`(서버 컴포넌트 + 링크, JS 0) + `parseListParams`(화이트리스트 검증 — **모르는 값은 무시**, `parsePageParam` 이관, round-trip 테스트) + 필터 변경 시 `page` 리셋·페이지 이동 시 필터 유지 + 빈 목록 문구 3분기. 유닛 294. **#83 완결·이슈 닫음**                                                                                                                            | PR #91                                                                                              |
| 운영·회고       | Sprint 1 운영 검증 (GHA dispatch 2회 success, `last_board_id` 6561 갱신) + Sprint 1 회고                                                                                                                                                                                                                                                                                                                         | `retrospectives/sprint-1`                                                                           |

> ADR 전체: `docs/adr/` — 001 기술스택, 002/003 데이터소스·매핑, 004 스케줄러, 005 부트스트랩, 006 크롤 출력 검증, 007 크롤 범위, 008 구독 저장 모델(구독 의사/배달 채널 분리), 009 소셜 로그인, 010 E2E 테스트 전략(소유 표면 자동화 + 실 OAuth·FCM 경계), 011 멀티채널 알림 모델(역량 기반 opt-in + 채널 플러그형 발송), 012 목록 파서 row 격리(격리 vs 중단 경계 — 국지적 오입력은 격리, 전면 붕괴는 `LIST_EMPTY`로 중단), 013 목록 페이지 렌더링 모델(Cache Components 전환 + 태그 기반 무효화 — 폐기한 접근 5건 포함).

### Sprint 1 완료 — 다음 Sprint 2 시작 준비

크롤링 파이프라인 본체 + Supabase 저장 + 스케줄러 + 부트스트랩 픽스 + 운영 검증 + 회고까지 Sprint 1 종료. 다음은 PROJECT_PLAN의 **Sprint 2 — 알림 시스템 + 기본 UI**(Week 4-5).

### 다음 할 일 — Sprint 2 (PROJECT_PLAN 4-1 참조)

**웹 푸시 파이프라인 (#39) 완료** — 9-a~d 전부 머지. 9-d(E2E 자동화)는 9-d-a(#61 세션 주입 하네스 + 게이팅) / 9-d-b(#62 구독·해제 + RLS 거부) / 9-d-c(#63 발송 채널 실 DB e2e + GHA e2e 편입)로 3분할 완료. 소유 표면만 자동화하고 실 OAuth·실 FCM 배달은 수동 스모크로 남긴 경계는 ADR 010. 프로덕션은 VAPID env 주입 완료로 매시간 GHA cron이 실운영 발송 중.

다음은 **Sprint 2 나머지**(아래):

운영 참고: VAPID 키 쌍은 로테이션하면 기존 구독이 전부 무효가 되므로 한 번 만들면 유지한다(`learning/step9-web-push` §2).

**9-a 머지 코드**: `usePushSubscription` 훅·`urlBase64ToUint8Array`·`sw.js`는 인증과 분리돼 무변경 재사용. `/subscribe` 게이팅은 **50-b에서 완료**(비로그인 시 로그인 유도, 로그인 시 구독 UI 노출).

이후 Sprint 2 나머지:

- ~~이메일 알림 (#65, ADR 011)~~: **완결·이슈 닫음**(2026-08-28, a→b-1→b-2→c 전부 머지 — 위 "✅ 완료" 섹션). 실발송 수동 스모크만 도메인 검증 시점으로 연기(크롤 트리거 → `notifications.email` 확인, 절차는 `learning/step65-resend` §4의 제약 참고)
- ~~크롤 파서 row 격리 (#72, ADR 012)~~: **완결·이슈 닫음**(2026-08-31, PR #81 — 위 "✅ 완료" 섹션)
- ~~공고 목록 페이지 (#83)~~: **완결·이슈 닫음**(2026-09-02, Step a→b→c-1→c-2→c-3 전부 머지 — 위 "✅ 완료" 섹션). 이월 항목이던 `'use cache: remote'` 캐시 적중도 프로덕션에서 확인 완료(ADR 013 "캐시 적중 검증")
- 파서 날짜 매핑 정정 (#86) — `parseListJson`이 `optn1`(공고게시일)·`optn4`(청약신청일)를 `applicationStartDate`/`applicationEndDate`로 잘못 매핑. 저장 경로가 detail만 쓰므로 잠복 상태로 운영 영향 없음. 매핑 정정만 / 필드명까지 / 없는 필드(`applicationEndDate`·`resultDate`) 제거 3단계 중 어디까지 갈지는 스키마 변경 판단 필요 — 2·3안은 ADR 대상 가능
- 공고 상세 페이지 (동적 라우트 `[boardId]`) — 이게 생기면 알림 URL 빌더(`buildNotificationPayload`·`buildEmailPayload`)를 soco `view.do`에서 내부 상세로 교체할 수 있다(9-c 주석에 명시된 교체 지점)
- 위 화면 확정 후 UI 디자인 일괄 작업 (v0/Lovable 등)

마일스톤 = MVP 완성: 새 공고 → 크롤링 감지 → 구독자 알림 → 웹에서 확인. **2026-09-02 #83 완결로 이 경로는 연결됐다.** 남은 세 항목(#86·상세 페이지·UI 디자인)은 MVP 경로 위의 개선이며, 셋을 끝낸 뒤 Sprint 2 회고를 쓴다.

#### 미해결 부수 의문 (운영에 영향 없음, 추후 확인)

- Next.js dev/turbopack이 109분짜리 핸들러를 약 3분(180초) 시점에 정상 200으로 logged한 메커니즘 — request body timeout, keepalive, 또는 다른 내부 타이머일 가능성. 부트스트랩 픽스로 더는 재현 안 됨

### 용어 매핑

HANDOFF의 "Step"은 `docs/PROJECT_PLAN.md`의 Phase 구조와 대응한다:

- Step 2–3 = Phase 0 (프로젝트 셋업)
- Step 4–5 = Phase 1 Sprint 1 (크롤링 파이프라인)

### 행동 지침

작업 중 자동 실행하지 말고 **권유만** 해야 하는 항목들은 `CLAUDE.md`의 "Claude 행동 지침" 섹션 참조 (커밋 전 브랜치 확인, ADR / Issue 생성 / 학습 문서 / 스프린트 회고 작성 권유 등).

---

## 1. 프로젝트 개요

- **프로젝트명**: 청안 (cheong-an)
- **한 줄 설명**: 청년안심주택 새 공고 알림 서비스 — 모집공고 모니터링 + 웹 푸시 알림
- **GitHub**: `ofekim0/cheong-an` (Public, MIT License)
- **목적**: 자기계발용 포트폴리오 (1순위) + 본인 실사용 서비스

---

## 2. 사용자 프로필

- 1년차 프론트엔드 개발자 (얼마니/Finelab, B2B 부동산 플랫폼)
- 현재 스택: React, TypeScript, Next.js (Pages Router), React Query, Zustand, Emotion
- 통계학 전공 (3년 이상 미사용)
- 서울 거주, 청년안심주택 실제 수요자

---

## 3. 완료된 작업 (Step 1 완료)

### 의사결정 완료 항목

| 항목            | 결정                             | 근거                                        |
| --------------- | -------------------------------- | ------------------------------------------- |
| 주제            | 청년안심주택 새 공고 알림 서비스 | 본인 실수요자, 기존에 전용 알림 서비스 없음 |
| 프로젝트명      | 청안 (cheong-an)                 | 청년안심주택 + 알림 줄임말                  |
| 알림 채널 (MVP) | 웹 푸시 + 이메일(보조)           | 카카오톡은 사업자등록 필요 → Phase 4로 연기 |
| 프로세스 방법론 | 스크럼 기반 경량 프로세스        | 1인 프로젝트에 맞게 경량화                  |
| 디자인 패턴     | 사전 확정 안 함                  | 필요 시 ADR로 기록                          |
| 패키지 매니저   | pnpm                             | 디스크 효율, 엄격한 의존성 관리, 설치 속도  |

### 크롤링 가능성 조사 (완료)

**데이터 소스**: https://soco.seoul.go.kr/youth/main/main.do

| 페이지                             | 렌더링 방식               | 크롤링 가능               |
| ---------------------------------- | ------------------------- | ------------------------- |
| 메인 페이지 (main.do)              | SSR — 최신 5건 HTML 포함  | ✅ HTTP GET               |
| 모집공고 리스트 (list.do)          | CSR — JS 동적 로딩        | ⚠️ AJAX 엔드포인트 미확인 |
| 개별 공고 상세 (view.do?boardId=N) | SSR — 전체 내용 HTML 포함 | ✅ boardId로 접근         |

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

| 기술                 | 선택 근거                                                                          |
| -------------------- | ---------------------------------------------------------------------------------- |
| Next.js (App Router) | 회사에서 Pages Router 사용 → App Router 전환. RSC, 병렬 라우트 학습. SSG/ISR 활용. |
| TypeScript           | 크롤링 데이터 타입 안전성                                                          |
| Tailwind CSS         | Emotion → Tailwind 전환. 번들 사이즈 최적화 (런타임 → 빌드타임)                    |
| Zustand              | persist middleware, selector 최적화 심화                                           |
| TanStack Query       | 공고 데이터 캐싱, 백그라운드 리프레시                                              |

### 백엔드 / 인프라

| 기술                         | 선택 근거                               |
| ---------------------------- | --------------------------------------- |
| Next.js Route Handlers       | 별도 백엔드 없이 크롤링/알림 API 구현   |
| Supabase                     | DB — 공고 데이터, 사용자 알림 설정 저장 |
| Vercel                       | 배포 + CI/CD                            |
| Vercel Cron / GitHub Actions | 주기적 크롤링 스케줄링                  |

### 테스트

| 도구       | 용도        |
| ---------- | ----------- |
| Vitest     | 단위 테스트 |
| Playwright | E2E 테스트  |
| MSW        | API 모킹    |

### 기타

| 도구           | 용도                                    |
| -------------- | --------------------------------------- |
| pnpm           | 패키지 매니저                           |
| GitHub Actions | CI 파이프라인 (lint, 타입 체크, 테스트) |
| Lighthouse CI  | 성능 측정 (Phase 3~)                    |
| Sentry         | 에러 모니터링 (Phase 3~)                |

---

## 5. 다음 단계 (Claude Code가 해야 할 것)

### Step 2: 프로젝트 초기화 (대부분 완료)

1. ~~**Next.js App Router 프로젝트 생성**~~ ✅
2. ~~**Prettier 설정**~~ ✅
3. ~~**husky + lint-staged 설정**~~ ✅
4. ~~**Vitest + Playwright 초기 설정**~~ ✅
5. **ADR 001 작성** ← 미완료
   - `docs/adr/001-tech-stack.md` — 기술 스택 선정 근거
   - ADR_TEMPLATE.md를 복사해서 작성

### Step 3: Vercel 연동 + CI ← 지금 여기부터

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
