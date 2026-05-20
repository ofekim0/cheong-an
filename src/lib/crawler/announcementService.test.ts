/**
 * crawlNewAnnouncements 통합 테스트 (MSW 기반)
 *
 * 책임 범위:
 * - 합성 레이어가 fetchJsonText + fetchHtml + retry + rateLimit
 *   + parseListJson + parseDetailPage + isViewErrorPage를 의도대로 엮어내는지 확인.
 * - JSON 정상 흐름, retry 흡수/한도, limiter 공유.
 * - view.do 보강 fetch: gap 계산, 정상/633B 분기, 호출 회피.
 *
 * 책임이 아닌 것:
 * - 각 파서·페처·정책 단위 정확성 (개별 단위 테스트가 담당).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { crawlNewAnnouncements } from './announcementService';
import { createRateLimiter } from './rateLimit';

const LIST_URL = 'https://test.example.com/bbsListJson.json';
const VIEW_BASE = 'https://test.example.com/view.do';
const buildViewUrl = (boardId: number) => `${VIEW_BASE}?boardId=${boardId}`;

// 실 사이트 fixture를 view.do 정상/에러 응답에 그대로 사용.
const detailHtmlFixture = readFileSync(
  join(__dirname, '__fixtures__', 'detailPage.html'),
  'utf-8',
);
const viewErrorFixture = readFileSync(
  join(__dirname, '__fixtures__', 'viewErrorPage.html'),
  'utf-8',
);

const FAST = {
  listUrl: LIST_URL,
  buildViewUrl,
  intervalMs: 0,
  retryOptions: {
    sleep: () => Promise.resolve(),
    random: () => 0,
  },
};

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

function htmlResponse(body: string) {
  return new HttpResponse(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/** view.do MSW 핸들러: errorIds에 든 boardId만 633B 에러 페이지로 응답. */
function viewHandler(errorIds: number[] = []) {
  const errorSet = new Set(errorIds);
  return http.get(VIEW_BASE, ({ request }) => {
    const boardId = Number(new URL(request.url).searchParams.get('boardId'));
    return htmlResponse(
      errorSet.has(boardId) ? viewErrorFixture : detailHtmlFixture,
    );
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
    expect(result.skippedBoardIds).toEqual([]);
  });

  it('모든 boardId가 lastBoardId 초과 + gap 없음이면 JSON만 반환, view.do 호출 0회', async () => {
    let viewCalls = 0;
    server.use(
      http.post(LIST_URL, () =>
        jsonResponse(buildListJsonText([103, 102, 101])),
      ),
      http.get(VIEW_BASE, () => {
        viewCalls += 1;
        return htmlResponse(detailHtmlFixture);
      }),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 100 });

    expect(result.newAnnouncements.map((a) => a.boardId)).toEqual([
      103, 102, 101,
    ]);
    expect(result.latestBoardId).toBe(103);
    expect(result.skippedBoardIds).toEqual([]);
    expect(viewCalls).toBe(0);
  });

  it('일부만 lastBoardId 초과면 초과분만 반환 (gap의 비존재 boardId는 skip)', async () => {
    // JSON max=103, lastBoardId=100, JSON에 없는 101은 633B로 응답 → skip.
    server.use(
      http.post(LIST_URL, () =>
        jsonResponse(buildListJsonText([103, 102, 99, 98])),
      ),
      viewHandler([101]),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 100 });

    expect(result.newAnnouncements.map((a) => a.boardId)).toEqual([103, 102]);
    expect(result.latestBoardId).toBe(103);
    expect(result.skippedBoardIds).toEqual([101]);
  });

  it('5xx 1회 후 200이면 retry로 흡수', async () => {
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

  it('retry 한도 내내 5xx면 호출자에게 에러 전파', async () => {
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
    expect(calls).toBe(3);
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

    const realSleeps = sleepMsLog.filter((ms) => ms > 0);
    expect(realSleeps).toEqual([1000]);
  });

  it('gap이 있고 모두 정상 view.do면 JSON + view.do 보강을 합쳐 반환', async () => {
    // JSON에는 [103, 100]만 들어와 lastBoardId=99 기준 gap = [101, 102].
    server.use(
      http.post(LIST_URL, () => jsonResponse(buildListJsonText([103, 100]))),
      viewHandler(),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 99 });

    // 앞 2개는 JSON 항목, 뒤 2개는 view.do 보강.
    expect(result.newAnnouncements.map((a) => a.boardId)).toEqual([
      103, 100, 101, 102,
    ]);
    expect(result.latestBoardId).toBe(103);
    expect(result.skippedBoardIds).toEqual([]);
  });

  it('gap 중 일부가 633B 에러 페이지면 skippedBoardIds로 분리', async () => {
    // gap = [101, 102]. 101은 빈 번호(633B), 102는 정상.
    server.use(
      http.post(LIST_URL, () => jsonResponse(buildListJsonText([103, 100]))),
      viewHandler([101]),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 99 });

    expect(result.newAnnouncements.map((a) => a.boardId)).toEqual([
      103, 100, 102,
    ]);
    expect(result.skippedBoardIds).toEqual([101]);
  });

  it('gap 전체가 633B면 newFromView는 비고 skippedBoardIds에 전부', async () => {
    server.use(
      http.post(LIST_URL, () => jsonResponse(buildListJsonText([103, 100]))),
      viewHandler([101, 102]),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 99 });

    expect(result.newAnnouncements.map((a) => a.boardId)).toEqual([103, 100]);
    expect(result.skippedBoardIds).toEqual([101, 102]);
  });

  it('view.do 보강 항목은 agency=null이고 attachmentId는 fileDown URL에서 추출', async () => {
    server.use(
      http.post(LIST_URL, () => jsonResponse(buildListJsonText([103]))),
      viewHandler(),
    );

    // lastBoardId=100 → gap = [101, 102] → 둘 다 view.do로 채워짐.
    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 100 });

    const fromView = result.newAnnouncements.filter((a) => a.boardId !== 103);
    expect(fromView.length).toBeGreaterThan(0);
    for (const item of fromView) {
      expect(item.agency).toBeNull();
      // detailPage fixture에 fileDown.do 첨부가 있으므로 atchFileId 추출 가능.
      expect(item.attachmentId).toBeTruthy();
    }
  });
});
