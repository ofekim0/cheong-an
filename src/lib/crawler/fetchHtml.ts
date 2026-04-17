/**
 * 청년안심주택 홈페이지에서 HTML을 가져오는 저수준 HTTP GET 래퍼.
 *
 * 책임 범위:
 * - URL로 GET 요청을 보낸다.
 * - User-Agent 헤더를 명시한다 (크롤러 매너).
 * - 타임아웃을 강제한다 (느린 응답에 대한 무한 대기 방지).
 * - HTTP 에러 (4xx/5xx)를 명시적 에러로 변환한다.
 * - 응답 Content-Type이 HTML인지 최소 검증한다.
 *
 * 책임이 아닌 것:
 * - 재시도 (retry.ts)
 * - 요청 간격 제어 (rateLimit.ts)
 * - HTML 파싱 (parseMainPage / parseDetailPage)
 */

const DEFAULT_USER_AGENT = `cheong-an-bot/0.1 (+http://github.com/ofekim0/cheong-an)`;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface FetchHtmlOptions {
  /** User-Agent 헤더 (기본: cheong-an-bot) */
  userAgent?: string;
  /**타임아웃 (ms, 기본 10초) */
  timeoutMs?: number;
  /** 외부 주입용 fetch - 테스트에서 MSW 대신 직접 mock 가능 */
  fetchImpl?: typeof fetch;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
  ) {
    super(`HTTP ${status} while fetching ${url}`);
    this.name = 'HttpError';
  }
}

export class TimeoutError extends Error {
  constructor(public readonly url: string) {
    super(`Timeout while fetching ${url}`);
    this.name = 'TimeoutError';
  }
}

export class InvalidContentTypeError extends Error {
  constructor(
    public readonly contentType: string | null,
    public readonly url: string,
  ) {
    super(`Expected HTML but got ${contentType ?? 'unknown'} fron ${url}`);
    this.name = 'InvalidContentTypeError';
  }
}

/**
 * 주어진 URL로 GET 요청을 보내 응답 본문(HTML 문자열)을 반환한다.
 * 실패 시 구체적인 에러 타입을 던진다 - 상위 레이어가 재시도 여부를 판단할 수 있도록.
 */
export async function fetchHtml(
  url: string,
  options: FetchHtmlOptions = {},
): Promise<string> {
  const {
    userAgent = DEFAULT_USER_AGENT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
  } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new HttpError(response.status, url);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.includes('html')) {
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
