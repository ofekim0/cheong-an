/**
 * crawlNewAnnouncements 통합 테스트 (MSW 기반)
 *
 * 책임 범위:
 * - 합성 레이어가 fetch+retry+rateLimit+parser를 의도대로 엮어내는지 확인.
 * - 정상 흐름, 빈 메인, 404 분리, retry 흡수, retry 한도 초과, limiter 공유.
 *
 * 책임이 아닌 것:
 * - parseMainPage / parseDetailPage 정확성 (개별 단위 테스트가 담당).
 * - fetchHtml / retry / rateLimit 단위 동작 (각 모듈 단위 테스트가 담당).
 *
 * 왜 MSW인가:
 * - service의 기본 fetcher는 fetchHtml(=실재 fetch). MSW는 그 아래의 네트워크
 *   경계만 가로채서, fetchHtml의 헤더 검증/에러 매핑까지 통째로 함께 검증한다.
 * - fetcher를 mock으로 바꿔치우면 서비스가 fetchHtml의 HttpError 분류를 의지
 *   하고 있다는 사실 자체를 우회하게 되어, 합성의 진짜 동작을 못 보게 된다.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer, SetupServer } from 'msw/node';

import { crawlNewAnnouncements } from './announcementService';
import { createRateLimiter } from './rateLimit';

// --- 테스트용 URL ---
const MAIN_URL = 'https://test.example.com/main';
const DETAIL_BASE = 'https://test.example.com/detail';
const buildDetailUrl = (boardId: number) => `${DETAIL_BASE}?boardId=${boardId}`;

// --- 테스트 가속 옵션 ---
// intervalMs=0: limiter 대기 0
// retry sleep/random 0: 백오프 대기 0, 결정론적
const FAST = {
  mainPageUrl: MAIN_URL,
  buildDetailUrl,
  intervalMs: 0,
  retryOptions: {
    sleep: () => Promise.resolve(),
    random: () => 0,
  },
};

// --- HTML 빌더: parser가 인식 가능한 최소 형태만 갖춘다 ---
function buildMainHtml(boardIds: number[]): string {
  const items = boardIds
    .map(
      (id) => `
      <li>
        <a href="?boardId=${id}">[민간임대] 테스트 공고 ${id}</a>
        <span class="txDate">2026-05-01</span>
      </li>`,
    )
    .join('');
  return `<html><body><ul class="mainBoard_list">${items}</ul></body></html>`;
}

function buildDetailHtml(boardId: number): string {
  return `<html><body>
    <p class="subject">[민간임대] 테스트 공고 ${boardId}</p>
    <ul class="view_data">
      <li><span class="title">공고게시일</span>2026-05-01</li>
    </ul>
    <div class="board_cont"></div>
  </body></html>`;
}

function htmlResponse(html: string) {
  return new HttpResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// --- MSW 서버 라이프사이클 ---
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('crawlNewAnnouncements', () => {
  it('메인이 비어있으면 빈 결과와 입력 lastBoardId를 그대로 반환한다.', async () => {
    server.use(http.get(MAIN_URL, () => htmlResponse(buildMainHtml([]))));

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 100 });

    expect(result.newAnnouncements).toEqual([]);
    expect(result.latestBoardId).toBe(100);
    expect(result.skippedBoardIds).toEqual([]);
  });

  it('모든 후보가 200이면 N개 공고를 반환하고 skippedBoardIds는 비어있다.', async () => {
    const mainIds = [100, 99, 98];
    server.use(
      http.get(MAIN_URL, () => htmlResponse(buildMainHtml(mainIds))),
      http.get(DETAIL_BASE, ({ request }) => {
        const boardId = Number(
          new URL(request.url).searchParams.get('boardId'),
        );
        return htmlResponse(buildDetailHtml(boardId));
      }),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 97 });

    expect(result.newAnnouncements.map((a) => a.boardId).sort()).toEqual([
      98, 99, 100,
    ]);
    expect(result.latestBoardId).toBe(100);
    expect(result.skippedBoardIds).toEqual([]);
  });

  it('일부 후보가 404면 skippedBoardIds에 분리하고 나머지는 처리한다.', async () => {
    // 메인은 [100, 99, 97]만 보임 -> 후보 [97, 98, 99, 100], 98은 빈 번호
    const mainIds = [100, 99, 97];
    server.use(
      http.get(MAIN_URL, () => htmlResponse(buildMainHtml(mainIds))),
      http.get(DETAIL_BASE, ({ request }) => {
        const boardId = Number(
          new URL(request.url).searchParams.get('boardId'),
        );
        if (boardId === 98) {
          return new HttpResponse(null, { status: 404 });
        }
        return htmlResponse(buildDetailHtml(boardId));
      }),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 96 });

    expect(result.newAnnouncements.map((a) => a.boardId).sort()).toEqual([
      97, 99, 100,
    ]);
    expect(result.skippedBoardIds).toEqual([98]);
    expect(result.latestBoardId).toBe(100);
  });

  it('메인 fetch가 5xx 1회 후 200이면 retry로 흡수해 정상 결과를 낸다.', async () => {
    let mainCallCount = 0;
    server.use(
      http.get(MAIN_URL, () => {
        mainCallCount += 1;
        if (mainCallCount === 1) {
          return new HttpResponse(null, { status: 503 });
        }
        return htmlResponse(buildMainHtml([100]));
      }),
      http.get(DETAIL_BASE, ({ request }) => {
        const boardId = Number(
          new URL(request.url).searchParams.get('boardId'),
        );
        return htmlResponse(buildDetailHtml(boardId));
      }),
    );

    const result = await crawlNewAnnouncements({ ...FAST, lastBoardId: 99 });

    expect(mainCallCount).toBe(2);
    expect(result.newAnnouncements).toHaveLength(1);
    expect(result.newAnnouncements[0].boardId).toBe(100);
  });

  it('상세 fetch가 재시도 한도 내내 5xx면 호출자에게 에러를 전파한다', async () => {
    let detailCallCount = 0;
    server.use(
      http.get(MAIN_URL, () => htmlResponse(buildMainHtml([100]))),
      http.get(DETAIL_BASE, () => {
        detailCallCount += 1;
        return new HttpResponse(null, { status: 503 });
      }),
    );

    await expect(
      crawlNewAnnouncements({ ...FAST, lastBoardId: 99 }),
    ).rejects.toThrow();
    // retry 기본 maxAttempts=3 -> 정확히 3번 시도 후 throw
    expect(detailCallCount).toBe(3);
  });

  it('두 service 호출이 limiter를 공유하면 호출 간 간격이 직렬화된다', async () => {
    // 가짜 시계로 limiter의 acquire가 실제로 sleep을 부르는지 본다
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
      http.get(MAIN_URL, () => htmlResponse(buildMainHtml([100]))),
      http.get(DETAIL_BASE, ({ request }) => {
        const boardId = Number(
          new URL(request.url).searchParams.get('boardId'),
        );
        return htmlResponse(buildDetailHtml(boardId));
      }),
    );

    // 같은 limiter를 두 호출이 공유 (직렬 호출)
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

    // 각 호출이 fetch 2회 (메인 1 + 상세 1) -> 총 4회 fetch.
    // 첫 fetch는 nextAvailableAt=0이라 대기 0. 이후 3회는 1000ms씩 대기.
    const realSleeps = sleepMsLog.filter((ms) => ms > 0);
    expect(realSleeps).toHaveLength(3);
    expect(realSleeps.every((ms) => ms === 1000)).toBe(true);
  });
});
