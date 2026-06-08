# Step 8: GitHub Actions cron + Vercel Route Handler 트리거 — 학습 정리

> 외부 스케줄러에서 배포된 앱의 엔드포인트를 주기적으로 호출하는 패턴.
> 다른 프로젝트에도 그대로 적용 가능한 보편 패턴만 정리한다.
> 청안의 구체적 판단(왜 GHA를 골랐는지, 왜 1시간 간격인지)은 [ADR 004](../adr/004-scheduler-choice.md) 참고.

---

## 목차

1. [수행한 작업 요약](#1-수행한-작업-요약)
2. [외부 트리거 패턴: 스케줄러와 핸들러의 분리](#2-외부-트리거-패턴-스케줄러와-핸들러의-분리)
3. [GitHub Actions `schedule` 트리거](#3-github-actions-schedule-트리거)
4. [`workflow_dispatch` — 수동 트리거의 가치](#4-workflow_dispatch--수동-트리거의-가치)
5. [`curl --fail`이 워크플로우 실패와 연결되는 방식](#5-curl---fail이-워크플로우-실패와-연결되는-방식)
6. [`concurrency` 그룹](#6-concurrency-그룹)
7. [Next.js Route Handler의 `dynamic = 'force-dynamic'`](#7-nextjs-route-handler의-dynamic--force-dynamic)
8. [Bearer 토큰으로 외부 트리거 보호하기](#8-bearer-토큰으로-외부-트리거-보호하기)

---

## 1. 수행한 작업 요약

| 파일                              | 작업 | 목적                                                                                 |
| --------------------------------- | ---- | ------------------------------------------------------------------------------------ |
| `src/app/api/cron/crawl/route.ts` | 생성 | Bearer 인증 → 크롤 → DB UPSERT → 상태 갱신을 수행하는 Route Handler                  |
| `.github/workflows/crawl.yml`     | 생성 | 1시간 간격 `schedule` + `workflow_dispatch`로 위 엔드포인트를 `curl --fail`로 트리거 |
| `.env.example`                    | 갱신 | `CRON_SECRET` 항목 추가                                                              |
| `README.md`                       | 갱신 | 시크릿 등록(Vercel/GH Secrets), 수동/로컬 트리거 절차 명시                           |

**결과**: 외부 스케줄러(GHA)가 1시간마다 배포된 엔드포인트를 인증 토큰과 함께 호출한다. 토큰이 없거나 다르면 401로 거부된다.

---

## 2. 외부 트리거 패턴: 스케줄러와 핸들러의 분리

서버리스 환경(Vercel, Cloudflare Workers, Netlify 등)은 **항상 떠 있는 프로세스가 없다**. "1시간마다 무언가를 실행"하려면 두 가지 중 하나가 필요하다:

1. **플랫폼 내장 cron**: Vercel Cron, Cloudflare Cron Triggers 등 — 같은 플랫폼 안에서 닫힘.
2. **외부 스케줄러 + HTTP 호출**: GitHub Actions, EventBridge, n8n, cron-job.org 등 → 배포된 엔드포인트를 호출.

이번 패턴은 (2)다. 구조:

```
외부 스케줄러 ──HTTP──▶ /api/cron/* (앱 내 핸들러) ──▶ 비즈니스 로직
   (시간 트리거)         (인증 + 실행)
```

핵심 분리:

- **스케줄러는 "언제 시작할지"만 안다**. 무엇을 할지는 모름. 그저 URL을 친다.
- **핸들러는 "무엇을 할지"만 안다**. 누가 깨우든 상관없이 자기 일을 한다.

이 분리의 장점:

- 스케줄러를 다른 도구로 갈아끼울 수 있다(GHA → EventBridge 등). URL만 같으면 된다.
- 핸들러를 수동으로도 호출할 수 있다(개발 시 curl, 운영 시 워크플로우 수동 실행).
- 호스팅 플랫폼을 옮겨도 워크플로우는 그대로(URL만 갱신).

단점: 외부 경계를 거치므로 **인증 토큰이 필수**다. (8장 참조)

---

## 3. GitHub Actions `schedule` 트리거

```yaml
on:
  schedule:
    - cron: '0 * * * *'
```

### cron 표현식

5개 필드: `분 시 일 월 요일`. 위 표현은 "매시 0분에".

| 표현           | 의미                 |
| -------------- | -------------------- |
| `0 * * * *`    | 매시 0분             |
| `*/15 * * * *` | 15분마다             |
| `0 9 * * 1-5`  | 평일 오전 9시        |
| `0 0 * * 0`    | 매주 일요일 자정 UTC |

**시간대는 UTC**. 한국 시간(KST = UTC+9)으로 매일 아침 9시에 실행하려면 `0 0 * * *`(UTC 00시 = KST 09시)로 적는다.

### 정확도와 지연

GitHub Actions의 schedule은 **정확하지 않다**. 공식적으로 ±수 분 지연이 발생할 수 있고, 부하가 높을 때는 더 늘어진다. 분 단위 정확성을 요구하는 작업(예: 특정 시각에 메시지 발송)에는 부적합. 시간 단위 작업(예: 1시간마다 크롤링)은 무관.

### Public repo vs private

- Public repo: 사실상 무제한.
- Private repo: 무료 분 사용량(예: 2000분/월)에서 차감.

---

## 4. `workflow_dispatch` — 수동 트리거의 가치

```yaml
on:
  schedule:
    - cron: '0 * * * *'
  workflow_dispatch:
```

`workflow_dispatch`를 추가하면 GitHub UI에 **Run workflow** 버튼이 생긴다. 또는 `gh workflow run`으로 CLI 트리거도 가능.

왜 같이 두는가:

- **디버깅**: schedule 트리거가 실패했을 때 같은 워크플로우를 즉시 재실행해 원인 확인.
- **운영 개입**: "지금 한 번 더 돌려달라"는 요구를 코드 변경 없이 처리.
- **테스트**: 스케줄을 기다리지 않고 워크플로우 자체의 동작을 검증.

스케줄 트리거만 있고 수동 트리거가 없으면, 워크플로우 변경 후 "지금 동작하는지" 확인하기 위해 cron 다음 발화를 기다리거나 cron 표현식을 임시로 바꿔야 한다. 비용 거의 0인데 운영 효율은 크게 오르므로 **schedule을 쓸 때는 항상 같이 둔다**.

---

## 5. `curl --fail`이 워크플로우 실패와 연결되는 방식

```bash
curl --fail --show-error --silent \
  --max-time 120 \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "${DEPLOY_URL}/api/cron/crawl"
```

### `--fail`의 의미

`--fail`이 없으면 curl은 HTTP 응답 상태(200/400/500 등)와 **무관하게 성공 종료(exit 0)** 한다. 응답 본문은 출력되지만 셸 입장에서는 "curl이 응답을 받았다"로 성공.

`--fail`을 붙이면 4xx/5xx 응답에서 **curl이 exit 22로 비정상 종료**한다. GHA 워크플로우의 step은 마지막 명령의 exit code로 성공/실패를 판단하므로, 이 한 줄로 "HTTP 에러 = 워크플로우 실패"가 연결된다.

### 동반 플래그

- `--show-error`: `--silent`로 진행 표시를 숨겨도 에러 메시지는 표시.
- `--silent`: 진행률 막대 등 잡음을 제거 (CI 로그 정리).
- `--max-time 120`: 응답이 120초를 넘으면 강제 종료 → 무한 대기 방지.

### 함정: HTTP 200이지만 응답 본문이 에러

`--fail`은 HTTP 상태 코드만 본다. 핸들러가 내부 에러를 200 + `{ error: ... }`로 응답하면 curl은 성공이라고 판단한다.

→ **핸들러 측에서 실패는 반드시 4xx/5xx로 응답**하는 규약이 전제다. (route.ts에서 인증 실패 401, 내부 예외 500을 쓰는 이유)

---

## 6. `concurrency` 그룹

```yaml
concurrency:
  group: crawl
  cancel-in-progress: false
```

### 동작

같은 `group` 이름의 워크플로우 실행은 **동시에 하나만** 진행된다.

- `cancel-in-progress: true` — 새 트리거가 들어오면 기존 실행을 취소하고 새 것으로 교체. **CI에 적합**(같은 PR의 새 push를 검증하면 충분).
- `cancel-in-progress: false` — 기존 실행을 그대로 두고 새 트리거는 큐잉. **주기 작업에 적합**(작업 자체를 끊으면 중간 상태가 남을 수 있음).

### 왜 cron에 concurrency가 필요한가

이론적으로 1시간 간격이라 충돌이 없어 보이지만:

- 실행 시간이 길어져 다음 cron 발화와 겹칠 수 있음.
- `workflow_dispatch`로 수동 트리거할 때 schedule과 겹칠 수 있음.
- 두 실행이 동시에 같은 DB에 쓰면 경쟁 조건 위험.

→ `cancel-in-progress: false`로 직렬화. 큐잉된 두 번째 실행은 첫 번째가 끝나면 자동 시작.

---

## 7. Next.js Route Handler의 `dynamic = 'force-dynamic'`

```ts
export const dynamic = 'force-dynamic';

export async function GET(request: Request) { ... }
```

### 배경: Next.js의 자동 최적화

Next.js App Router의 Route Handler는 빌드 타임에 **정적으로 최적화**될 수 있다. 즉, 빌드 시 한 번 실행해 결과를 캐시하고, 이후 모든 요청에 같은 응답을 돌려준다. 같은 입력에 같은 출력을 주는 핸들러에서는 합리적이다.

### cron 엔드포인트에서 문제가 되는 이유

cron 엔드포인트는 호출될 때마다 **새로 크롤링하고 DB를 갱신**해야 한다. 빌드 타임에 캐시되면:

- 매 호출마다 같은 결과가 반환되어 실제 크롤링이 동작하지 않음.
- DB 갱신도 일어나지 않음.

### `force-dynamic`의 효과

`export const dynamic = 'force-dynamic'`을 선언하면 Next.js는 이 핸들러를 **항상 요청 시점에 실행**하도록 강제한다. 캐싱·정적화·서버 컴포넌트의 RSC 캐시를 모두 우회.

### 언제 필요한가

이 플래그가 필요한 핸들러의 공통점:

- 외부 상태(DB, 외부 API)를 읽거나 쓰는 핸들러.
- 시간 또는 요청별로 결과가 달라져야 하는 핸들러.
- 사이드 이펙트가 있는 핸들러(cron, 웹훅 수신 등).

GET이라도 사이드 이펙트가 있으면 동적이어야 한다.

---

## 8. Bearer 토큰으로 외부 트리거 보호하기

cron 엔드포인트는 인터넷에 노출된 URL이다. 누구나 발견하면 호출할 수 있고, 호출 비용·DB 부하·외부 사이트 부하가 모두 우리 비용이 된다.

### 최소 보호: 공유 시크릿 + Bearer 헤더

```ts
const secret = process.env.CRON_SECRET;
const header = request.headers.get('authorization');
if (header !== `Bearer ${secret}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

스케줄러 측은 같은 토큰을 헤더로 붙여서 호출한다:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" $URL/api/cron/...
```

### 시크릿 등록의 이중성

이 패턴은 **같은 값을 두 곳에 둔다**:

| 위치              | 키            | 역할               |
| ----------------- | ------------- | ------------------ |
| 앱 호스트(Vercel) | `CRON_SECRET` | 들어오는 요청 검증 |
| 스케줄러(GH)      | `CRON_SECRET` | 나가는 요청에 부착 |

두 곳 중 한쪽만 갱신하면 401로 끊긴다. **회전(rotation) 시에는 항상 두 곳 동시에**.

### 왜 이걸로 "충분한가"

이 보호는 약하지만 합리적이다:

- HTTPS로 토큰이 평문 노출되지 않음.
- 토큰을 모르면 401로 거부 → 실행 비용·DB 부하 0.
- Replay 공격은 가능하지만, 매시간 1회 호출이 추가로 일어나도 시스템적 의미는 없음.

더 엄격하게 가야 할 경우(예: 결제 트리거): 시간 기반 서명(HMAC + timestamp + nonce), mTLS, IP allowlist 등을 더한다. cron 트리거 정도에는 과한 투자.

### 환경변수 누락 시의 처리

`CRON_SECRET`이 비어 있을 때 인증을 건너뛰면 **사실상 보호가 사라진 채 운영**되는 위험이 있다. 안전한 디폴트는:

```ts
if (!secret) {
  return NextResponse.json(
    { error: 'CRON_SECRET is not configured' },
    { status: 500 },
  );
}
```

빈 시크릿이면 차라리 핸들러가 500으로 죽도록 한다. "조용히 보호가 풀린" 상태보다 "시끄럽게 실패"가 안전하다.
