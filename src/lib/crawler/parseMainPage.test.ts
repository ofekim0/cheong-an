import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseMainPage } from './parseMainPage';

const fixtureHtml = readFileSync(
  join(__dirname, '__fixtures__', 'mainPage.html'),
  'utf-8',
);

describe('parseMainPage', () => {
  it('최신 공고 5건을 추출한다', () => {
    const results = parseMainPage(fixtureHtml);

    expect(results).toHaveLength(5);
  });

  it('각 공고의 boardId를 정확히 추출한다', () => {
    const results = parseMainPage(fixtureHtml);

    expect(results.map((r) => r.boardId)).toEqual([
      6485, 6479, 6478, 6477, 6474,
    ]);
  });

  it('공고 제목을 추출한다', () => {
    const results = parseMainPage(fixtureHtml);

    expect(results[0].title).toBe(
      '[공공임대] 2026년 1차 청년안심주택 모집공고',
    );
    expect(results[1].title).toBe(
      '[민간임대] 태릉입구역 이니티움 추가모집공고',
    );
  });

  it('게시 날짜를 추출한다', () => {
    const results = parseMainPage(fixtureHtml);

    expect(results[0].postDate).toBe('2026-03-31');
    expect(results[4].postDate).toBe('2026-03-19');
  });

  it('"전체보기" 링크는 결과에 포함하지 않는다', () => {
    const results = parseMainPage(fixtureHtml);

    const titles = results.map((r) => r.title);
    expect(titles).not.toContain('전체보기');
  });

  it('빈 HTML에서는 빈 배열을 반환한다', () => {
    const results = parseMainPage('<html><body></body></html>');

    expect(results).toEqual([]);
  });

  it('boardId가 없는 링크는 건너뛴다', () => {
    const html = `
      <ul class="mainBoard_list">
        <li><a href="/some/page">링크</a><span class="txDate">2026-01-01</span></li>
      </ul>
    `;

    const results = parseMainPage(html);
    expect(results).toEqual([]);
  });
});
