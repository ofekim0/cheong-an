import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isViewErrorPage } from './isViewErrorPage';

const errorFixture = readFileSync(
  join(__dirname, '__fixtures__', 'viewErrorPage.html'),
  'utf-8',
);

describe('isViewErrorPage', () => {
  it('실 633B 에러 페이지 fixture를 에러로 판별한다', () => {
    expect(isViewErrorPage(errorFixture)).toBe(true);
  });

  it('빈 문자열은 에러 아님', () => {
    expect(isViewErrorPage('')).toBe(false);
  });

  it('일반 정상 HTML은 에러 아님', () => {
    const ok =
      '<html><head><title>모집공고</title></head><body>정상 본문</body></html>';
    expect(isViewErrorPage(ok)).toBe(false);
  });

  it('"에러안내" title 마커 단독으로도 에러로 본다', () => {
    expect(
      isViewErrorPage('<html><title>에러안내</title><body></body></html>'),
    ).toBe(true);
  });

  it('alert 본문 마커 단독으로도 에러로 본다', () => {
    expect(
      isViewErrorPage(
        '<html><body><script>alert("게시글에 대한 정보가 없습니다.")</script></body></html>',
      ),
    ).toBe(true);
  });
});
