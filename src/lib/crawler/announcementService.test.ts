/**
 * crawlNewAnnouncements 통합 테스트 (MSW 기반)
 *
 * 책임 범위:
 * - 합성 레이어가 fetchJsonText + retry + rateLimit + parseListJson을
 *   의도대로 엮어내는지 확인.
 * - 정상 흐름, 빈 응답, retry 흡수, retry 한도, limiter 공유.
 *
 * 책임이 아닌 것:
 * - parseListJson 정확성 (개별 단위 테스트가 담당).
 * - fetchJsonText / retry / rateLimit 단위 동작 (각 단위 테스트가 담당).
 *
 * 왜 MSW인가:
 * - service의 기본 fetcher는 fetchJsonText(=실재 fetch). MSW로 네트워크
 *   경계를 가로채면 헤더 검증/에러 매핑까지 통째로 함께 검증한다.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { crawlNewAnnouncements } from './announcementService';
import { createRateLimiter } from './rateLimit';

const LIST_URL = 'https://test.example.com/bbsListJson.json';

const FAST = {
  listUrl: LIST_URL,
  intervalMs: 0,
  retryOptions: {
    sleep: () => Promise.resolve(),
    random: () => 0,
  },
};

/** 가짜 JSON 응답 빌더 - parseListJson이 허용하는 최소 필드만 갖춘다. */
function buildListJsonText(boardIds: number[]): string {
  return JSON.stringify({
    pagingInfo: { totRow: boardIds.length },
    resultList: boardIds.map((boardId) => ({
      boardId,
      nttSj: `[민간임대] 테스트 공고 ${boardId}`,
      content: `<p>본문 ${boardId}</p>`,
      optn1: '2026-05-01',
      optn2: '2',
      optn3: '테스트 사업주체',
      optn4: '2026-05-31',
      optn5: '1',
      atchFileId: `att-${boardId}`,
      regDate: 0,
    })),
  });
}

function jsonResponse(text: string, init: ResponseInit = {}) {
  return new HttpResponse(text, {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  });
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('crawlNewAnnouncements', () => {
  it('resultList가 비어 있으면 빈 결과와 입력 lastBoardId를 그대로 반환', async () => {
    server.use(http.post(LIST_URL, () => jsonResponse(buildListJsonText([]))));

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 100 });

    expect(result.newAnnouncements).toEqual([]);
    expect(result.latestBoardId).toBe(100);
  });

  it('모든 boardId가 lastBoardId 초과면 전부 새 공고로 반환', async () => {
    server.use(
      http.post(LIST_URL, () =>
        jsonResponse(buildListJsonText([103, 102, 101])),
      ),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 100 });

    expect(result.newAnnouncements.map((a) => a.boardId)).toEqual([
      103, 102, 101,
    ]);
    expect(result.latestBoardId).toBe(103);
  });

  it('일부만 lastBoardId 초과면 초과분만 새 공고로 반환', async () => {
    server.use(
      http.post(LIST_URL, () =>
        jsonResponse(buildListJsonText([103, 102, 99, 98])),
      ),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 100 });

    expect(result.newAnnouncements.map((a) => a.boardId)).toEqual([103, 102]);
    expect(result.latestBoardId).toBe(103);
  });

  it('5xx 1회 후 200이면 retry로 흡수해 정상 결과를 낸다', async () => {
    let calls = 0;
    server.use(
      http.post(LIST_URL, () => {
        calls += 1;
        if (calls === 1) return new HttpResponse(null, { status: 503 });
        return jsonResponse(buildListJsonText([100]));
      }),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 99 });

    expect(calls).toBe(2);
    expect(result.newAnnouncements).toHaveLength(1);
    expect(result.newAnnouncements[0].boardId).toBe(100);
  });

  it('retry 한도 내내 5xx면 호출자에게 에러를 전파한다', async () => {
    let calls = 0;
    server.use(
      http.post(LIST_URL, () => {
        calls += 1;
        return new HttpResponse(null, { status: 503 });
      }),
    );

    await expect(
      crawlNewAnnouncements({ ...FAST, lastBoardId: 99 }),
    ).rejects.toThrow();
    expect(calls).toBe(3); // retry 기본 maxAttempts=3
  });

  it('두 service 호출이 limiter를 공유하면 호출 간 간격이 직렬화된다', async () => {
    let fakeNow = 0;
    const sleepMsLog: number[] = [];
    const limiter = createRateLimiter({
      intervalMs: 1000,
      now: () => fakeNow,
      sleep: (ms) => {
        sleepMsLog.push(ms);
        fakeNow += ms;
        return Promise.resolve();
      },
    });

    server.use(
      http.post(LIST_URL, () => jsonResponse(buildListJsonText([100]))),
    );

    await crawlNewAnnouncements({
      ...FAST,
      lastBoardId: 99,
      rateLimiter: limiter,
    });
    await crawlNewAnnouncements({
      ...FAST,
      lastBoardId: 99,
      rateLimiter: limiter,
    });

    // 사이클당 1회 호출. 두 사이클이면 두 번째 호출만 1000ms 대기.
    const realSleeps = sleepMsLog.filter((ms) => ms > 0);
    expect(realSleeps).toEqual([1000]);
  });
});
