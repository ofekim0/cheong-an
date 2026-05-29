# Vitest 단위 테스트 기초

## 1. 테스트를 왜 작성하는가

코드가 **의도대로 동작하는지 자동으로 확인**하기 위함. 수동으로 "실행하고 눈으로 보기" 대신 검증 코드를 짜두면:

- 수정 후 기존 기능이 깨지지 않았는지 즉시 확인
- CI에서 자동 실행되어 깨진 코드 머지를 방지
- 테스트 자체가 **"이 함수가 뭘 하는지"에 대한 문서** 역할

## 2. 기본 구조: describe → it → expect

```ts
import { describe, it, expect } from 'vitest';

describe('parseUser', () => {
  // 테스트 그룹
  it('이름과 나이를 추출한다', () => {
    // 개별 테스트
    const result = parseUser({ name: 'A', age: 20 });

    expect(result.name).toBe('A'); // 단언 (assertion)
    expect(result.age).toBe(20);
  });
});
```

| 키워드              | 역할                             | 비유              |
| ------------------- | -------------------------------- | ----------------- |
| `describe`          | 관련 테스트들을 묶는 그룹        | 시험지의 "대문항" |
| `it`                | 하나의 구체적 동작을 검증        | 시험지의 "소문항" |
| `expect(값).매처()` | 실제 값이 기대와 일치하는지 확인 | "정답 확인"       |

`it`은 `test`와 동일. 영어로 읽으면 "it extracts ..."처럼 문장이 되므로 `it`을 더 많이 쓴다.

## 3. 자주 쓰는 매처(matcher)

```ts
// 값 비교
expect(result).toBe(5); // === 비교 (원시값)
expect(result).toEqual([1, 2, 3]); // 깊은 비교 (객체/배열)

// 포함 여부
expect(arr).toHaveLength(5); // 배열/문자열 길이
expect(arr).toContain(6485); // 배열에 특정 값 포함
expect(str).toContain('keyword'); // 문자열에 부분 포함
expect(arr).not.toContain('x'); // not으로 부정

// null/undefined/빈값
expect(value).toBeNull();
expect(value).toBeUndefined();
expect(str).toBe(''); // 빈 문자열 — toBeNull과 구분

// 에러
expect(() => fn()).toThrow(); // 에러를 던지는지
expect(() => fn()).toThrow(/specific msg/); // 메시지가 패턴과 일치하는지
await expect(asyncFn()).rejects.toThrow(); // Promise rejection
```

## 4. fixture 패턴

**fixture**는 테스트에서 사용할 **고정된 입력 데이터**. 외부 시스템의 응답을 파일로 박제해서 쓴다:

```ts
const fixtureHtml = readFileSync(
  join(__dirname, '__fixtures__', 'sample.html'),
  'utf-8',
);

it('항목 5건을 추출한다', () => {
  const results = parse(fixtureHtml);
  expect(results).toHaveLength(5);
});
```

왜 fixture를 쓰는가:

- **재현 가능**: 매번 외부 시스템에 접속하면 데이터가 바뀐다. fixture는 항상 같은 입력 보장
- **오프라인 가능**: 네트워크 없이 테스트 실행 가능
- **변경 감지 (카나리)**: 외부 시스템이 응답 형식을 바꾸면 fixture를 갱신할 때 차이가 드러난다 — 파서를 미리 고칠 신호

**fixture는 데이터가 아니라 계약(contract)이다.** "외부 시스템은 이런 모양의 응답을 보낸다"는 우리 측 합의서. 합의서가 손으로 작성된 가짜라면 합의 자체가 없는 셈이다.

## 5. 실행

```bash
pnpm test              # 모든 테스트를 1회 실행
pnpm test:watch        # 파일 변경 감시 + 자동 재실행 (개발 중)
```

## 6. 좋은 테스트의 패턴

기본은 세 종류를 커버한다:

1. **정상 동작** — "5건을 추출한다", "값을 올바르게 매핑한다"
2. **엣지 케이스** — "빈 입력에서는 빈 배열을 반환한다"
3. **예외 처리** — "필수 필드가 없는 항목은 건너뛴다", "에러 응답을 던진다"

## 7. 함정

- **테스트가 그린이라고 운영에서 동작이 보장되는 건 아니다.** fixture가 손으로 작성된 가짜라면 더더욱. 실 응답으로 fixture를 박제하는 게 가장 강한 보장
- **`toBe` vs `toEqual` 헷갈리기 쉬움.** 객체/배열에 `toBe`를 쓰면 같은 참조여야 통과 → 거의 항상 `toEqual`
- **시간/난수에 의존하는 코드는 결정론적이지 않다.** 부수효과를 DI 포인트로 노출해서 테스트가 가짜 시계/난수를 주입할 수 있게 설계 (retry/rateLimit 모듈 참고)
