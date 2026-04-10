import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseDetailPage } from './parseDetailPage';

const fixtureHtml = readFileSync(
  join(__dirname, '__fixtures__', 'detailPage.html'),
  'utf-8',
);

describe('parseDetailPage', () => {
  it('공고 제목을 추출한다', () => {
    const result = parseDetailPage(fixtureHtml, 6479);

    expect(result.title).toBe('[민간임대] 태릉입구역 이니티움 추가모집공고');
  });

  it('boardId를 그대로 반환한다', () => {
    const result = parseDetailPage(fixtureHtml, 6479);

    expect(result.boardId).toBe(6479);
  });

  it('공고 유형을 판별한다 - 민간임대', () => {
    const result = parseDetailPage(fixtureHtml, 6479);

    expect(result.announcementType).toBe('private');
  });

  it('모집 구분을 판별한다 - 추가모집', () => {
    const result = parseDetailPage(fixtureHtml, 6479);

    expect(result.recruitmentType).toBe('additional');
  });

  it('공고게시일을 추출한다', () => {
    const result = parseDetailPage(fixtureHtml, 6479);

    expect(result.postDate).toBe('2026-03-26');
  });

  it('청약신청일을 추출한다', () => {
    const result = parseDetailPage(fixtureHtml, 6479);

    expect(result.applicationStartDate).toBe('2026-03-30');
  });

  it('지역구를 추출한다', () => {
    const result = parseDetailPage(fixtureHtml, 6479);

    expect(result.district).toBe('노원구');
  });

  it('단지명을 추출한다', () => {
    const result = parseDetailPage(fixtureHtml, 6479);

    expect(result.complexName).toBe('태릉입구역 이니티움');
  });

  it('주소를 추출한다', () => {
    const result = parseDetailPage(fixtureHtml, 6479);

    expect(result.address).toContain('노원구 공릉동');
  });

  it('공급호수를 추출한다', () => {
    const result = parseDetailPage(fixtureHtml, 6479);

    expect(result.totalUnits).toBe(100);
  });

  it('첨부파일 URL을 추출한다', () => {
    const result = parseDetailPage(fixtureHtml, 6479);

    expect(result.attachmentUrl).toContain('fileDown.do');
    expect(result.attachmentUrl).toContain('soco.seoul.go.kr');
  });

  it('첨부파일명을 추출한다', () => {
    const result = parseDetailPage(fixtureHtml, 6479);

    expect(result.attachmentName).toContain('추가모집공고문.pdf');
  });

  it('공공임대 제목에서 유형을 정확히 판별한다', () => {
    const publicHtml = `
      <p class="subject">[공공임대] 2026년 1차 청년안심주택 모집공고</p>
      <div class="board_cont">내용</div>
    `;
    const result = parseDetailPage(publicHtml, 6485);

    expect(result.announcementType).toBe('public');
    expect(result.recruitmentType).toBe('initial');
  });

  it('빈 HTML에서도 에러 없이 기본값을 반환한다', () => {
    const result = parseDetailPage('<html></html>', 9999);

    expect(result.boardId).toBe(9999);
    expect(result.title).toBe('');
    expect(result.complexName).toBeNull();
  });
});
