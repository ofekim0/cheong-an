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

/** 유효한 목록 row 1건. overrides로 필드를 어긋내 격리 시나리오를 만든다. */
function buildRow(
  boardId: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
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
    ...overrides,
  };
}

function buildListJsonFromRows(
  rows: Record<string, unknown>[],
  totPage?: number,
): string {
  return JSON.stringify({
    pagingInfo: { totRow: rows.length, ...(totPage ? { totPage } : {}) },
    resultList: rows,
  });
}

function buildListJsonText(boardIds: number[], totPage?: number): string {
  return buildListJsonFromRows(
    boardIds.map((boardId) => buildRow(boardId)),
    totPage,
  );
}

/**
 * 공고게시일(view_data)이 없는 상세 페이지 — parseDetailPage가 postDate=''를 내고
 * checkDetailInvariants의 DETAIL_INVALID_POST_DATE를 위반한다. 633B 에러 페이지는
 * 아니므로 isViewErrorPage는 통과한다(불변식 게이트 경로 검증용).
 */
const invalidDetailHtml =
  '<html><body><p class="subject">[민간임대] 불변식 위반 공고</p>' +
  '<div class="board_cont">본문은 있으나 공고게시일 메타가 없음</div></body></html>';

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
    expect(result.isolatedListRows).toEqual([]);
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

    // 목록에 있는 신규 3건 모두 view.do로 호출 (오름차순).
    expect(observedBoardIds).toEqual([101, 102, 103]);
    expect(result.newDetails.map((d) => d.boardId)).toEqual([101, 102, 103]);
    expect(result.latestBoardId).toBe(103);
    expect(result.skippedBoardIds).toEqual([]);
  });

  // ADR 007: boardId 전역 시퀀스라 숫자 gap을 채우면 타 게시판 공고가 섞인다.
  //   목록에 실제 존재하는 boardId만 크롤하고 gap(101, 102)은 건드리지 않는다.
  it('목록에 없는 boardId(타 게시판/gap)는 크롤하지 않는다', async () => {
    // JSON: [103, 100], lastBoardId=99 → 신규 후보 = [100, 103] (101, 102 제외).
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

    expect(observedBoardIds).toEqual([100, 103]);
    expect(result.newDetails.map((d) => d.boardId)).toEqual([100, 103]);
    expect(result.latestBoardId).toBe(103);
    expect(result.skippedBoardIds).toEqual([]);
    expect(result.invalidBoardIds).toEqual([]);
  });

  it('신규 일부가 633B면 정상만 newDetails, 나머지는 skippedBoardIds (모두 오름차순)', async () => {
    // 신규 후보 = [100, 103]. 100은 633B.
    server.use(
      http.post(LIST_URL, () => jsonResponse(buildListJsonText([103, 100]))),
      viewHandler([100]),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 99 });

    expect(result.newDetails.map((d) => d.boardId)).toEqual([103]);
    expect(result.skippedBoardIds).toEqual([100]);
    expect(result.latestBoardId).toBe(103);
  });

  it('신규 전체가 633B면 newDetails는 비고 skippedBoardIds에 전부', async () => {
    server.use(
      http.post(LIST_URL, () => jsonResponse(buildListJsonText([103, 100]))),
      viewHandler([100, 103]),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 99 });

    expect(result.newDetails).toEqual([]);
    expect(result.skippedBoardIds).toEqual([100, 103]);
    expect(result.latestBoardId).toBe(103);
  });

  // ADR 006/007: 불변식 위반 detail은 저장에서 격리한다 — 단일 불량 row가 배치를
  //   실패시켜 파이프라인을 동결시키는 것을 막는다. latestBoardId는 그대로 전진.
  it('불변식 위반 detail은 invalidBoardIds로 격리하고 latestBoardId는 전진', async () => {
    // 신규 후보 = [100, 101]. 101은 공고게시일이 없어 postDate 불변식 위반.
    server.use(
      http.post(LIST_URL, () => jsonResponse(buildListJsonText([101, 100]))),
      http.get(VIEW_BASE, ({ request }) => {
        const boardId = Number(
          new URL(request.url).searchParams.get('boardId'),
        );
        return htmlResponse(
          boardId === 101 ? invalidDetailHtml : detailHtmlFixture,
        );
      }),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 99 });

    expect(result.newDetails.map((d) => d.boardId)).toEqual([100]);
    expect(result.invalidBoardIds).toEqual([101]);
    expect(result.skippedBoardIds).toEqual([]);
    expect(result.latestBoardId).toBe(101);
  });

  // ADR 012: 목록 파서가 row 단위로 격리한 항목은 크롤 후보에서 빠지되 결과로
  //   표면화된다. 한 항목의 오입력이 회차 전체를 죽이지 않는다(#68 재발 차단).
  it('불량 row는 격리하고 유효 row만 크롤한다 — #68 시나리오', async () => {
    // 신규 후보 = [101, 102, 103] 중 102는 미지의 optn5 코드로 격리.
    const observedBoardIds: number[] = [];
    server.use(
      http.post(LIST_URL, () =>
        jsonResponse(
          buildListJsonFromRows([
            buildRow(103),
            buildRow(102, { optn5: '9' }),
            buildRow(101),
          ]),
        ),
      ),
      http.get(VIEW_BASE, ({ request }) => {
        observedBoardIds.push(
          Number(new URL(request.url).searchParams.get('boardId')),
        );
        return htmlResponse(detailHtmlFixture);
      }),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 100 });

    expect(observedBoardIds).toEqual([101, 103]);
    expect(result.newDetails.map((d) => d.boardId)).toEqual([101, 103]);
    expect(result.isolatedListRows).toEqual([
      { boardId: 102, reason: expect.stringContaining('optn5') },
    ]);
    expect(result.latestBoardId).toBe(103);
    expect(result.invalidBoardIds).toEqual([]);
  });

  // ADR 012: 최신 항목이 격리되면 그 boardId도 latest에 포함해 전진시킨다 —
  //   포함하지 않으면 매 회차 같은 row를 재관측해 영구 노이즈가 된다.
  it('최신 항목이 격리되면 latestBoardId는 그 boardId까지 전진한다', async () => {
    server.use(
      http.post(LIST_URL, () =>
        jsonResponse(
          buildListJsonFromRows([buildRow(103, { optn2: '9' }), buildRow(101)]),
        ),
      ),
      viewHandler(),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 100 });

    expect(result.newDetails.map((d) => d.boardId)).toEqual([101]);
    expect(result.isolatedListRows).toHaveLength(1);
    expect(result.latestBoardId).toBe(103);
  });

  // ADR 012 경계: 전 항목 격리는 전면 붕괴 신호다 — latestBoardId를 전진시키지
  //   않아 재관측되게 두고, 카나리의 LIST_EMPTY가 500으로 잡는다.
  it('전 항목이 격리되면 latestBoardId를 전진시키지 않는다', async () => {
    server.use(
      http.post(LIST_URL, () =>
        jsonResponse(
          buildListJsonFromRows([
            buildRow(103, { optn2: '9' }),
            buildRow(101, { optn2: '9' }),
          ]),
        ),
      ),
      viewHandler(),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 100 });

    expect(result.newDetails).toEqual([]);
    expect(result.latestBoardId).toBe(100);
    expect(result.isolatedListRows).toHaveLength(2);
  });

  it('2페이지 조회 시 각 페이지의 격리 row를 모두 누적한다', async () => {
    // page1: [105,104(격리),103] → 경계 못 넘음 → page2
    // page2: [102,101(격리),100] → 100이 경계 → 중단
    server.use(
      http.post(LIST_URL, async ({ request }) => {
        const params = new URLSearchParams(await request.text());
        const pageIndex = params.get('pageIndex') ?? '1';
        if (pageIndex === '1') {
          return jsonResponse(
            buildListJsonFromRows(
              [buildRow(105), buildRow(104, { nttSj: '  ' }), buildRow(103)],
              2,
            ),
          );
        }
        return jsonResponse(
          buildListJsonFromRows(
            [buildRow(102), buildRow(101, { regDate: 'bad' }), buildRow(100)],
            2,
          ),
        );
      }),
      viewHandler(),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 100 });

    expect(result.newDetails.map((d) => d.boardId)).toEqual([102, 103, 105]);
    expect(result.isolatedListRows.map((r) => r.boardId)).toEqual([104, 101]);
    expect(result.latestBoardId).toBe(105);
  });

  // ADR 007: 신규가 1페이지(목록 상한)를 넘치면 다음 페이지를 조회해 보전한다.
  it('신규가 1페이지를 넘으면 totPage 기준 다음 페이지를 조회한다', async () => {
    // page1: [105,104,103] (totPage=2, 모두 >100 → 경계 못 넘음 → page2 조회)
    // page2: [102,101,100] (100이 lastBoardId 이하 → 경계 → 중단)
    // 신규 후보 = [101,102,103,104,105].
    const listPageIndexes: string[] = [];
    server.use(
      http.post(LIST_URL, async ({ request }) => {
        const params = new URLSearchParams(await request.text());
        const pageIndex = params.get('pageIndex') ?? '1';
        listPageIndexes.push(pageIndex);
        if (pageIndex === '1') {
          return jsonResponse(buildListJsonText([105, 104, 103], 2));
        }
        return jsonResponse(buildListJsonText([102, 101, 100], 2));
      }),
      viewHandler(),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 100 });

    expect(listPageIndexes).toEqual(['1', '2']);
    expect(result.newDetails.map((d) => d.boardId)).toEqual([
      101, 102, 103, 104, 105,
    ]);
    expect(result.latestBoardId).toBe(105);
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
