import { describe, it, expect, vi } from 'vitest';
import { fetchJsonText } from './fetchJsonText';
import { HttpError, InvalidContentTypeError, TimeoutError } from './fetchHtml';

function jsonResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    ...init,
  });
}

describe('fetchJsonText', () => {
  it('POST + x-www-form-urlencoded body로 호출한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse('{}'));
    await fetchJsonText('https://x.test/json', {
      body: { a: '1', b: 'hi' },
      fetchImpl,
    });

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toContain(
      'application/x-www-form-urlencoded',
    );
    expect(init.body).toBe('a=1&b=hi');
  });

  it('Accept: application/json 헤더를 명시한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse('{}'));
    await fetchJsonText('https://x.test/json', { fetchImpl });

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.Accept).toBe('application/json');
  });

  it('호출자가 넘긴 추가 헤더(Referer 등)를 머지한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse('{}'));
    await fetchJsonText('https://x.test/json', {
      headers: { Referer: 'https://x.test/list' },
      fetchImpl,
    });

    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.Referer).toBe('https://x.test/list');
  });

  it('응답 본문을 문자열로 반환한다 (JSON.parse는 하지 않는다)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse('{"resultList":[]}'));
    const text = await fetchJsonText('https://x.test/json', { fetchImpl });
    expect(text).toBe('{"resultList":[]}');
  });

  it('non-2xx 응답은 HttpError로 던진다', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 500 }));
    await expect(
      fetchJsonText('https://x.test/json', { fetchImpl }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('Content-Type이 json이 아니면 InvalidContentTypeError로 던진다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('<html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    await expect(
      fetchJsonText('https://x.test/json', { fetchImpl }),
    ).rejects.toBeInstanceOf(InvalidContentTypeError);
  });

  it('타임아웃 시 TimeoutError로 던진다', async () => {
    const fetchImpl = vi.fn().mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    await expect(
      fetchJsonText('https://x.test/json', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        timeoutMs: 1,
      }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});
