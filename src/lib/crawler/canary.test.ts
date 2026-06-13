/**
 * runCanary 단위 테스트 (ADR 006 A안).
 *
 * fetcher/viewFetcher를 주입해 라이브 호출 없이 검증한다. 실 픽스처를 정상 응답으로
 * 쓰고, 변형 응답을 주입해 카나리가 각 위반을 잡는지 확인한다.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { runCanary } from './canary';

const listJsonFixture = readFileSync(
  join(__dirname, '__fixtures__', 'listJson.json'),
  'utf-8',
);
const detailHtmlFixture = readFileSync(
  join(__dirname, '__fixtures__', 'detailPage.html'),
  'utf-8',
);
const viewErrorFixture = readFileSync(
  join(__dirname, '__fixtures__', 'viewErrorPage.html'),
  'utf-8',
);

const FIXTURE_BOARD_ID = 6539;

/** 인자를 무시하고 고정 문자열을 반환하는 fetcher. */
const respondWith = (text: string) => () => Promise.resolve(text);

// rateLimit/retry 지연을 제거해 테스트를 빠르게.
const FAST = {
  intervalMs: 0,
  retryOptions: {
    sleep: () => Promise.resolve(),
    random: () => 0,
  },
};

const codesOf = (violations: { code: string }[]) =>
  violations.map((v) => v.code);

describe('runCanary', () => {
  it('정상 라이브 응답(실 픽스처) → 위반 0건', async () => {
    const violations = await runCanary({
      ...FAST,
      canaryBoardId: FIXTURE_BOARD_ID,
      fetcher: respondWith(listJsonFixture),
      viewFetcher: respondWith(detailHtmlFixture),
    });
    expect(violations).toEqual([]);
  });

  it('S1: 빈 resultList 라이브 응답 → LIST_EMPTY', async () => {
    const violations = await runCanary({
      ...FAST,
      canaryBoardId: FIXTURE_BOARD_ID,
      fetcher: respondWith(JSON.stringify({ resultList: [] })),
      viewFetcher: respondWith(detailHtmlFixture),
    });
    expect(codesOf(violations)).toContain('LIST_EMPTY');
  });

  it('S2: 셀렉터 빗나간 디테일 응답 → DETAIL_EMPTY_TITLE_AND_CONTENT', async () => {
    const violations = await runCanary({
      ...FAST,
      canaryBoardId: FIXTURE_BOARD_ID,
      fetcher: respondWith(listJsonFixture),
      viewFetcher: respondWith(
        '<html><body><h1>새 디자인 제목</h1><div class="content">본문 내용</div></body></html>',
      ),
    });
    expect(codesOf(violations)).toContain('DETAIL_EMPTY_TITLE_AND_CONTENT');
  });

  it('카나리 boardId가 에러 페이지로 응답 → CANARY_DETAIL_MISSING', async () => {
    const violations = await runCanary({
      ...FAST,
      canaryBoardId: 999999,
      fetcher: respondWith(listJsonFixture),
      viewFetcher: respondWith(viewErrorFixture),
    });
    expect(codesOf(violations)).toEqual(['CANARY_DETAIL_MISSING']);
  });

  it('canaryBoardId 미설정 → 디테일 fetch를 호출하지 않고 리스트만 검증', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const viewFetcher = vi.fn(() => Promise.resolve(detailHtmlFixture));

    const violations = await runCanary({
      ...FAST,
      fetcher: respondWith(listJsonFixture),
      viewFetcher,
    });

    expect(viewFetcher).not.toHaveBeenCalled();
    expect(violations).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
