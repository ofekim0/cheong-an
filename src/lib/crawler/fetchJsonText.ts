/**
 * 청년안심주택 목록 JSON API(`bbsListJson.json`) 응답 본문을 가져오는 저수준 HTTP POST 래퍼.
 *
 * 하이브리드 데이터 소스 전략(ADR 002)에서 목록 주 데이터 소스를 담당한다.
 * `bbsListJson.json`을 호출해 신규 boardId 발견 + 본문/분류 코드를 한 번에 수신한다.
 * (누락 보강용 상세 페이지 GET 경로는 fetchHtml.ts)
 *
 * 책임 범위:
 * - x-www-form-urlencoded body로 POST 요청을 보낸다 (청년안심주택 JSON API 관습).
 * - 응답 Content-Type이 JSON인지 최소 검증한다.
 * - HTTP 에러 / 타임아웃을 명시적 에러로 변환한다.
 * - 응답을 문자열로 반환한다 (JSON.parse는 호출자가).
 *
 * 책임이 아닌 것:
 * - 재시도 (retry.ts), 요청 간격 (rateLimit.ts), JSON 파싱 (parseListJson).
 */

import { HttpError, InvalidContentTypeError, TimeoutError } from './fetchHtml';

const DEFAULT_USER_AGENT = `cheong-an-bot/0.1 (+http://github.com/ofekim0/cheong-an)`;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface FetchJsonOptions {
  /** form-urlencoded body로 전송할 key-value (또는 미리 직렬화된 문자열). */
  body?: Record<string, string> | string;
  /** 추가 헤더 (Referer 등). */
  headers?: Record<string, string>;
  userAgent?: string;
  timeoutMs?: number;
  /** 외부 주입용 fetch - MSW/테스트에서 교체 가능. */
  fetchImpl?: typeof fetch;
}

export async function fetchJsonText(
  url: string,
  options: FetchJsonOptions = {},
): Promise<string> {
  const {
    body,
    headers,
    userAgent = DEFAULT_USER_AGENT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
  } = options;

  const formBody =
    typeof body === 'string'
      ? body
      : new URLSearchParams(body ?? {}).toString();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'User-Agent': userAgent,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        ...headers,
      },
      body: formBody,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new HttpError(response.status, url);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.includes('json')) {
      throw new InvalidContentTypeError(contentType, url);
    }

    return await response.text();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new TimeoutError(url);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
