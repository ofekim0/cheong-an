/**
 * crawlNewAnnouncements 통합 테스트 (MSW 기반, ADR 003 옵션 B 반영)
 *
 * 책임 범위:
 * - 합성 레이어가 fetchJsonText + fetchHtml + retry + rateLimit
 *   + parseListJson + parseDetailPage + isViewErrorPage를 의도대로 엮어내는지 확인.
 * - 모든 신규 boardId가 view.do로 호출되는지(옵션 B의 핵심), 정상/633B 분기, 오름차순 정렬.
 * - JSON 정상 흐름, retry 흡수/한도, limiter 공유.
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

    expect(result.newDetails).toEqual([]);
    expect(result.latestBoardId).toBe(100);
    expect(result.skippedBoardIds).toEqual([]);
  });

  // ADR 005: 시드값 0은 "초기 가동" 신호 → view.do 루프 생략, latestBoardId만 반환.
  it('lastBoardId=0(부트스트랩)이면 view.do 호출 없이 latestBoardId만 반환', async () => {
    const observedBoardIds: number[] = [];
    server.use(
      http.post(LIST_URL, () =>
        jsonResponse(buildListJsonText([6561, 6560, 6559])),
      ),
      http.get(VIEW_BASE, ({ request }) => {
        observedBoardIds.push(
          Number(new URL(request.url).searchParams.get('boardId')),
        );
        return htmlResponse(detailHtmlFixture);
      }),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 0 });

    expect(observedBoardIds).toEqual([]);
    expect(result.newDetails).toEqual([]);
    expect(result.latestBoardId).toBe(6561);
    expect(result.skippedBoardIds).toEqual([]);
  });

  it('모든 신규가 정상 view.do면 boardId 오름차순으로 detail 배열 반환', async () => {
    const observedBoardIds: number[] = [];
    server.use(
      http.post(LIST_URL, () =>
        jsonResponse(buildListJsonText([103, 102, 101])),
      ),
      http.get(VIEW_BASE, ({ request }) => {
        const boardId = Number(
          new URL(request.url).searchParams.get('boardId'),
        );
        observedBoardIds.push(boardId);
        return htmlResponse(detailHtmlFixture);
      }),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 100 });

    // 옵션 B: JSON 신규 3건 모두 view.do로 호출 (오름차순).
    expect(observedBoardIds).toEqual([101, 102, 103]);
    expect(result.newDetails.map((d) => d.boardId)).toEqual([101, 102, 103]);
    expect(result.latestBoardId).toBe(103);
    expect(result.skippedBoardIds).toEqual([]);
  });

  it('JSON에 없는 gap도 신규 boardId 범위에 포함되어 view.do 호출', async () => {
    // JSON: [103, 100], lastBoardId=99 → 신규 = [100, 101, 102, 103].
    //   100, 103: JSON에 있어도 view.do로 다시 확인 (옵션 B).
    //   101, 102: JSON에 없는 gap. view.do 호출.
    const observedBoardIds: number[] = [];
    server.use(
      http.post(LIST_URL, () => jsonResponse(buildListJsonText([103, 100]))),
      http.get(VIEW_BASE, ({ request }) => {
        const boardId = Number(
          new URL(request.url).searchParams.get('boardId'),
        );
        observedBoardIds.push(boardId);
        return htmlResponse(detailHtmlFixture);
      }),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 99 });

    expect(observedBoardIds).toEqual([100, 101, 102, 103]);
    expect(result.newDetails.map((d) => d.boardId)).toEqual([
      100, 101, 102, 103,
    ]);
    expect(result.latestBoardId).toBe(103);
    expect(result.skippedBoardIds).toEqual([]);
  });

  it('신규 일부가 633B면 정상만 newDetails, 나머지는 skippedBoardIds (모두 오름차순)', async () => {
    // 신규 = [100, 101, 102, 103]. 101은 633B.
    server.use(
      http.post(LIST_URL, () => jsonResponse(buildListJsonText([103, 100]))),
      viewHandler([101]),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 99 });

    expect(result.newDetails.map((d) => d.boardId)).toEqual([100, 102, 103]);
    expect(result.skippedBoardIds).toEqual([101]);
    expect(result.latestBoardId).toBe(103);
  });

  it('신규 전체가 633B면 newDetails는 비고 skippedBoardIds에 전부', async () => {
    server.use(
      http.post(LIST_URL, () => jsonResponse(buildListJsonText([103, 100]))),
      viewHandler([100, 101, 102, 103]),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 99 });

    expect(result.newDetails).toEqual([]);
    expect(result.skippedBoardIds).toEqual([100, 101, 102, 103]);
    expect(result.latestBoardId).toBe(103);
  });

  it('view.do detail은 complexName/district 등 풍부 필드를 보존', async () => {
    server.use(
      http.post(LIST_URL, () => jsonResponse(buildListJsonText([101]))),
      viewHandler(),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 100 });

    expect(result.newDetails).toHaveLength(1);
    const detail = result.newDetails[0];
    expect(detail.title).toBeTruthy();
    expect(detail.rawContent).toBeTruthy();
    // detail-only 필드 중 최소 하나는 채워져 있어야 한다
    // (모두 null이면 fixture가 잘못됐거나 파서가 깨진 것).
    const detailOnly = [
      detail.complexName,
      detail.district,
      detail.address,
      detail.totalUnits,
      detail.resultDate,
      detail.attachmentUrl,
    ];
    expect(detailOnly.some((v) => v !== null)).toBe(true);
  });

  it('JSON 5xx 1회 후 200이면 retry로 흡수', async () => {
    let listCalls = 0;
    server.use(
      http.post(LIST_URL, () => {
        listCalls += 1;
        if (listCalls === 1) return new HttpResponse(null, { status: 503 });
        return jsonResponse(buildListJsonText([100]));
      }),
      viewHandler(),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 99 });

    expect(listCalls).toBe(2);
    expect(result.newDetails).toHaveLength(1);
    expect(result.newDetails[0].boardId).toBe(100);
  });

  it('JSON 5xx가 retry 한도 내내 지속되면 호출자에게 에러 전파', async () => {
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

  it('두 service 호출이 limiter를 공유하면 호출 간격이 직렬화된다', async () => {
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
      viewHandler(),
    );

    // 각 service 호출: JSON 1회 + view.do 1회 = 2회 acquire.
    // 두 service 호출 → 총 4회 acquire 중 첫 1회만 즉시, 나머지 3회는 각각 1000ms sleep.
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
    expect(realSleeps).toEqual([1000, 1000, 1000]);
  });
});
