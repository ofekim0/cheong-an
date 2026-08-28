# Resend — 트랜잭셔널 이메일 발송, 에러를 값으로 돌려주는 SDK

Resend는 앱이 트리거하는 1:1 메일(알림, 인증, 영수증 — "트랜잭셔널 이메일")을 HTTP API로 발송하는 서비스다. SMTP 서버 운영, IP 평판 관리, SPF/DKIM 서명을 대신해 주고 앱은 API 호출만 한다. 이 문서는 이메일 채널(#65 Step b~c)을 붙이며 확인한 **어느 프로젝트에나 가져갈 보편 패턴**을 추린다. 청안 고유 결정(채널 어댑터 구조, 주소 미저장, N건 나열 페이로드)은 ADR 011 소관이다.

---

## 1. 멘탈 모델 — 발송 API는 셋이면 돈다

```
[앱 서버] ── POST /emails ──▶ [Resend] ── SMTP ──▶ [수신자 메일 서버] ─▶ 받은편지함/스팸함
   apiKey       from, to,        DKIM 서명,
                subject, 본문     평판 관리
```

SDK 기준 최소 호출:

```ts
const resend = new Resend(apiKey);
const { data, error } = await resend.emails.send({
  from: '서비스명 <noreply@내도메인>', // "이름 <주소>" 형식 지원
  to: 'user@example.com',
  subject: '...',
  html: '...',
  text: '...', // html만 보내지 말 것 — 스팸 필터·텍스트 클라이언트 대비 둘 다
});
```

- 무료 티어: 월 3,000통 / 일 100통 (2026-08 기준) — 알림 서비스 MVP에 충분.
- 발송 성공은 "Resend가 수리했다"이지 **배달 보장이 아니다**. 반송(bounce)·스팸 분류는 비동기로 일어나고 발송 응답에는 없다 — 웹 푸시의 201과 같은 성질. 반송을 다루려면 webhook을 따로 받아야 한다(초기에는 생략 가능).

## 2. 에러-as-value — SDK가 이미 정규화해서 돌려준다

`web-push`가 실패를 `WebPushError` **throw**로 알리는 것과 달리, Resend SDK는 실패를 **반환 값**으로 준다:

```ts
const { data, error } = await resend.emails.send({ ... });
// error: { name: string, statusCode: number | null, message: string } | null
```

이 차이가 어댑터 코드 모양을 결정한다:

| 라이브러리 | 실패 전달 | 어댑터가 할 일                             |
| ---------- | --------- | ------------------------------------------ |
| web-push   | throw     | try/catch로 잡아 결과 값으로 **변환**      |
| resend     | 반환 값   | 필드만 **매핑** (try/catch는 방어용으로만) |

어느 쪽이든 어댑터의 출력은 같게 맞춘다 — `{ ok: true } | { ok: false, statusCode, message }` 같은 **라이브러리 중립 결과 타입**. 상위 레이어(수신자 순회·집계)가 라이브러리 타입에 결합되지 않고, 라이브러리를 갈아타도 어댑터만 바뀐다. Resend처럼 값으로 주는 SDK도 **네트워크 계층 예외는 throw할 수 있으므로** 방어적 try/catch 한 겹은 유지한다.

수신자 단위 실패(잘못된 주소 등)를 값으로 돌려주면, 상위 레이어는 `Promise.all`로 병렬 발송해도 안전하다 — 한 명의 실패가 배치를 죽이지 않는다(격리는 집계 단계에서).

## 3. 자격 증명 — env 2종, 미설정은 조용히 스킵하지 말고 throw

발송에 필요한 설정은 `RESEND_API_KEY`(대시보드 발급, `re_...`)와 발신 주소(`EMAIL_FROM`) 둘이다. 읽기 패턴은 VAPID와 동일하게:

- **발송 경로에 들어온 시점에 없으면 throw** — 배포 설정 오류를 조용한 no-op으로 감추면 "알림이 안 온다"를 한참 뒤에야 알게 된다. throw는 상위의 채널 격리 레이어가 잡아 해당 채널 실패로만 표면화한다.
- 클라이언트 인스턴스는 **호출마다 생성해도 된다** — `new Resend(key)`는 키를 보관할 뿐이라 비용이 없고, 모듈 전역 초기화가 없으면 테스트 격리·초기화 순서 문제도 없다.

## 4. 도메인 검증 모델 — 미검증 상태의 함정

Resend(및 대부분의 이메일 API)는 **검증된 도메인의 주소만 From으로 허용**한다. 검증 전 개발 단계를 위한 테스트 경로가 있는데, 제약을 정확히 알아야 한다:

| 상태          | From 주소               | 발송 가능 대상             |
| ------------- | ----------------------- | -------------------------- |
| 도메인 미검증 | `onboarding@resend.dev` | **Resend 계정 이메일로만** |
| 도메인 검증됨 | `아무개@내도메인`       | 제한 없음                  |

미검증 상태의 "계정 이메일로만" 제약이 뜻하는 것: **수신자 주소가 Resend 가입 이메일과 다르면 발송이 거부된다**(403). 소셜 로그인 기반 앱에서 "로그인 계정의 주소로 발송"하는 구조라면, 스모크 테스트 때 **앱 로그인 계정 주소 == Resend 계정 이메일**을 맞춰야 한다 — 가입 provider(GitHub 등)가 아니라 **주소 문자열**이 기준이다.

도메인 검증 절차는 대시보드 → Domains → DNS에 안내된 TXT(SPF/DKIM) 레코드 추가 → Verify. 플랫폼 서브도메인(`*.vercel.app` 등)은 검증할 수 없으므로 **커스텀 도메인 보유가 전제**다. 검증 전까지는 실배달 검증을 연기하고 유닛 + 실 DB 조회 e2e로 커버하는 것이 현실적이다(실배달은 웹 푸시의 실 FCM 배달과 같은 자동화 경계 밖 — ADR 010).

## 5. 테스트 — SDK 생성자 모킹의 함정 하나

`new Resend(key)`로 생성하는 SDK를 vitest로 모킹할 때, mock 구현을 **화살표 함수로 주면 안 된다** — 화살표 함수는 생성자 호출(`new`)이 불가능해 `... is not a constructor`로 죽는다:

```ts
// ❌ TypeError: () => ... is not a constructor
vi.mock('resend', () => ({
  Resend: vi.fn(() => ({ emails: { send: sendMock } })),
}));

// ✅ function은 new 호출 시 반환 객체가 인스턴스를 대체한다
const ResendMock = vi.fn(function () {
  return { emails: { send: sendMock } };
});
vi.mock('resend', () => ({ Resend: ResendMock }));
```

모킹 경계는 SDK가 아니라 **어댑터의 발송 함수 시그니처**(`(to, payload) => Promise<결과>`)로 두는 게 상위 레이어 테스트를 단순하게 만든다 — SDK 모킹은 어댑터 자신의 테스트에서만 한다.
